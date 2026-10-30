// What happens to a Slack-built change between "the model says it is done" and "a person
// looks at it".
//
// The builder model writes the code and commits it. It does not push and it does not open
// the pull request. The workflow then re-runs the three gates itself, has the tier
// classifier read the diff, and has two read-only reviewers (money-reviewer and
// invariant-auditor, their instructions taken from the BASE branch) read the change. This
// file turns those results into three things:
//
//   - whether a pull request opens at all,
//   - the status card in the Slack thread, and a second thread message carrying the
//     reviewers' reports,
//   - the pull request body, which carries verdicts but NOT the reports.
//
// WHY THE REPORTS GO TO SLACK AND NOT THE PULL REQUEST. The repository is public. A report
// that says "staff can see invoice totals on this screen" is a description of a weakness,
// and a public pull request is the wrong place for it. The Slack workspace is the store's
// own. The pull request says which reviewer flagged something and where to read it.
//
// WHY A MODEL REVIEWING A MODEL IS NOT THE GATE. A model asked "is this right?" usually says
// yes, which is why docs/LOOP_ENGINEERING.md keeps the decisions in scripts. The reviewers
// are a second look that names concrete lines for the person who merges. The gate is still
// that person, plus the classifier, which reads the diff and not the request.
//
// FAILING CLOSED. A reviewer that errors, runs out of turns, or ends without a verdict line
// counts as "did not finish", which reads to the person exactly like a finding: look before
// merging. Silence is never a pass.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

export const PASS_LINE = "VERDICT: PASS";
export const FINDINGS_LINE = "VERDICT: FINDINGS";

/**
 * The final answer from a claude-code-action execution file, or null.
 *
 * The file is the action's message log. The last message of type "result" holds the final
 * text and whether the run errored. Accepts a JSON array or one JSON object per line, since
 * which one the action writes is its business, not ours.
 */
export function finalResult(raw) {
  if (!raw || typeof raw !== "string") return null;
  let messages = [];
  try {
    const parsed = JSON.parse(raw);
    messages = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    for (const line of raw.split("\n")) {
      try {
        messages.push(JSON.parse(line));
      } catch {
        // A line that is not JSON is not a message.
      }
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.type === "result") {
      return { text: typeof m.result === "string" ? m.result : "", isError: !!m.is_error };
    }
  }
  return null;
}

/**
 * pass, findings, unclear (answered without a verdict line) or missing (never answered).
 *
 * Only the LAST non-empty line counts, and only if it is exactly the verdict. A report that
 * mentions "VERDICT: PASS" halfway through, or quotes it from code it read, has not passed.
 */
