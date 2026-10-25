// Runs the real compiled /api/ask route with a fake database and a mocked fetch.
// No network call leaves this process and no API key is used.
const path = require("path");
const Module = require("module");
const OUT = __dirname; // check.js is copied into out/, next to app/ and lib/
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) {
  if (req.startsWith("@/")) req = path.join(OUT, req.slice(2));
  return origResolve.call(this, req, parent, ...rest);
};

process.env.ANTHROPIC_API_KEY = "test-key-not-real";
delete process.env.ANTHROPIC_MODEL;

// Fake Supabase: a thenable query builder over fixed rows.
const rows = {
  knowledge_note: [{ topic: "Moccasin reorders", body: "Old supplier was Laurentian Leather.", tags: ["reorder"], department: { name: "DryGoods & Lakeside" } }],
  vendor: [
    { id: "v1", name: "Pinecrest Moccasins", status: "active", default_terms: "Net 30", phone: "705-555-0101", department: { name: "DryGoods & Lakeside" } },
    { id: "v2", name: "Lakeview Candle Co", status: "active", default_terms: "Net 60", department: { name: "DryGoods & Lakeside" } }
  ],
  invoice: [{ amount: 1000, hst_amount: 130, freight_charges: 0, tax_mode: "added", due_date: "2026-09-01", status: "overdue", terms: "Net 30", vendor: { name: "Pinecrest Moccasins" } }]
};
const fakeDb = {
  from(table) {
    const q = {
      select() { return q; }, is() { return q; }, eq() { return q; }, limit() { return q; },
      maybeSingle() { return Promise.resolve({ data: null }); },
      insert() { return { select: () => ({ single: () => Promise.resolve({ data: { id: "f1" }, error: null }) }) }; },
      then(res, rej) { return Promise.resolve({ data: rows[table] || [] }).then(res, rej); }
    };
    return q;
  }
};
const smPath = Module._resolveFilename("@/lib/serverMember", module);
require.cache[smPath] = { id: smPath, filename: smPath, loaded: true, exports: {
  resolveMember: async () => ({ ok: true, client: fakeDb, member: null }),
  memberSeesMoney: () => true
} };

