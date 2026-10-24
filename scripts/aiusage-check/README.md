# Checking the AI call log and the daily cap

`src/lib/aiUsage.ts` reserves one `ai_call` row before each model call
(`ai_call_begin`, which refuses once the store has made `AI_DAILY_CAP_PER_STORE` calls
today, default 100) and fills it in after (`ai_call_finish`). `callClaude` in
`src/lib/anthropic.ts` is the only caller.

## The client, with fetch and Supabase mocked

```sh
npx tsc -p scripts/aiusage-check/tsconfig.json
cp scripts/aiusage-check/check.js scripts/aiusage-check/out/
node scripts/aiusage-check/out/check.js
```

Runs in CI after the build. No network, no database, no model call. Covers the cap value
and its env override, the capped path making no model call, what reaches the database
(metadata only), every outcome, and failing open on a missing function, a refused finish
or a hung database. The hung-database case takes about 1.5 seconds on purpose.

## The SQL, on a throwaway Postgres

```sh
bash scripts/aiusage-check/pg/run.sh "$PWD" "$PWD/scripts/aiusage-check/pg"
```

Needs Docker and the `postgres:16` image. Never points at Supabase: it starts a local
container, stubs the parts of Supabase the scripts use (`auth.uid()`, `auth.users`, the
`anon` and `authenticated` roles, `storage`), and removes the container when it ends. It
runs `schema.sql` and `ai_call.sql`, the per-store lock (a second caller must wait for the
first and then be refused the last slot), a burst of 20 simultaneous reservations against a
cap of 5 (pgbench), `auth_setup.sql` and both scripts again, then the live path: an
enforced database that has never had the table. Every check prints `| t`; any `| f` or
error is a failure.
