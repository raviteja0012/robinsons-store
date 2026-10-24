// The ai_call log and the daily cap, run through the real callClaude with fetch and the
// Supabase client both mocked. No network, no database, no model call. The lock that keeps
// parallel calls under the cap lives in SQL and is checked in pg/ instead.
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

// Mimics supabase-js rpc(...).abortSignal(s), awaited for { data, error }, and the two
// functions' contracts: ai_call_begin answers {allowed, id} from how many calls the store has
// used against p_cap; ai_call_finish takes the id and the outcome.
function fakeDb({ used = 0, beginError = null, finishError = null, hang = false } = {}) {
  const db = { begins: [], finishes: [], used };
  const settle = (value) => ({
    abortSignal: (signal) =>
      hang ? new Promise((_res, rej) => signal.addEventListener("abort", () => rej(signal.reason))) : Promise.resolve(value)
  });
  db.rpc = (fn, args) => {
    if (fn === "ai_call_begin") {
      db.begins.push(args);
      if (beginError) return settle({ data: null, error: beginError });
      if (db.used >= args.p_cap) return settle({ data: { allowed: false, id: null }, error: null });
      db.used++;
      return settle({ data: { allowed: true, id: `call-${db.used}` }, error: null });
    }
    if (fn === "ai_call_finish") {
      db.finishes.push(args);
      return settle({ data: null, error: finishError });
    }
    return settle({ data: null, error: { message: `unexpected rpc ${fn}` } });
  };
  db.from = () => { throw new Error("aiUsage must not write the table directly"); };
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

  // Under the cap: reserved first, called, then finished with metadata only.
  let db = fakeDb({ used: 5 });
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("under cap: model called once", r.ok && fetchCalls === 1);
  const b = db.begins[0] || {};
  t("under cap: reserved for this store, route, model and cap", db.begins.length === 1 && b.p_store_id === "store-1" && b.p_route === "ask" && b.p_model === "claude-sonnet-5" && b.p_cap === 100);
  const f = db.finishes[0] || {};
  t("finished once, on the reserved row", db.finishes.length === 1 && f.p_id === "call-6");
  t("finish: outcome, model, no failure kind", f.p_outcome === "ok" && f.p_model === "claude-sonnet-5" && f.p_failure_kind === null);
  t("finish: all four token counts", f.p_input_tokens === 1200 && f.p_output_tokens === 300 && f.p_cache_read_tokens === 1000 && f.p_cache_write_tokens === 50);
  t("finish: duration is a number", typeof f.p_duration_ms === "number");
  const keys = Object.keys(f).sort().join(",");
  t("finish carries metadata only", keys === "p_cache_read_tokens,p_cache_write_tokens,p_duration_ms,p_failure_kind,p_id,p_input_tokens,p_model,p_outcome,p_output_tokens", keys);
  const sent = JSON.stringify([db.begins, db.finishes]);
  t("database never sees the prompt or the answer", !sent.includes(PROMPT) && !sent.includes(ANSWER));

  // At the cap: no model call, nothing to finish, a plain message.
  db = fakeDb({ used: 100 });
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("at cap: no model call", fetchCalls === 0);
  t("at cap: result is capped", !r.ok && r.kind === "capped");
  t("at cap: nothing finished (begin already wrote the capped row)", db.finishes.length === 0);
  const msg = failureMessage("capped");
  t("capped message is plain and says when it resets", /tomorrow/.test(msg) && /owner/.test(msg) && !msg.includes(String.fromCharCode(0x2014)) && !msg.includes("cap"), msg);

  // The env cap reaches the database and applies at the boundary.
  process.env.AI_DAILY_CAP_PER_STORE = "3";
  db = fakeDb({ used: 2 });
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("env cap 3, used 2: allowed, cap passed through", r.ok && fetchCalls === 1 && db.begins[0].p_cap === 3);
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("env cap 3, used 3: capped", !r.ok && r.kind === "capped" && fetchCalls === 0);
  delete process.env.AI_DAILY_CAP_PER_STORE;

  // Fails open: a missing function, a refused finish, or a hung database never blocks the call.
  logged.length = 0;
  db = fakeDb({ beginError: { message: "Could not find the function public.ai_call_begin" } });
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("reserve error: call still made", r.ok && fetchCalls === 1);
  t("reserve error: nothing to finish", db.finishes.length === 0);
  t("reserve error: warning logged", logged.some((l) => l.includes("cap_check_skipped")));
  logged.length = 0;
  r = await call({ db: fakeDb({ finishError: { message: "permission denied for function ai_call_finish" } }), storeId: "store-1" });
  t("finish error: answer still returned", r.ok && r.text === ANSWER);
  t("finish error: warning logged", logged.some((l) => l.includes("log_skipped")));
  const started = Date.now();
  fetchCalls = 0;
  r = await call({ db: fakeDb({ hang: true }), storeId: "store-1" });
  const waited = Date.now() - started;
  // A hung reserve returns no id, so there is no finish to wait on: one 1.5s budget.
  t("hung database: gives up and calls anyway", r.ok && fetchCalls === 1 && waited < 2500, `${waited} ms`);

  // Each way a call ends gets its outcome; refusals and cut-offs keep their tokens.
  responder = () => reply(200, { model: "claude-sonnet-5", stop_reason: "refusal", content: [], usage: { input_tokens: 800, output_tokens: 5 } });
  db = fakeDb();
  r = await call({ db, storeId: "store-1" });
  t("refusal: finished as refused with tokens", !r.ok && db.finishes[0]?.p_outcome === "refused" && db.finishes[0]?.p_input_tokens === 800);
  responder = () => reply(200, { model: "claude-sonnet-5", stop_reason: "max_tokens", content: [{ type: "text", text: "half" }], usage: { input_tokens: 900, output_tokens: 100 } });
  db = fakeDb();
  r = await call({ db, storeId: "store-1" });
  t("max_tokens: finished as cut_off with output tokens", !r.ok && db.finishes[0]?.p_outcome === "cut_off" && db.finishes[0]?.p_output_tokens === 100);
  responder = () => reply(400, { error: { message: "bad" } });
  db = fakeDb();
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("400: one failed finish, kind kept, not retried", fetchCalls === 1 && db.finishes.length === 1 && db.finishes[0].p_outcome === "failed" && db.finishes[0].p_failure_kind === "bad_request");
  responder = (init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)));
  db = fakeDb();
  r = await call({ db, storeId: "store-1" }, { timeoutMs: 50 });
  t("timeout: failed finish, kind timeout", !r.ok && db.finishes[0]?.p_outcome === "failed" && db.finishes[0]?.p_failure_kind === "timeout");
  t("overloaded maps to failed", outcomeOf({ ok: false, kind: "overloaded", detail: "", model: "m", ms: 0 }) === "failed");
  responder = () => ok();

  // No store, or no key: nothing reserved, nothing finished.
  db = fakeDb({ used: 1000 });
  fetchCalls = 0;
  r = await call({ db, storeId: null });
  t("no store: not reserved, not finished, call made", r.ok && fetchCalls === 1 && db.begins.length === 0 && db.finishes.length === 0);
  delete process.env.ANTHROPIC_API_KEY;
  db = fakeDb();
  fetchCalls = 0;
  r = await call({ db, storeId: "store-1" });
  t("no key: no call, nothing reserved", !r.ok && r.kind === "no_key" && fetchCalls === 0 && db.begins.length === 0 && db.finishes.length === 0);

  clearInterval(keepAlive);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