// Mocked fetch: records each request body and replies with the next canned answer.
const sent = [];
let reply = "";
global.fetch = async (url, init) => {
  sent.push({ url, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({
    content: [{ type: "text", text: reply }], stop_reason: "end_turn", model: "claude-sonnet-5",
    usage: { input_tokens: 40, output_tokens: 30, cache_creation_input_tokens: 2100, cache_read_input_tokens: 0 }
  }), { status: 200, headers: { "content-type": "application/json" } });
};
const logs = [];
const origLog = console.log;
console.log = (...a) => logs.push(["log", a.join(" ")]);
console.warn = (...a) => logs.push(["warn", a.join(" ")]);

const { POST } = require(path.join(OUT, "app/api/ask/route.js"));
const { UNCONFIRMED_ANSWER } = require(path.join(OUT, "lib/askGrounding.js"));
const { APP_GUIDE } = require(path.join(OUT, "lib/appGuide.js"));

let pass = 0, fail = 0;
const t = (n, c, d = "") => { c ? pass++ : fail++; origLog(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  [" + d + "]" : ""}`); };
async function ask(question, answer) {
  reply = answer;
  const req = { json: async () => ({ question, store_id: "s1" }), headers: new Headers() };
  const res = await POST(req);
  return { status: res.status, data: await res.json() };
}

(async () => {
  const q1 = "What is overdue right now?";
  const r1 = await ask(q1, "- [[Pinecrest Moccasins]]: $1,130.00, overdue, due 2026-09-01.");
  const b1 = sent[0].body;
  t("one request sent", sent.length === 1 && sent[0].url === "https://api.anthropic.com/v1/messages");
  t("system is two text blocks", Array.isArray(b1.system) && b1.system.length === 2 && b1.system.every((s) => s.type === "text"));
  t("only the app-guide system block is marked", !b1.system[0].cache_control && b1.system[1].cache_control?.type === "ephemeral");
  t("app guide is in the cached system block", b1.system[1].text.includes(APP_GUIDE.trim().slice(0, 60)));
  const c = b1.messages[0].content;
  t("user turn is two blocks", Array.isArray(c) && c.length === 2);
  t("store-data block is marked", c[0].cache_control?.type === "ephemeral" && c[0].text.startsWith("<store_data>") && c[0].text.endsWith("</store_data>"));
  t("store data carries vendors and invoices", c[0].text.includes("- Pinecrest Moccasins [") && c[0].text.includes("INVOICES"));
  t("question is not in any cached block", !c[0].text.includes(q1) && !b1.system.some((s) => s.text.includes(q1)));
  t("question block is unmarked and last", !c[1].cache_control && c[1].text.includes(`<question>\n${q1}\n</question>`));
  t("app guide not inside store data", !c[0].text.includes("APP GUIDE"));
  t("no sampling params sent", !("temperature" in b1) && !("top_p" in b1) && !("top_k" in b1));
  t("two cache markers in total", JSON.stringify(b1).split('"cache_control"').length - 1 === 2);
  t("grounded answer returned without brackets", r1.status === 200 && r1.data.answer === "- Pinecrest Moccasins: $1,130.00, overdue, due 2026-09-01." && !r1.data.unconfirmed, JSON.stringify(r1.data));

  const okLog = logs.find(([k, l]) => k === "log" && l.includes('"ai_call":"ask"'));
  t("call log has both cache counts", okLog && okLog[1].includes('"cache_creation_input_tokens":2100') && okLog[1].includes('"cache_read_input_tokens":0'), okLog && okLog[1]);
  t("call log has no prompt or answer text", okLog && !okLog[1].includes("Pinecrest") && !okLog[1].includes("overdue right now"));

  // A second, different question: everything before the question must be byte-identical.
  const r2 = await ask("Who do I call for candles?", "Call [[Lakeview Candle Co]].");
  const b2 = sent[1].body;
  t("system identical across questions", JSON.stringify(b2.system) === JSON.stringify(b1.system));
  t("store-data block identical across questions", JSON.stringify(b2.messages[0].content[0]) === JSON.stringify(c[0]));
  t("second grounded answer passes", r2.data.answer === "Call Lakeview Candle Co." && !r2.data.unconfirmed);

  // Made-up vendor: withheld, flagged, logged as a count only.
  logs.length = 0;
  const r3 = await ask("Who do I call to reorder moccasins?", "Call [[Manitobah Mukluks]] at 705-555-0199.");
  t("made-up vendor answer withheld", r3.status === 200 && r3.data.answer === UNCONFIRMED_ANSWER && r3.data.unconfirmed === true, JSON.stringify(r3.data));
  const warn = logs.find(([k, l]) => k === "warn" && l.includes("unconfirmed_vendor"));
  t("withheld answer logged as a count", warn && warn[1].includes('"count":1'));
  t("log never names the vendor", !logs.some(([, l]) => l.includes("Manitobah")));

  // The question excuses "not on file", never invented facts about a name it supplies.
  const r4 = await ask("Do we buy from Costco?", "[[Costco]] is not on file.");
  t("name from the question passes with no figures", r4.data.answer === "Costco is not on file." && !r4.data.unconfirmed);
  const r4b = await ask("What are Northern Mukluk Co's terms and phone?", "[[Northern Mukluk Co]] is on Net 30, phone 705-555-0199.");
  t("invented facts for a name from the question withheld", r4b.data.unconfirmed === true);

  // The route's own note goes after the cached blocks, never inside the store data.
  const r5 = await ask("log this issue: the scanner is broken", "Nothing was logged; use the Suggestions screen.");
  const b5 = sent[sent.length - 1].body.messages[0].content;
  t("route note sits in the question block", b5[1].text.startsWith("NOTE TO ASSISTANT") && !b5[0].text.includes("NOTE TO ASSISTANT"));
  t("store-data block unchanged by the note", JSON.stringify(b5[0]) === JSON.stringify(c[0]));
  t("app answer passes", r5.data.answer === "Nothing was logged; use the Suggestions screen." && !r5.data.unconfirmed);

  origLog(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { origLog("CRASH", e); process.exit(1); });
