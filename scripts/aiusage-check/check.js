// The ai_call log and the daily cap, run through the real callClaude with fetch and the
// Supabase client both mocked. No network, no database, no model call.
const { callClaude, failureMessage } = require("./anthropic.js");
const { dailyCap, DEFAULT_DAILY_CAP, outcomeOf } = require("./aiUsage.js");

// AbortSignal.timeout does not hold the event loop open, so without this the hung-database
// case lets node drain and exit 0 halfway through. A run that never reaches the summary fails.
process.exitCode = 1;
const keepAlive = setInterval(() => {}, 1000);

let pass = 0, fail = 0;
const t = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  [" + d + "]" : ""}`); };

// Quiet the client's own metadata log, but keep it so the warnings can be asserted.
const logged = [];
console.warn = (s) => logged.push(String(s));
const realLog = console.log;
console.log = (s, ...rest) => (String(s).startsWith("{") ? logged.push(String(s)) : realLog(s, ...rest));

let fetchCalls = 0;
let responder = () => ok();
global.fetch = async (_url, init) => { fetchCalls++; return responder(init); };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const USAGE = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 };
const ANSWER = "Orgill is due Friday.";
const ok = () => reply(200, { model: "claude-sonnet-5", stop_reason: "end_turn", content: [{ type: "text", text: ANSWER }], usage: USAGE });

// Mimics the two supabase-js calls aiUsage makes: rpc(...).abortSignal(s) and
// from(t).insert(row).abortSignal(s), each awaited for { data, error }.
function fakeDb({ count = 0, rpcError = null, insertError = null, hang = false } = {}) {
  const db = { rpcCalls: [], inserts: [] };
  const settle = (value) => ({
    abortSignal: (signal) =>
      hang ? new Promise((_res, rej) => signal.addEventListener("abort", () => rej(signal.reason))) : Promise.resolve(value)
  });
  db.rpc = (fn, args) => { db.rpcCalls.push({ fn, args }); return settle({ data: rpcError ? null : count, error: rpcError }); };
  db.from = (table) => ({ insert: (row) => { db.inserts.push({ table, row }); return settle({ data: null, error: insertError }); } });
  return db;
}

const PROMPT = "What do we owe Orgill?";
const call = (scope, extra = {}) => callClaude({ route: "ask", max_tokens: 100, messages: [{ role: "user", content: PROMPT }], scope, ...extra });

