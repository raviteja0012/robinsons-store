# Golden cases for the invoice reader and Ask

23 fixed cases for the two AI routes, scored without judgement calls: 11 invoices for
`/api/extract` and 12 questions for `/api/ask`. Everything in `cases/` is made up. Never
paste a real invoice, a real vendor or anything from the store's own records into it; the
CI check refuses phone numbers outside the 555-0100 to 555-0199 fiction range as a tripwire.

## Running the live evals (spends the API key)

```sh
npm run eval:ai
```

This calls the real route handlers, so the prompts, the output schema, the value checks in
`src/lib/extractValidate.ts` and the Ask context are exactly what is deployed, and every
model call goes through `src/lib/anthropic.ts`. It reads `ANTHROPIC_API_KEY` (and
`ANTHROPIC_MODEL`, if set) from the shell or `.env.local`, the same file `npm run dev`
uses. By default each case runs 3 times: 69 model calls. It prints a pass rate per case,
the checks that failed, and saves every answer under `out/live/` with the invoices it sent.

Options go after `--`:

| Option | Effect |
|---|---|
| `--runs N` | Runs per case (default 3). `--runs 1` is 23 calls. |
| `--only TEXT` | Only cases whose id contains TEXT, for example `--only ask-staff`. |
| `--offline` | No key, no network, no cost: the routes answer from the hand-written samples. Checks that the routes still load and the prompts still build. |

It never runs in CI (it exits at once when `CI` is set), never runs without a key unless
`--offline`, and never reaches a database: every Supabase setting is dropped before the app
code loads, and any request to anything but the Anthropic API is refused. The signed-in
member and the database are stood in for; the stand-in applies the route's own `store_id`
and `voided_at` filters, so store scoping and voided rows are still the route's job.

## What is checked

Extract (`scoreExtract`): vendor (company suffixes and `&` vs `and` ignored), invoice date
exactly, each expected line found by its key words, quantity exactly, unit cost and
handwritten retail price within one cent, the exact line count, no Subtotal, HST or Total
row read as a purchase, and for a returned item that the line lands in the capture
screen's amber band (confidence below 0.7, pinned to `src/app/capture/page.tsx`).

Ask (`scoreAsk`): facts that must appear (dollar amounts compared as numbers, so `$1,186.50`
and `1186.50` both count), facts and patterns that must not, no em dash, no markdown, and
no database writes unless the case expects them. For the money and store-scoping cases the
prompt the route built is checked too (`scorePrompt`), before any model reads it: a staff
prompt must contain no `$` at all, and another store's vendor must not be in it. A wording
miss can be the model's fault; a prompt miss is always the route's.

The must-not-say cases: invented vendor, a vendor that only exists in another store, a
voided invoice, dollar figures and minimum orders for staff, a weather question, a planted
instruction in a knowledge note, a planted instruction printed on an invoice, a receipt
with no vendor name, and a return line that must not read as a confident purchase.

## The CI check

```sh
npx tsc -p scripts/aievals-check/tsconfig.json
cp scripts/aievals-check/check.js scripts/aievals-check/out/
node scripts/aievals-check/out/check.js
```

No model and no key. It runs the scorers against the samples in `samples/`, written by hand
in each route's response shape (not recorded from the model), each one expected to pass or
to fail on a named check. It also checks the golden data itself: every expected line names
exactly one printed row and agrees with it, every invoice renders as a valid PDF, every
`@PHRASE` list resolves. Wired into `.github/workflows/ci.yml`.

## Adding a case

Add it to `cases/extract.json` or `cases/ask.json` with a `covers` line saying what it
protects, add at least one passing sample to `samples/`, and run the CI check. Invoice
tables state quantities and unit prices only; the renderer works out amounts and totals so
a case cannot carry an arithmetic slip. After a live run, an answer in `out/live/results-*.json`
can be pasted into `samples/` as a new sample.
