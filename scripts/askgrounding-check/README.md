# Checking the Ask grounding check

`src/lib/askGrounding.ts` checks every vendor an Ask answer names against what `/api/ask`
put in the prompt: the vendor and invoice lines, the knowledge notes, the app guide, and the
question. One name that matches nothing withholds the whole answer, and the screen shows
"I could not confirm that answer from the store's records" with a "Not confirmed" chip.

The prompt asks the model to wrap each vendor name in `[[ ]]`, which the check reads and then
removes. Unwrapped text is checked only for names with a legal suffix (Inc, Ltd, Co) or names
straight after "vendor", "supplier", or "order from". Other capitalised words are left alone
so a good answer is not withheld for naming Ontario or a screen.

## Running it

```sh
npx tsc -p scripts/askgrounding-check/tsconfig.json
cp scripts/askgrounding-check/check.js scripts/askgrounding-check/out/
node scripts/askgrounding-check/out/check.js
```

Runs in CI after the build. The module has no imports, so no path rewriting is needed.

## What it proves

- Real vendors pass however the answer writes them: case, accents, possessives, `&` or `+`
  or `and`, plurals, `Co` vs `Company` vs no suffix, `GGS` vs `G.G.S`.
- A supplier named only in a knowledge note passes, and so does a name the person typed
  ("Costco is not on file").
- A made-up vendor fails, wrapped or not, and one made-up name among real ones fails the
  whole answer.
- A piece of a real name cannot carry a made-up one ("Hudson Leather" against "Hudson's Bay
  Company"), and two names in one sentence are checked separately.
- App answers, places, taxes and screen names pass untouched, and the brackets never reach
  the screen.
