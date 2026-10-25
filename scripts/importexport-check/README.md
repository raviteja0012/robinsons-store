# Checking schedule names and export paging

Two quiet ways the import and export could get the store's records wrong, neither visible to
`tsc` or the build. The check runs the same functions the routes call, not copies of them:

- `src/lib/scheduleLoad.ts` `planScheduleLoad` is the schedule upload's database side, called
  by `src/app/api/import/route.ts`. It decides who each name is through `mapScheduleNames`
  (`src/lib/importSchedule.ts`). Two people sharing a name used to collapse to whichever row
  came last, so every "8-6 Amy" landed on one Amy. A schedule "Amy" beside a Staff "Amy
  Robinson" used to create a second Amy with no pay rate. Both are now held back with a
  sentence for the owner, and their shifts are not loaded until the names are sorted out.
- `src/lib/exportPaging.ts` `readTable` is the export's per-table read, called by
  `src/app/api/export/route.ts`. It reads in keyset pages ("id greater than the last one
  seen") through `fetchAllByKey`. The export used offset pages, which drop a row when
  something before the cursor is deleted (shifts are hard-deleted) and repeat one when
  something is inserted.

## Running it

```sh
npx tsc -p scripts/importexport-check/tsconfig.json
cp scripts/importexport-check/check.js scripts/importexport-check/out/
node scripts/importexport-check/out/check.js
```

Runs in CI after the build. `scheduleLoad.ts` imports its two neighbours by relative path, so
the compiled files run as they are, with no alias rewriting.

## The fake database

`check.js` carries a small stand-in for the Supabase client: `from(table)` with `select`,
`eq`, `is`, `in`, `gt`, `order`, `limit` and `insert`. Like Supabase it answers at most 1000
rows per request, so an unpaged read comes back short. `.range()` throws, so offset paging
cannot come back unnoticed. A hook runs between requests to land somebody else's insert or
delete mid-read.

## What it asserts

- Two employees named Amy and a cell "8-6 Amy": no shift loads, nobody is created, and the
  import message says "Amy matches 2 employees".
- "Amy" beside only "Amy Robinson": nobody is created, no shift loads, and the message says
  "Amy may be Amy Robinson". An initial ("Amy R.") and two possible surnames are held the
  same way.
- Only this store's employees that are not deleted are candidates. A genuinely new name is
  created once, in this store, and its shifts attach to it. A re-upload with 1,200 shifts on
  file loads nothing twice. A failed employee read stops the import.
- 1,500 rows read through `readTable` with a row inserted, or deleted, before the cursor
  between pages: every pre-existing id comes back exactly once. Every page keeps the route's
  store filter, pages are ordered ascending on id with a limit of 1000, and a database error
  names the table.
- Paging edges: a full page asks once more, a short page stops, rows without the key throw
  instead of looping.

Putting back any one of the old pieces fails it: offset paging in `readTable` (5 failures),
the old lowercase name map in `planScheduleLoad` (5), or the old unpaged duplicate-shift read
(2). A route that stopped calling these functions would not be caught here.
