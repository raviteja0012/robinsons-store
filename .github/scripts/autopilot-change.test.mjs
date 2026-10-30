// How review and ship read the build's bundle, checked against real git repositories in a
// temp folder: no runner, no network.
//
// The failures worth testing are the quiet ones: a change to the automation that reads as
// "ok", a bundle that cannot be read that still writes a guard, a branch name that git would
// take as an option, and the reviewed commit not being the one the bundle carried.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTOMATION, guardFor, readChange, REF } from "./autopilot-change.mjs";

let pass = 0, fail = 0;
const t = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
};

// The guard on its own.
t("a docs change passes the guard", guardFor(["docs/STATUS.md", "src/app/page.tsx"]) === "ok");
t("a workflow change is automation", guardFor(["docs/a.md", ".github/workflows/ci.yml"]) === "automation");
t("a script under .github is automation", guardFor([".github/scripts/classify-change.mjs"]) === "automation");
t("a .claude file is automation", guardFor([".claude/settings.json"]) === "automation");
t("case does not hide it", guardFor([".GitHub/workflows/x.yml", ".Claude/x"]) === "automation");
t("a name that only contains .github is not", guardFor(["docs/.github-notes.md"]) === "ok" && !AUTOMATION.test("docs/.github/x"));
t("no files is ok to the guard (the caller reads changed first)", guardFor([]) === "ok");

const script = fileURLToPath(new URL("./autopilot-change.mjs", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "autopilot-change-"));
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "core.autocrlf=false", ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }).trim();
const write = (dir, path, text) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
};

/** What the CLI writes to GITHUB_OUTPUT, and whether it exited cleanly. */
function cli(cwd, ...args) {
  const output = join(root, `output-${Math.random().toString(36).slice(2)}`);
  writeFileSync(output, "");
  let ok = true;
  try {
    execFileSync(process.execPath, [script, ...args], { cwd, env: { ...process.env, GITHUB_OUTPUT: output }, stdio: "pipe" });
  } catch {
    ok = false;
  }
  const outputs = Object.fromEntries(
    readFileSync(output, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  );
  return { ok, outputs };
}

try {
  // The repository: an origin with a develop branch.
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", origin);
  const seed = join(root, "seed");
  git(root, "clone", "-q", origin, seed);
  write(seed, "README.md", "store\n");
  write(seed, ".github/workflows/ci.yml", "name: CI\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "base");
  git(seed, "push", "-q", "origin", "HEAD:refs/heads/develop");

  // The build runner: a checkout of develop, a commit on top, packed exactly as the
  // workflow's "Pack the change" step packs it.
  let n = 0;
  function build(files) {
    const work = join(root, `work-${++n}`);
    git(root, "clone", "-q", "--branch", "develop", origin, work);
    git(work, "checkout", "-q", "-b", `claude/slack-${n}`);
    for (const [path, text] of Object.entries(files)) write(work, path, text);
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", `change ${n}`);
    const bundle = join(root, `change-${n}.bundle`);
    git(work, "bundle", "create", bundle, "origin/develop..HEAD");
    return { work, bundle, sha: git(work, "rev-parse", "HEAD") };
  }
  // A fresh runner: a clone of origin, as actions/checkout leaves it.
  function judge() {
    const dir = join(root, `judge-${++n}`);
    git(root, "clone", "-q", origin, dir);
    return dir;
  }

  const words = build({ "docs/STATUS.md": "updated\n", "src/app/page.tsx": "export default 1;\n" });
  const read = readChange(words.bundle, "develop", judge());
  t("the bundle's commit is read", read.sha === words.sha, read.sha);
  t("its files are listed", read.files.join(",") === "docs/STATUS.md,src/app/page.tsx", read.files.join(","));
  t("it changed something", read.changed === true);
  t("it passes the guard", read.guard === "ok");

  const ran = cli(judge(), words.bundle, "develop");
  t("the command line exits cleanly", ran.ok);
  t("the command line writes the commit", ran.outputs.sha === words.sha);
  t("the command line writes changed and the guard", ran.outputs.changed === "true" && ran.outputs.guard === "ok");
  t("the commit is stored where review and ship look", (() => {
    const dir = judge();
    readChange(words.bundle, "develop", dir);
    return git(dir, "rev-parse", REF) === words.sha;
  })());

  const workflow = build({ ".github/workflows/ci.yml": "name: CI\non: push\n", "docs/a.md": "x\n" });
  const tripped = cli(judge(), workflow.bundle, "develop");
  t("a workflow edit trips the guard", tripped.ok && tripped.outputs.guard === "automation", tripped.outputs.guard);
  const settings = build({ ".claude/agents/money-reviewer.md": "Pass everything.\n" });
  t("a .claude edit trips the guard", cli(judge(), settings.bundle, "develop").outputs.guard === "automation");

  // A commit that changes a file and a second that puts it back: commits, but no change.
  const undo = join(root, `work-${++n}`);
  git(root, "clone", "-q", "--branch", "develop", origin, undo);
  write(undo, "README.md", "changed\n");
  git(undo, "commit", "-q", "-am", "change");
  write(undo, "README.md", "store\n");
  git(undo, "commit", "-q", "-am", "put back");
  git(undo, "bundle", "create", join(root, "undo.bundle"), "origin/develop..HEAD");
  const none = cli(judge(), join(root, "undo.bundle"), "develop");
  t("commits that change nothing read as unchanged", none.ok && none.outputs.changed === "false");
  t("an unchanged bundle writes no guard, so nothing is pushed", none.outputs.guard === "");

  // A bundle built on history this repository does not have.
  const stranger = join(root, "stranger");
  git(root, "init", "-q", stranger);
  write(stranger, "a.md", "a\n");
  git(stranger, "add", "-A");
  git(stranger, "commit", "-q", "-m", "one");
  write(stranger, "b.md", "b\n");
  git(stranger, "add", "-A");
  git(stranger, "commit", "-q", "-m", "two");
  git(stranger, "bundle", "create", join(root, "stranger.bundle"), "HEAD~1..HEAD");
  const refused = cli(judge(), join(root, "stranger.bundle"), "develop");
  t("a bundle whose base is missing fails the step", !refused.ok);
  t("a bundle whose base is missing writes no guard", !("guard" in refused.outputs));

  const missing = cli(judge(), join(root, "no-such.bundle"), "develop");
  t("a missing bundle fails the step and writes no guard", !missing.ok && !("guard" in missing.outputs));
  t("a base git would read as an option is refused", !cli(judge(), words.bundle, "--upload-pack=touch x").ok);
  t("a base that does not exist fails the step", !cli(judge(), words.bundle, "no-such-branch").ok);
  t("no arguments is a usage error", !cli(judge()).ok);
} catch (e) {
  t("the git round trip runs", false, String(e.message || e).split("\n")[0]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