(async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.AI_DAILY_CAP_PER_STORE;

  // The cap value.
  t("default cap is 100", dailyCap() === 100 && DEFAULT_DAILY_CAP === 100);
  process.env.AI_DAILY_CAP_PER_STORE = "25";
  t("env sets the cap", dailyCap() === 25);
  for (const bad of ["0", "-3", "abc", "2.5", ""]) {
    process.env.AI_DAILY_CAP_PER_STORE = bad;
    t(`env "${bad}" falls back to the default`, dailyCap() === DEFAULT_DAILY_CAP);
  }
  delete process.env.AI_DAILY_CAP_PER_STORE;

  // No scope: the call runs exactly as before, with no database involved.
  fetchCalls = 0;
  let r = await call(undefined);
  t("no scope: call made, answer returned", r.ok && r.text === ANSWER && fetchCalls === 1);

  // Under the cap: counted first, called, one metadata row written.
  let db = fakeDb({ count: 5 });
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("under cap: model called once", r.ok && fetchCalls === 1);
  t("under cap: today's count asked for this store", db.rpcCalls.length === 1 && db.rpcCalls[0].fn === "ai_calls_today" && db.rpcCalls[0].args.p_store_id === "store-1");
  const row = db.inserts[0]?.row || {};
  t("one row into ai_call", db.inserts.length === 1 && db.inserts[0].table === "ai_call");
  t("row: store, route, model, outcome", row.store_id === "store-1" && row.route === "ask" && row.model === "claude-sonnet-5" && row.outcome === "ok" && row.failure_kind === null);
  t("row: all four token counts", row.input_tokens === 1200 && row.output_tokens === 300 && row.cache_read_tokens === 1000 && row.cache_write_tokens === 50);
  t("row: duration is a number", typeof row.duration_ms === "number");
  const keys = Object.keys(row).sort().join(",");
  t("row carries metadata only", keys === "cache_read_tokens,cache_write_tokens,duration_ms,failure_kind,input_tokens,model,outcome,output_tokens,route,store_id", keys);
  t("row holds neither prompt nor answer", !JSON.stringify(row).includes(PROMPT) && !JSON.stringify(row).includes(ANSWER));

  // At the cap: no model call, a capped row, a plain message.
  db = fakeDb({ count: 100 });
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("at cap: no model call", fetchCalls === 0);
  t("at cap: result is capped", !r.ok && r.kind === "capped");
  const cappedRow = db.inserts[0]?.row || {};
  t("at cap: capped row with no tokens", db.inserts.length === 1 && cappedRow.outcome === "capped" && cappedRow.input_tokens === null && cappedRow.output_tokens === null);
  const msg = failureMessage("capped");
  t("capped message is plain and says when it resets", /tomorrow/.test(msg) && /owner/.test(msg) && !msg.includes(String.fromCharCode(0x2014)) && !msg.includes("cap"), msg);

  // The env cap applies at the boundary.
  process.env.AI_DAILY_CAP_PER_STORE = "3";
  fetchCalls = 0;
  r = await call({ db: fakeDb({ count: 2 }), storeId: "store-1" });
  t("env cap 3, count 2: allowed", r.ok && fetchCalls === 1);
  fetchCalls = 0;
  r = await call({ db: fakeDb({ count: 3 }), storeId: "store-1" });
  t("env cap 3, count 3: capped", !r.ok && r.kind === "capped" && fetchCalls === 0);
  delete process.env.AI_DAILY_CAP_PER_STORE;

  // Fails open: a missing table, a refused insert, or a hung database never blocks the call.
  logged.length = 0;
  db = fakeDb({ rpcError: { message: 'relation "public.ai_call" does not exist' } });
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("count error: call still made", r.ok && fetchCalls === 1);
  t("count error: warning logged", logged.some((l) => l.includes("cap_check_skipped")));
  logged.length = 0;
  r = await call({ db: fakeDb({ insertError: { message: "new row violates row-level security policy" } }), storeId: "store-1" });
  t("insert refused: answer still returned", r.ok && r.text === ANSWER);
  t("insert refused: warning logged", logged.some((l) => l.includes("log_skipped")));
  const started = Date.now();
  fetchCalls = 0;
  r = await call({ db: fakeDb({ hang: true }), storeId: "store-1" });
  const waited = Date.now() - started;
  // Two database calls, 1.5s budget each: the person waits at most about 3s more.
  t("hung database: gives up and calls anyway", r.ok && fetchCalls === 1 && waited < 4000, `${waited} ms`);

  // Each way a call ends gets its outcome; refusals and cut-offs keep their tokens.
  responder = () => reply(200, { model: "claude-sonnet-5", stop_reason: "refusal", content: [], usage: { input_tokens: 800, output_tokens: 5 } });
  db = fakeDb();
  r = await call({ db, storeId: "store-1" });
  t("refusal: refused row with tokens", !r.ok && db.inserts[0]?.row.outcome === "refused" && db.inserts[0]?.row.input_tokens === 800);
  responder = () => reply(200, { model: "claude-sonnet-5", stop_reason: "max_tokens", content: [{ type: "text", text: "half" }], usage: { input_tokens: 900, output_tokens: 100 } });
  db = fakeDb();
  r = await call({ db, storeId: "store-1" });
  t("max_tokens: cut_off row with output tokens", !r.ok && db.inserts[0]?.row.outcome === "cut_off" && db.inserts[0]?.row.output_tokens === 100);
  responder = () => reply(400, { error: { message: "bad" } });
  db = fakeDb();
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("400: one failed row, kind kept, not retried", fetchCalls === 1 && db.inserts.length === 1 && db.inserts[0].row.outcome === "failed" && db.inserts[0].row.failure_kind === "bad_request");
  responder = (init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)));
  db = fakeDb();
  r = await call({ db, storeId: "store-1" }, { timeoutMs: 50 });
  t("timeout: failed row, kind timeout", !r.ok && db.inserts[0]?.row.outcome === "failed" && db.inserts[0]?.row.failure_kind === "timeout");
  t("overloaded maps to failed", outcomeOf({ ok: false, kind: "overloaded", detail: "", model: "m", ms: 0 }) === "failed");
  responder = () => ok();

  // No store, or no key: nothing counted, nothing written.
  db = fakeDb({ count: 1000 });
  fetchCalls = 0;
  r = await call({ db, storeId: null });
  t("no store: not counted, not written, call made", r.ok && fetchCalls === 1 && db.rpcCalls.length === 0 && db.inserts.length === 0);
  delete process.env.ANTHROPIC_API_KEY;
  db = fakeDb();
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("no key: no call, no count, no row", !r.ok && r.kind === "no_key" && fetchCalls === 0 && db.rpcCalls.length === 0 && db.inserts.length === 0);

  clearInterval(keepAlive);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
