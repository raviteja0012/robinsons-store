# Checking the Ask grounding check

`src/lib/askGrounding.ts` checks every vendor an Ask answer names against what `/api/ask`
put in the prompt: the vendor and invoice lines, the knowledge notes, and the app guide. One
name that matches nothing withholds the whole answer, and the screen shows "I could not
confirm that answer from the store's records" with a "Not confirmed" chip.

The prompt asks the model to wrap each vendor name in `[[ ]]`, which the check reads and then
removes. Unwrapped text is checked only for names with a legal suffix (Inc, Ltd, Co), names
straight after "vendor", "supplier", or "order from", and names after a broken `[[`. Other
capitalised words are left alone so a good answer is not withheld for naming Ontario or a
screen. That also means an unwrapped made-up name with neither shape is not caught; the
check pins that limit so it stays visible.

## Running it

```sh
npx tsc -p scripts/askgrounding-check/tsconfig.json
cp scripts/askgrounding-check/check.js scripts/askgrounding-check/out/
node scripts/askgrounding-check/out/check.js
```

Runs in CI after the build. The module has no imports, so no path rewriting is needed. The
`out/` folder is ignored by the root `.gitignore`.

## What it proves

- Real vendors pass however the answer writes them: case, accents, possessives, `&` or `+`
  or `and`, plurals, `GGS` vs `G.G.S`. Legal suffixes (`Co` vs `Company` vs none) are
  ignored only when matching a listed vendor; anywhere else a name must appear as written.
- A supplier named only in a knowledge note passes when the answer writes it as the note
  does.
- A made-up vendor fails when wrapped, or unwrapped with a legal suffix or after a vendor
  cue. A name assembled from words in the question, the app guide or the store data fails
  ("Muskoka Chair Company" when the person asked about Muskoka chairs).
- A one-word wrapped name must be a word of a listed vendor: a town or a department fails.
- The question only excuses a name in an answer with no digits, so "Costco is not on file"
  passes and invented terms or a phone number for a vendor the person named do not.
- One made-up name among real ones fails the whole answer. A tail like "Candle Co" or a
  head like "Pinecrest" cannot carry a made-up name, and names joined by "and" or "or"
  after a vendor cue are each checked.
- Months, weekdays, "I", and a new line after a heading do not withhold a correct answer.
- App answers, places and screen names pass untouched, and the brackets never reach the
  screen.