export function verdict(result) {
  if (!result || result.isError || !result.text.trim()) return "missing";
  const lines = result.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = (lines[lines.length - 1] || "").replace(/[*_`]/g, "").trim();
  if (last === PASS_LINE) return "pass";
  if (last === FINDINGS_LINE) return "findings";
  return "unclear";
}

/** Stops an @word in model-written text from notifying a real GitHub user. */
export function quiet(text) {
  return String(text || "").replace(/@(?=[A-Za-z0-9])/g, "@​");
}

function oneLine(text, max) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

const READS = { pass: "No findings", findings: "Flagged something", unclear: "Did not finish", missing: "Did not finish" };

/**
 * Whether a pull request opens, and what the Slack card says.
 *
 * Pure, so the decision the person in Slack actually sees is tested without a run.
 */
export function decide({ buildOutcome, changed, guard, gatesOutcome, reviews = [], tier, builderSays }) {
  if (buildOutcome !== "success") {
    return {
      openPr: false,
      stage: "stopped",
      note: "I could not finish this one, so nothing has changed. It needs a person to look."
    };
  }
  if (!changed) {
    return {
      openPr: false,
      stage: "stopped",
      note: oneLine(builderSays, 600) || "I stopped without changing anything. The reason is in the run log."
    };
  }
  if (guard === "automation") {
    return {
      openPr: false,
      stage: "stopped",
      note:
        "This change would edit the automation's own files, which only a person may change. " +
        "Nothing was pushed."
    };
  }
  if (guard !== "ok") {
    // The step that prepares the review died partway. Nothing was reviewed, so nothing opens.
    return {
      openPr: false,
      stage: "stopped",
      note: "The change was built but could not be prepared for review, so nothing was pushed. It needs a person to look."
    };
  }

  const problems = [];
  if (gatesOutcome !== "success") problems.push("the build checks failed when the workflow ran them again");
  for (const r of reviews) {
    if (r.verdict === "findings") problems.push(`the ${r.name.toLowerCase()} flagged something`);
    else if (r.verdict !== "pass") problems.push(`the ${r.name.toLowerCase()} did not finish`);
  }
  const parts = [oneLine(builderSays, 600)];
  parts.push(
    problems.length
      ? `Before anyone merges this: ${problems.join("; ")}. The reviewers' reports are in this thread.`
      : "The build checks passed and both reviewers found nothing wrong. A person still decides whether to merge it."
  );
  if (tier === "C") parts.push("It touches money, logins, the database or the automation, so read it closely.");
  return { openPr: true, stage: problems.length ? "checks_failed" : "built", note: parts.filter(Boolean).join(" ") };
}

/** The pull request body: what changed and what was checked. No report text; see the top. */
export function prBody({ builderSays, tier, tierReason, gatesOutcome, reviews = [], runUrl }) {
  const rows = [
    `| Type check, lint, build, run again by the workflow | ${gatesOutcome === "success" ? "Passed" : "**Failed**"} |`,
    `| Change tier (\`.github/scripts/classify-change.mjs\`) | ${tier || "unknown"}: ${quiet(oneLine(tierReason, 200))} |`,
    ...reviews.map((r) => `| ${r.name} | ${r.verdict === "pass" ? READS.pass : `**${READS[r.verdict] || READS.missing}**`} |`)
  ];
  return [
    "Built from a request in the store's Slack requests channel.",
    "",
    "## What changed",
    "",
    quiet(builderSays) || "The builder gave no summary; read the diff.",
    "",
    "## Checks run before this opened",
    "",
    "| Check | Result |",
    "|---|---|",
    ...rows,
    "",
    "The reviewers read the change with read-only tools and instructions taken from the base branch. " +
      "Their reports are in the Slack thread under the request.",
    "",
    `Run: ${runUrl || "unknown"}`
  ].join("\n");
}

/** The second thread message: each reviewer's report, for the person who merges. */
export function reportsMessage(reviews = []) {
  const blocks = reviews.map((r) => {
    const head = `${r.name}: ${READS[r.verdict] || READS.missing}`;
    const body = r.verdict === "missing" ? "It returned nothing. Read the change yourself." : (r.text || "").trim();
    return `*${head}*\n${body.length > 1800 ? body.slice(0, 1799) + "…" : body}`;
  });
  return blocks.join("\n\n");
}

function out(key, value) {
  const f = process.env.GITHUB_OUTPUT;
  console.log(`${key}: ${value}`);
  if (f) appendFileSync(f, `${key}=${String(value).replace(/\n/g, " ")}\n`);
}

function readResult(path) {
  if (!path || !existsSync(path)) return null;
  return finalResult(readFileSync(path, "utf8"));
}

function main() {
  const env = process.env;
  const builder = readResult(env.BUILD_FILE);
  const builderSays = builder && !builder.isError ? builder.text.trim() : "";
  const reviews = [
    { name: "Money reviewer", file: env.MONEY_FILE },
    { name: "Invariant auditor", file: env.INVARIANT_FILE }
  ].map((r) => {
    const result = readResult(r.file);
    return { name: r.name, verdict: verdict(result), text: result ? result.text : "" };
  });

  const d = decide({
    buildOutcome: env.BUILD_OUTCOME,
    changed: env.CHANGED === "true",
    guard: env.GUARD,
    gatesOutcome: env.GATES_OUTCOME,
    reviews,
    tier: env.TIER,
    builderSays
  });
  out("open_pr", d.openPr);
  out("stage", d.stage);
  out("note", d.note);

  if (d.openPr && env.BODY_OUT) {
    writeFileSync(
      env.BODY_OUT,
      prBody({
        builderSays,
        tier: env.TIER,
        tierReason: env.TIER_REASON,
        gatesOutcome: env.GATES_OUTCOME,
        reviews,
        runUrl: env.RUN_URL
      })
    );
  }
  if (d.openPr && env.REPORTS_OUT) writeFileSync(env.REPORTS_OUT, reportsMessage(reviews));
}

if (process.argv[1] && process.argv[1].endsWith("autopilot-review.mjs")) {
  main();
}
