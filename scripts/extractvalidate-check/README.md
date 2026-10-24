# Checking the invoice reader's value checks

`src/lib/extractValidate.ts` checks the values the invoice reader returns. The schema fixes
the shape; this fixes the values: confidence in 0 to 1, non-negative finite amounts, real
calendar dates. Anything it has to coerce gets confidence 0 so it goes through the amber
acknowledgement instead of being saved quietly.

## Running it

```sh
npx tsc -p scripts/extractvalidate-check/tsconfig.json
cp scripts/extractvalidate-check/check.js scripts/extractvalidate-check/out/
node scripts/extractvalidate-check/out/check.js
```

Runs in CI after the build. The module has no imports, so no path rewriting is needed.
