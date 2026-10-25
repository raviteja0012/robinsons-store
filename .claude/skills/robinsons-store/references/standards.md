# Standards: documents, decisions and reviews

Part of the `robinsons-store` skill. SKILL.md points here.

One home per fact, evidence beside every claim, and nothing verdicted by the person who wrote
it. The domain rules and invariants are in SKILL.md; this file is how the work is written down and checked.

## Every document

- First line after the title: `Status: DRAFT | PROPOSED | ACCEPTED | SUPERSEDED by <file>, <date>. Owner: <role>. Approver: <role or name>.`
- BLUF: the first paragraph answers the question the reader came with, in one or two
  sentences. Then only what changes the reader's next action. No recaps.
- No em dashes. Plain words; the owner is non-technical.
- Never write personal references: personal email addresses, personal account usernames,
  employers. Store identities (admin@robinsonsgeneralstore.ca, the store's company name) are
  fine.
- Ends with "How this maps to the rest of the docs", then a basis footer (below).
- Superseded documents keep a banner naming what replaced them; docs/README.md is updated in
  the same change as any file added or superseded.

## Every claim

Tag inline, next to the claim:

| Tag | Means | Valid only with |
|---|---|---|
| `[R path:line]` | Read from a file in this repo | A path and line anyone can open in one step |
| `[V-run, what, date]` | Verified by running or querying something this session | The command or API and what it returned |
| `[V-src, url, date]` | Read from vendor documentation this session | The source and date. Memory is never `[V-src]` |
| `[D: source, confirm with <name>]` | Someone reported it; not yet confirmed | The named person who must confirm |
| `[J-open]` | Believed, not checked | A kill condition: what would prove it wrong |
| `[Q: <owner>]` | Open question | A named owner. A question with no owner is a wish |

Rules: a decision never rests on `[J-open]`. A claim about what a person knows or prefers is
`[Q]` to that person. Cost claims need a number and a source. A claim inherits the weakest
tag in its chain.

Every capability carries one state, and present tense is for BUILT only:
**BUILT** (exists, evidenced), **PARTIAL** (exists, gaps named), **SCAFFOLDED** (built and
switched off; name the switch), **TARGET** (not built).

## Decision records (docs/adr/ADR-NNN-title-as-a-sentence.md)

Metadata table (status, proposer, deciders, technical owner, supersedes), then Context with
numbers and the failure of not deciding, Decision as numbered rulings, Conditions (the
commitments that come with it, tracked as delivery items), Consequences split into accepted
costs and benefits, Alternatives considered each marked Rejected with the one reason, Related,
basis footer. The proposer and the approver are never the same person.

## Diagrams

Mermaid in the markdown. Each diagram's caption is the question it answers, it has at most
about nine boxes, every arrow is labelled, and a one-sentence "Plain flow:" text version sits
under it. A missing diagram is declared, with what would let it be drawn, not faked.

## Reviewing a change

Before the work, name the reviewers the change needs; after it, each one records a verdict
with evidence, or "checked, clear" with what was checked.

| If the change | Add |
|---|---|
| touches amounts, HST, freight, payments, allocations or invoice status | the `money-reviewer` agent |
| adds a table, query, screen or API route | the `invariant-auditor` agent |
| touches login, roles, secrets or an account | a security read: RLS, `canSeeMoney`, `canEdit`, no secret in code or docs |
| calls the Anthropic API | grounded prompt, plain-text output through `src/lib/aiText.ts`, money withheld from non-money roles |
| changes `.github/` or `.claude/` | read docs/LOOP_ENGINEERING.md first; these never merge on their own |
| writes a document that makes a claim | a refutation read by a session that did not write it |

Then climb: does the change work (craft); does it fail safely, restart and stay testable
(component); is it in the right place with no second copy of something that exists (area);
is it the right thing for the store at all (steer). Record one line per level.

## Basis footer

`**Basis: N claims checked this session (<date>), C confirmed, K killed, S sources.**` then
the sources named. Count only what was verified in the session that shipped it. A document
with no footer is a draft, whatever its status line says.

## Before shipping any document

1. List the claims; tag each one.
2. Open every `[R]`, run every `[V-run]`, read every `[V-src]`. Never trust the draft's
   memory of itself.
3. Anything that fails becomes `[J-open]` or `[Q]`, or is deleted.
4. Update docs/README.md and STATUS.md / VERIFICATION.md in the same change.
