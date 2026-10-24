// The tier rules, checked without a git repository.
//
// These decide which changes merge with nobody looking, so every path that matters is pinned
// here: a rule that silently widens tier A is invisible in review and only shows up as a
// change that merged itself.

import { classify, MAX_AUTO_LINES } from "./classify-change.mjs";

let pass = 0, fail = 0;
const t = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
};
const tier = (files, lines = 10) => classify(files, lines).tier;

// Words only, small: the one case that may merge itself.
t("a doc is A", tier(["docs/STATUS.md"]) === "A");
t("a root readme is A", tier(["README.md"]) === "A");
t("several docs together are A", tier(["docs/STATUS.md", "docs/VERIFICATION.md", "RUNBOOK.md"]) === "A");
t("a doc at the line limit is A", tier(["docs/STATUS.md"], MAX_AUTO_LINES) === "A");

// Words, but too many of them.
t("a doc over the line limit is B", tier(["docs/STATUS.md"], MAX_AUTO_LINES + 1) === "B");

// The app.
t("a screen is B", tier(["src/app/capture/page.tsx"]) === "B");
t("a doc plus a screen is B", tier(["docs/STATUS.md", "src/app/capture/page.tsx"]) === "B");
t("the in-app guide is B, because it is TypeScript", tier(["src/lib/appGuide.ts"]) === "B");
t("markdown below the root, outside docs, is B", tier(["src/notes.md"]) === "B");

// Money, access, the database, and the automation. Never merges.
for (const f of [
  "supabase/payments_v2.sql",
  "src/lib/payments.ts",
  "src/lib/auth.ts",
  "src/app/api/ask/route.ts",
  "package.json",
  "vercel.json",
  ".github/workflows/slack-autopilot.yml",
  ".github/scripts/classify-change.mjs",
  ".claude/skills/robinsons-store/SKILL.md",
  ".agents/skills/supabase/SKILL.md",
  // Instructions the autopilot reads on every run. These are the ones a words-only rule
  // would otherwise let through, which is exactly why they are pinned.
  "CLAUDE.md",
  "docs/LOOP_ENGINEERING.md",
  "docs/adr/ADR-002-words-only-changes-merge-themselves.md"
]) {
  t(`${f} is C`, tier([f]) === "C");
}
t("one blocked file among docs makes the whole change C",
  tier(["docs/STATUS.md", "CLAUDE.md"]) === "C");
t("C wins over the line limit", tier(["CLAUDE.md"], 1) === "C");

// Nothing changed.
t("an empty diff is none", tier([]) === "none");

// The reason is what a person reads on the pull request; it must name the file.
t("a C reason names the file", classify(["CLAUDE.md"], 1).reason.includes("CLAUDE.md"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
