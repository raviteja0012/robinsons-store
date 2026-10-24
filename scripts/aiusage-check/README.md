# Checking the AI call log and the daily cap

`src/lib/aiUsage.ts` writes one `ai_call` row per model call and refuses a call once the
store has made `AI_DAILY_CAP_PER_STORE` calls today (default 100). `callClaude` in
`src/lib/anthropic.ts` is the only caller.

## The client, with fetch and Supabase mocked

```sh
npx tsc -p scripts/aiusage-check/tsconfig.json
cp scripts/aiusage-check/check.js scripts/aiusage-check/out/
node scripts/aiusage-check/out/check.js
```

Runs in CI after the build. No network, no database, no model call. Covers the cap value
and its env override, the capped path making no model call, the row's columns (metadata
only), every outcome, and failing open on a missing table, a refused insert or a hung
database. The hung-database case takes about 3 seconds on purpose.

## The SQL, on a throwaway Postgres

```sh
bash scripts/aiusage-check/pg/run.sh "$PWD" "$PWD/scripts/aiusage-check/pg"
```

Needs Docker and the `postgres:16` image. Never points at Supabase: it starts a local
container, stubs the parts of Supabase the scripts use (`auth.uid()`, `auth.users`, the
`anon` and `authenticated` roles, `storage`), and removes the container when it ends. It
runs `schema.sql`, `ai_call.sql`, `auth_setup.sql` and `ai_call.sql` again, then the live
path: an enforced database that has never had the table. Every check prints `| t`; any
`| f` or error is a failure.
