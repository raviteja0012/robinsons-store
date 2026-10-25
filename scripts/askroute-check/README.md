# Checking the Ask route wiring

`scripts/askgrounding-check` tests the grounding function on its own. This runs the real
compiled `/api/ask` route with a fake database and a mocked `fetch`, to check how the route
uses it: the two cache markers, the question kept out of the cached blocks, the cached blocks
byte-identical across two questions, the route note outside the store data, a withheld answer
returned with `unconfirmed: true`, and log lines that carry the cache counts and never the
prompt or the answer.

No network call leaves the process and no real API key is used.

## Running it

```sh
npx tsc -p scripts/askroute-check/tsconfig.json
cp scripts/askroute-check/check.js scripts/askroute-check/out/
node scripts/askroute-check/out/check.js
```

Not in CI. Run it by hand whenever `src/app/api/ask/route.ts` changes. The `out/` folder is
ignored by the root `.gitignore`.
