// The shape of the Slack autopilot workflow, checked without a runner.
//
// The builder has a shell on its own runner, so after "Build it" nothing on that runner is
// trusted: not the working tree, not the scripts in it, not the runner's environment. The
// workflow answers that with three jobs. The build job runs no script and holds no secret
// after the build. The review and ship jobs start on fresh runners, check out the workflow's
// own commit, and run only scripts from that checkout. The merge checks the tier and both
// verdicts itself. These checks fail the moment any of that changes.
//
// No YAML library, so this runs with nothing installed. It reads this workflow's own
// layout: jobs at two spaces, job keys at four, steps at six, step keys at eight.

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const t = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
};

const lines = readFileSync(new URL("../workflows/slack-autopilot.yml", import.meta.url), "utf8")
  .split("\n")
  .map((l) => l.replace(/\r$/, ""));

/** A key's value at the given indent, including a folded (`>`) or literal (`|`) block. */
function value(blockLines, key, indent) {
  const pad = " ".repeat(indent);
  const i = blockLines.findIndex((l) => l.startsWith(`${pad}${key}:`) || l.startsWith(`${" ".repeat(indent - 2)}- ${key}:`));
  if (i < 0) return "";
  const first = blockLines[i].slice(blockLines[i].indexOf(`${key}:`) + key.length + 1).trim();
  if (first !== ">" && first !== "|") return first;
  const rest = [];
  for (const l of blockLines.slice(i + 1)) {
    if (l.trim() && l.length - l.trimStart().length <= indent) break;
    rest.push(l.trim());
  }
  return rest.join(" ").trim();
}

/** One job: its header lines and its steps as { name, if, text }, comments left out. */
function job(name) {
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) return { header: [], steps: [] };
  let end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).filter((l) => !/^\s*#/.test(l));
  const stepsAt = body.indexOf("    steps:");
  const header = stepsAt < 0 ? body : body.slice(0, stepsAt);
  const blocks = [];
  for (const l of stepsAt < 0 ? [] : body.slice(stepsAt + 1)) {
    if (/^ {6}- /.test(l)) blocks.push([l]);
    else if (blocks.length) blocks[blocks.length - 1].push(l);
  }
  const steps = blocks.map((b) => ({
    name: value(b, "name", 8) || value(b, "uses", 8) || value(b, "run", 8),
    if: value(b, "if", 8),
    text: b.join("\n")
  }));
  return { header, steps, headerText: header.join("\n") };
}

/** What each `node <script>` in a step's shell points at. */
const nodeRuns = (s) => [...s.text.matchAll(/(?:^\s*|run:\s*)node\s+(\S+)/gm)].map((m) => m[1]);
const holdsSlack = (s) => /secrets\.SLACK_BOT_TOKEN/.test(s.text);

// The build job: after the build, no script and no secret on the builder's runner.
const build = job("autopilot");
t("the build job is found", build.steps.length > 5, `${build.steps.length} steps`);
const at = build.steps.findIndex((s) => s.name === "Build it");
t("the build step is found", at >= 0);
const afterBuild = build.steps.slice(at + 1);
t("something still runs after the build (the builder's summary)", afterBuild.length > 0);
for (const s of afterBuild) {
  t(`build job, ${s.name}: runs no node script after the build`, nodeRuns(s).length === 0, nodeRuns(s).join(", "));
  t(`build job, ${s.name}: holds no secret after the build`, !/secrets\./.test(s.text));
}

// The jobs that judge and report: fresh runners, the workflow's own commit, nothing else.
for (const name of ["review", "ship"]) {
  const j = job(name);
  t(`${name}: the job is found`, j.steps.length > 0);
  t(`${name}: runs after the build job`, /^ {4}needs: .*\bautopilot\b/m.test(j.headerText), value(j.header, "needs", 4));
  const checkouts = j.steps.filter((s) => /uses: actions\/checkout@/.test(s.text));
  t(`${name}: checks out exactly once`, checkouts.length === 1, `${checkouts.length}`);
  t(`${name}: checks out first`, /uses: actions\/checkout@/.test(j.steps[0]?.text || ""));
  t(`${name}: checks out the workflow's own commit`, /^ {10}ref: \$\{\{ github\.sha \}\}$/m.test(checkouts[0]?.text || ""));
  for (const s of j.steps) {
    for (const target of nodeRuns(s)) {
      t(`${name}, ${s.name}: runs a script from its own checkout`, /^\.github\/scripts\/[\w.-]+\.mjs$/.test(target), target);
    }
  }
}

// The reviewers read the change as data, without its own briefing files, and can only read.
const review = job("review");
t("review: its token can only read the repository", /^ {6}contents: read$/m.test(review.headerText) && !/contents: write/.test(review.headerText));
const layout = review.steps.find((s) => /\.autopilot-review\/head/.test(s.text))?.text || "";
for (const f of ["CLAUDE.md", "AGENTS.md", ".mcp.json"]) {
  t(`review: ${f} is removed from the change before the reviewers read it`, layout.includes(`-name ${f}`));
}
for (const d of [".claude", ".agents"]) {
  t(`review: ${d}/ is removed from the change before the reviewers read it`, layout.includes(`-name ${d}`));
}
for (const s of review.steps.filter((s) => /claude-code-action/.test(s.text))) {
  t(`review, ${s.name}: reads only`, /--allowedTools "Read,Grep,Glob"/.test(s.text));
}

// The Slack token: before the build on the build runner, or on a fresh runner after it.
for (const s of build.steps.filter(holdsSlack)) {
  t(`build job, ${s.name}: holds the Slack token only before the build`, build.steps.indexOf(s) < at);
}
t("the card is updated after the build, from ship", job("ship").steps.some((s) => holdsSlack(s) && nodeRuns(s).includes(".github/scripts/slack-status.mjs")));

// The merge checks the tier and both verdicts itself, on the commit that was reviewed.
const merges = ["autopilot", "review", "ship"].flatMap((n) => job(n).steps.map((s) => ({ job: n, ...s }))).filter((s) => /\bgh pr merge\b/.test(s.text));
t("exactly one step merges, in ship", merges.length === 1 && merges[0].job === "ship", merges.map((m) => m.job).join(", "));
const mergeIf = merges[0]?.if || "";
t("the merge needs tier A", mergeIf.includes("steps.tier.outputs.tier == 'A'"), mergeIf);
t("the merge needs both reviewers to pass", mergeIf.includes("needs.review.outputs.passed == 'true'"));
t("the merge needs the reviewed commit to be the one it merges", mergeIf.includes("needs.review.outputs.sha == steps.tier.outputs.sha"));
t("the merge needs the switch on", mergeIf.includes("vars.AUTOMERGE_TIER_A == 'true'"));
t("the merge does not run regardless of failures", !/always\(\)/.test(mergeIf));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
