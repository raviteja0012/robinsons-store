// The shape of the Slack autopilot workflow, checked without a runner.
//
// After "Build it" the working tree is whatever the builder left. Every script that runs
// after that point must be the base branch's copy, taken into the runner's temp folder, or
// a change could rewrite the script that decides whether its own pull request opens. These
// checks fail the moment a step goes back to `node .github/scripts/...` after the build,
// runs a script the copy step does not take, or pushes without checking the guard itself.
//
// No YAML library, so this runs with nothing installed. It reads this workflow's own
// layout: jobs at two spaces, steps at six, step keys at eight.

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const t = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
};

const yml = readFileSync(new URL("../workflows/slack-autopilot.yml", import.meta.url), "utf8");

/** One job's steps as { name, id, if, text }, comments left out. */
function steps(job) {
  const lines = yml.split("\n").map((l) => l.replace(/\r$/, ""));
  const start = lines.indexOf(`  ${job}:`);
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  if (end < 0) end = lines.length;
  const blocks = [];
  for (const l of lines.slice(start + 1, end)) {
    if (/^\s*#/.test(l)) continue;
    if (/^ {6}- /.test(l)) blocks.push([l]);
    else if (blocks.length) blocks[blocks.length - 1].push(l);
  }
  return blocks.map((b) => {
    const text = b.join("\n");
    const key = (k) => (text.match(new RegExp(`^(?: {6}- | {8})${k}: (.*)$`, "m")) || [])[1]?.trim() ?? "";
    return { name: key("name") || key("uses") || key("run"), id: key("id"), if: key("if"), text };
  });
}

/** What each `node <script>` in a step's shell points at. */
const nodeRuns = (s) => [...s.text.matchAll(/(?:^\s*|run:\s*)node\s+(\S+)/gm)].map((m) => m[1]);

const all = steps("autopilot");
t("the autopilot job is found", all.length > 5, `${all.length} steps`);
const build = all.findIndex((s) => s.name === "Build it");
t("the build step is found", build >= 0);
const after = all.slice(build + 1);

// The copy step: after the build, from the base branch, no secrets, runs on failure too.
const copy = all.findIndex((s) => s.id === "scripts");
const copyStep = all[copy] || { text: "", if: "" };
t("the scripts are copied after the build, not before", copy > build && build >= 0);
t("the copy runs even when the build failed, so the card can say so", /always\(\)/.test(copyStep.if));
t("the copy reads the base branch", /git show "origin\/\$BASE:\.github\/scripts\/\$f"/.test(copyStep.text));
t("the copy step holds no secrets", !/secrets\./.test(copyStep.text));
const copied = (copyStep.text.match(/for f in ([^;\n]+); do/) || [])[1]?.trim().split(/\s+/) ?? [];
for (const f of ["classify-change.mjs", "autopilot-review.mjs", "slack-status.mjs"]) {
  t(`the copy takes ${f}`, copied.includes(f));
}

// After the build, nothing runs from the working tree, and nothing runs that was not copied.
for (const s of after) {
  for (const target of nodeRuns(s)) {
    const m = target.match(/^"\$RUNNER_TEMP\/from-base\/([\w.-]+)"$/);
    t(`${s.name}: runs the base branch's copy`, !!m, target);
    if (m) t(`${s.name}: ${m[1]} is one the copy step takes`, copied.includes(m[1]));
    if (m) t(`${s.name}: runs after the copy`, all.indexOf(s) > copy);
  }
}
t("the decision and the card run after the build",
  after.some((s) => nodeRuns(s).some((r) => r.includes("autopilot-review.mjs"))) &&
  after.some((s) => nodeRuns(s).some((r) => r.includes("slack-status.mjs"))));

// A step that holds the Slack token after the build runs node on the copy and nothing else.
for (const s of after.filter((s) => /secrets\.SLACK_BOT_TOKEN/.test(s.text))) {
  t(`${s.name}: holds the Slack token and runs no git`, !/(?:^|\s)git\s/m.test(s.text));
}

// The push checks the guard itself, not only the decision script's answer.
const pushes = all.filter((s) => /\bgit push\b/.test(s.text));
t("exactly one step pushes", pushes.length === 1, `${pushes.length}`);
const pushIf = pushes[0]?.if || "";
t("the push checks the guard", pushIf.includes("steps.change.outputs.guard == 'ok'"), pushIf);
t("the push checks the decision", pushIf.includes("steps.review.outputs.open_pr == 'true'"), pushIf);
t("the push does not run regardless of failures", !/always\(\)/.test(pushIf));

// Each copied script still works alone, from another folder: it imports only Node's own
// modules, and its main() guard still fires there.
const tmp = mkdtempSync(join(tmpdir(), "from-base-"));
try {
  for (const f of copied) {
    copyFileSync(new URL(f, import.meta.url), join(tmp, f));
    const src = readFileSync(join(tmp, f), "utf8");
    const specs = [...src.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
    t(`${f}: imports only Node's own modules`, specs.every((s) => s.startsWith("node:")), specs.join(", "));
  }

  const outFile = join(tmp, "github-output.txt");
  execFileSync(process.execPath, [join(tmp, "autopilot-review.mjs")], {
    cwd: tmp,
    env: { ...process.env, BUILD_OUTCOME: "failure", GITHUB_OUTPUT: outFile, BODY_OUT: "", REPORTS_OUT: "" },
    stdio: "pipe"
  });
  t("the decision runs from the temp folder", /^open_pr=false$/m.test(readFileSync(outFile, "utf8")));

  const said = execFileSync(process.execPath, [join(tmp, "slack-status.mjs")], {
    cwd: tmp,
    env: { ...process.env, SLACK_BOT_TOKEN: "", SLACK_REQUEST_CHANNEL: "", THREAD_TS: "", STAGE: "" },
    encoding: "utf8",
    stdio: "pipe"
  });
  t("the card runs from the temp folder", /not configured/.test(said), said.trim());
} catch (e) {
  t("the copied scripts run from the temp folder", false, String(e.message || e).split("\n")[0]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
