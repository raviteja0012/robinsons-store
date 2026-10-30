// The review step of the Slack autopilot, checked without a model, a runner, or Slack.
//
// Every failure worth testing here is a quiet one: a reviewer that crashed reading as a
// pass, a report that mentions the pass line reading as a pass, a change that edits the
// automation being pushed anyway, and a public pull request carrying a reviewer's findings.

import { decide, finalResult, prBody, quiet, reportsMessage, verdict, PASS_LINE, FINDINGS_LINE } from "./autopilot-review.mjs";

let pass = 0, fail = 0;
const t = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
};

const result = (text, is_error = false) =>
  JSON.stringify([{ type: "system" }, { type: "assistant" }, { type: "result", result: text, is_error }]);

// Reading the action's log.
t("reads the final result from a JSON array", finalResult(result("hello")).text === "hello");
t("reads the final result from JSON lines",
  finalResult(`{"type":"system"}\n{"type":"result","result":"hi","is_error":false}\n`).text === "hi");
t("an errored run is marked as errored", finalResult(result("x", true)).isError === true);
t("no result message is null, not a crash", finalResult(JSON.stringify([{ type: "assistant" }])) === null);
t("garbage is null, not a crash", finalResult("not json at all") === null);
t("empty is null, not a crash", finalResult("") === null && finalResult(undefined) === null);

// The verdict. Only the exact last line counts.
const pr = (text) => verdict(finalResult(result(text)));
t("a clean report passes", pr(`Nothing found.\n${PASS_LINE}`) === "pass");
t("a report with findings is findings", pr(`src/x.ts:12 drops tax_mode.\n${FINDINGS_LINE}`) === "findings");
t("bold or backticks around the line still count", pr(`ok\n**${PASS_LINE}**`) === "pass");
t("trailing blank lines are ignored", pr(`ok\n${PASS_LINE}\n\n  \n`) === "pass");
t("the pass line halfway through is not a pass",
  pr(`${PASS_LINE}\nActually, src/x.ts:4 is wrong.`) === "unclear");
t("no verdict line is unclear", pr("Looks fine to me.") === "unclear");
t("an errored reviewer is missing", verdict(finalResult(result(`ok\n${PASS_LINE}`, true))) === "missing");
t("a reviewer that never ran is missing", verdict(null) === "missing");

// The decision.
const reviews = (a, b) => [{ name: "Money reviewer", verdict: a }, { name: "Invariant auditor", verdict: b }];
const base = { buildOutcome: "success", changed: true, guard: "ok", gatesOutcome: "success", reviews: reviews("pass", "pass"), tier: "B", builderSays: "Added a phone column." };

const clean = decide(base);
t("a clean change opens a pull request", clean.openPr === true);
t("a clean change reads as ready to look at", clean.stage === "built");
t("a clean change still says a person merges", /person still decides/.test(clean.note));

const flagged = decide({ ...base, reviews: reviews("findings", "pass") });
t("a finding still opens the pull request, so the work is not lost", flagged.openPr === true);
t("a finding turns the card red", flagged.stage === "checks_failed");
t("a finding names the reviewer", /money reviewer flagged/.test(flagged.note));

t("a reviewer that did not finish turns the card red",
  decide({ ...base, reviews: reviews("pass", "missing") }).stage === "checks_failed");
t("an unclear reviewer turns the card red",
  decide({ ...base, reviews: reviews("unclear", "pass") }).stage === "checks_failed");
t("failed gates turn the card red", decide({ ...base, gatesOutcome: "failure" }).stage === "checks_failed");
t("skipped gates are not a pass", decide({ ...base, gatesOutcome: "skipped" }).stage === "checks_failed");

const auto = decide({ ...base, guard: "automation" });
t("a change to the automation never opens a pull request", auto.openPr === false && auto.stage === "stopped");
t("a review that was never prepared opens nothing",
  decide({ ...base, guard: "" }).openPr === false && decide({ ...base, guard: undefined }).stage === "stopped");

const nothing = decide({ ...base, changed: false, builderSays: "This touches payments, so I stopped." });
t("no change opens nothing", nothing.openPr === false && nothing.stage === "stopped");
t("no change passes on the builder's reason", /touches payments/.test(nothing.note));
t("no change and no reason still says something", !!decide({ ...base, changed: false, builderSays: "" }).note);

t("a failed build opens nothing", decide({ ...base, buildOutcome: "failure" }).openPr === false);
t("tier C is called out", /read it closely/.test(decide({ ...base, tier: "C" }).note));

// The public pull request carries verdicts, never the reports.
const secret = "staff can see invoice totals on src/app/overdue/page.tsx:88";
const body = prBody({
  builderSays: "Added a phone column.",
  tier: "B",
  tierReason: "Touches the app: src/app/vendors/page.tsx",
  gatesOutcome: "success",
  reviews: [{ name: "Money reviewer", verdict: "findings", text: secret }],
  runUrl: "https://example.invalid/run/1"
});
t("the pull request body leaves the report text out", !body.includes(secret));
t("the pull request body names the verdict", /Money reviewer \| \*\*Flagged something\*\*/.test(body));
t("the pull request body says where the reports are", /Slack thread/.test(body));

const msg = reportsMessage([{ name: "Money reviewer", verdict: "findings", text: secret }, { name: "Invariant auditor", verdict: "missing", text: "" }]);
t("the Slack reports carry the findings", msg.includes(secret));
t("the Slack reports say when a reviewer returned nothing", /returned nothing/.test(msg));
t("a long report is shortened",
  reportsMessage([{ name: "Money reviewer", verdict: "findings", text: "x".repeat(9000) }]).length < 2000);

t("an @mention is defused", !/@octocat/.test(quiet("ping @octocat please")));
t("an email-like @ is defused too, harmlessly", quiet("a@b").length === 4);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
