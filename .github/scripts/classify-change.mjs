// Decides how far a change is allowed to travel on its own.
//
// The model writes the code. THIS decides whether it merges. That split is the whole point:
// a judgement the model makes about its own work is a judgement it can talk itself into, so
// the gate is a script reading the actual diff, and nothing in a Slack message, a Jira
// ticket or a prompt can move it.
//
// A  the change only touches words. Merges itself once the checks are green, and deploys.
// B  the change touches the app. Draft pull request, a person merges. This is the default.
// C  the change touches money, access, the database, or the automation itself.
//    Nothing merges. It is reported and left for a person.
//
// Called by the Slack autopilot after it opens a pull request (ADR-002), and by the parked
// Jira autopilot.
//
// Usage: node classify-change.mjs <base-ref> [head-ref]
//   writes tier and reason to GITHUB_OUTPUT. head-ref defaults to HEAD; the Slack loop passes
//   the pull request's head commit so the tier is decided on exactly what CI will check.

import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Money, access, the database, and the automation's own guard rails. The last group matters
// most: a loop that can edit its own limits does not have limits, and a loop that can edit
// its own reviewer has no reviewer.
//
// CLAUDE.md, .agents/ and .kiro/ are here because they are instructions, not words: the
// autopilot reads CLAUDE.md first on every run, and .agents/skills is symlinked into
// .claude/skills. A "documentation" change to any of them rewrites the next run's rules.
// LOOP_ENGINEERING.md and the decision records describe the limits, so changing them is a
// decision a person makes too.
export const BLOCKED = [
  /^supabase\//,
  /^src\/lib\/payments\.ts$/,
  /^src\/lib\/auth\.ts$/,
  /^src\/lib\/edit\.ts$/,
  /^src\/lib\/serverMember\.ts$/,
  /^src\/lib\/supabaseClient\.ts$/,
  /^src\/app\/api\//,
  /^\.github\//,
  /^\.claude\//,
  /^\.agents\//,
  /^\.kiro\//,
  /^CLAUDE\.md$/,
  /^skills-lock\.json$/,
  /^docs\/LOOP_ENGINEERING\.md$/,
  /^docs\/adr\//,
  /^vercel\.json$/,
  /^package\.json$/,
  /^package-lock\.json$/
];

// Words only. No logic lives in any of these. The in-app guide (src/lib/appGuide.ts) used to
// be here and is not any more: it is TypeScript, so a diff to it can carry code, and a tier
// that merges unattended must not be able to.
export const WORDS_ONLY = [
  /^docs\//,
  /^[^/]+\.md$/
];

// A words-only change should be small. A thousand-line "documentation" change is something
// else wearing a hat.
export const MAX_AUTO_LINES = 300;

/** The decision itself, pure, so the rules can be tested without a git repository. */
export function classify(files, changedLines) {
  if (!files.length) return { tier: "none", reason: "Nothing changed." };

  const blocked = files.filter((f) => BLOCKED.some((r) => r.test(f)));
  if (blocked.length) {
    return { tier: "C", reason: `Touches files a person must review: ${blocked.slice(0, 5).join(", ")}` };
  }

  const notWords = files.filter((f) => !WORDS_ONLY.some((r) => r.test(f)));
  if (!notWords.length && changedLines <= MAX_AUTO_LINES) {
    return { tier: "A", reason: `Words only (${files.length} files, ${changedLines} lines).` };
  }

  return {
    tier: "B",
    reason: notWords.length
      ? `Touches the app: ${notWords.slice(0, 5).join(", ")}`
      : `Words only but large (${changedLines} lines), so a person looks first.`
  };
}

function out(key, value) {
  const f = process.env.GITHUB_OUTPUT;
  console.log(`${key}: ${value}`);
  if (f) appendFileSync(f, `${key}=${String(value).replace(/\n/g, " ")}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const base = process.argv[2] || "origin/main";
  const head = process.argv[3] || "HEAD";
  let result;
  try {
    // --no-renames so a file moved OUT of a blocked path still lists its old name.
    const files = execSync(`git diff --no-renames --name-only ${base}...${head}`, { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
    const stat = execSync(`git diff --no-renames --shortstat ${base}...${head}`, { encoding: "utf8" });
    const ins = /(\d+) insertion/.exec(stat);
    const del = /(\d+) deletion/.exec(stat);
    result = classify(files, Number(ins?.[1] || 0) + Number(del?.[1] || 0));
  } catch (e) {
    result = { tier: "C", reason: `Could not read the diff, so nothing is merged: ${e.message}` };
  }
  out("tier", result.tier);
  out("reason", result.reason);
}
