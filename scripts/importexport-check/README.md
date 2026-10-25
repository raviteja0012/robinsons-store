# Checking schedule names and export paging

Two quiet ways the import and export could get the store's records wrong, neither visible to
`tsc` or the build:

- `src/lib/importSchedule.ts` `mapScheduleNames` decides which employee a schedule name
  belongs to. Two people sharing a name used to collapse to whichever row came last, so every
  "8-6 Amy" landed on one Amy. A schedule "Amy" beside a Staff "Amy Robinson" used to create
  a second Amy with no pay rate. Both are now held back with a sentence for the owner, and
  their shifts are not loaded until the names are sorted out.
- `src/lib/exportPaging.ts` `fetchAllByKey` reads a whole table in keyset pages ("id greater
  than the last one seen"). The export used offset pages, which drop a row when something
  before the cursor is deleted (shifts are hard-deleted) and repeat one when something is
  inserted.

## Running it

```sh
npx tsc -p scripts/importexport-check/tsconfig.json
cp scripts/importexport-check/check.js scripts/importexport-check/out/
node scripts/importexport-check/out/check.js
```

Runs in CI after the build. Neither module has imports, so no path rewriting is needed.

## What it asserts

- Two employees named Amy and a cell "8-6 Amy": no shift attaches to either, nobody is
  created, and the result says "Amy matches 2 employees".
- "Amy" beside only "Amy Robinson": nobody is created and the result says "Amy may be Amy
  Robinson". An initial ("Amy R.") and two possible surnames are held the same way.
- Unchanged from before: a unique exact match attaches regardless of case, a genuinely new
  name is created once however it is capitalized, and "Jo" beside "John Smith" is new.
- 1,500 rows paged 1,000 at a time with a row inserted, or deleted, before the cursor between
  pages: keyset paging returns every pre-existing id exactly once. The old offset loop runs
  beside it on the same fake and is asserted to repeat one and to drop one, so the check
  shows the difference rather than assuming it.
- Every page keeps the caller's filter (page two never reaches another store), pages are
  ordered ascending on the key with a limit of 1000, a short page stops, a database error
  throws, and rows without the key throw instead of looping.
