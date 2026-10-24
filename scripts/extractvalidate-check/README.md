# Checking the invoice reader's value checks and the capture line rules

`src/lib/extractValidate.ts` checks the values the invoice reader returns. The schema fixes
the shape; this fixes the values: confidence in 0 to 1, non-negative finite amounts, real
calendar dates. Anything it has to coerce gets confidence 0 so it goes through the amber
acknowledgement instead of being saved quietly.

`src/lib/captureLines.ts` holds the capture screen's line rules. Only a retyped unit cost
clears an amber line; fixing a description or qty does not. When the role cannot see money,
an amber line is saved with no unit cost, so staff never post a cost they could not check.

## Running it

```sh
npx tsc -p scripts/extractvalidate-check/tsconfig.json
cp scripts/extractvalidate-check/check.js scripts/extractvalidate-check/out/
node scripts/extractvalidate-check/out/check.js
```

Runs in CI after the build. Neither module has a runtime import (captureLines imports a type
only, which compiles away), so no path rewriting is needed.
