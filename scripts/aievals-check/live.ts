// The live run: the golden cases through the real /api/extract and /api/ask route handlers,
// so the prompts, the schema, the value checks and the context building are the deployed
// ones, and every model call goes through src/lib/anthropic.ts. Only two things are stood in
// for: the signed-in member (resolveMember) and the database, which serves the synthetic
// rows in cases/store.json and applies the route's own store_id and voided_at filters.
//
// It spends the store's API key, so it refuses to run in CI and refuses to run without a
// key. --offline swaps the network for the hand-written samples, which checks the plumbing
// (routes load, prompts build, scorers score) at no cost and with no key.

import fs from "fs";
import path from "path";
import Module from "module";
import { NextRequest } from "next/server";
import { loadEnvConfig } from "@next/env";
import { scoreExtract, scoreAsk, scorePrompt, expandPhrases, type Check, type Score, type RouteOutput } from "./score";
import { renderPdf } from "./pdf";

// Compiled to out/live/scripts/aievals-check/live.js; the app code lands in out/live/src.
const OUT = path.resolve(__dirname, "../..");
const SRC = path.join(OUT, "src");
const HERE = path.resolve(OUT, "../..");
const REPO = path.resolve(HERE, "../..");

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const OFFLINE = args.includes("--offline");
const RUNS = Math.max(1, Math.floor(Number(option("--runs") || 3)));
const ONLY = option("--only");

if (process.env.CI) {
  console.log("Skipped: the live evals spend the store's API key and never run in CI.");
  process.exit(0);
}

// The same files `next dev` reads, so a working local setup needs nothing extra. Then every
// database setting is dropped: this run talks to the model and to nothing else.
loadEnvConfig(REPO);
for (const k of Object.keys(process.env)) if (k.includes("SUPABASE")) delete process.env[k];
if (OFFLINE) {
  process.env.ANTHROPIC_API_KEY = "offline"; // never sent: fetch is replaced below
} else if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Put it in .env.local (the file `npm run dev` uses) or the shell, or run with --offline to check the plumbing for free.");
  process.exit(1);
}

// The routes import "@/lib/..."; tsc leaves those specifiers alone, so map them here.
const M = Module as any;
const resolveFilename = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  return resolveFilename.call(this, request.startsWith("@/") ? path.join(SRC, request.slice(2)) : request, ...rest);
};

// ---------- the network ----------

// Only the Anthropic API is reachable. Anything else (the database client, above all) is
// refused outright rather than allowed to wander off to a real service.
type Sent = { system: string; text: string };
let sent: Sent | null = null;
let canned = "";
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (!url.startsWith("https://api.anthropic.com/")) throw new Error(`the eval run refused a request to ${url}`);
  calls++;
  const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
  const text = (body.messages || [])
    .flatMap((m: any) => (typeof m.content === "string" ? [m.content] : (m.content || []).filter((p: any) => p.type === "text").map((p: any) => p.text)))
    .join("\n");
  sent = { system: typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? ""), text };
  if (!OFFLINE) return realFetch(input, init);
  return new Response(JSON.stringify({ model: "offline", stop_reason: "end_turn", content: [{ type: "text", text: canned }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}) as typeof fetch;

// ---------- the stand-in database and member ----------

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
function resolveDates(v: any): any {
  if (typeof v === "string") return v.replace(/\{today([+-]\d+)\}/g, (_, d) => day(Number(d)));
  if (Array.isArray(v)) return v.map(resolveDates);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveDates(x)]));
  return v;
}

const ignored = new Set<string>();
function fakeDb(tables: Record<string, any[]>, writes: string[]) {
  const from = (table: string) => {
    const filters: ((r: any) => boolean)[] = [];
    let inserted: any = null;
    let single = false;
    const q: any = {
      select: () => q,
      eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), q),
      is: (col: string, val: unknown) => (filters.push((r) => (r[col] ?? null) === val), q),
      limit: () => q,
      order: () => q,
      maybeSingle: () => ((single = true), q),
      single: () => ((single = true), q),
      insert: (row: any) => {
        writes.push(table);
        inserted = { id: `eval-${table}-${writes.length}`, ...row };
        return q;
      },
      update: () => (writes.push(table), q),
      upsert: () => (writes.push(table), q),
      delete: () => (writes.push(table), q),
      then: (ok: any, bad: any) => {
        const rows = inserted ? [inserted] : (tables[table] || []).filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(ok, bad);
      }
    };
    // A query method this stand-in does not know is ignored, and said so once: the run goes
    // on, but a new filter in a route is visible instead of silently returning every row.
    return new Proxy(q, {
      get(target, prop) {
        if (prop in target || typeof prop !== "string") return target[prop as any];
        if (!ignored.has(prop)) {
          ignored.add(prop);
          process.stderr.write(`  note: the stand-in database ignored .${prop}() on ${table}\n`);
        }
        return () => target;
      }
    });
  };
  return { from, rpc: () => Promise.resolve({ data: null, error: null }) };
}

const serverMember = require(path.join(SRC, "lib/serverMember.js"));
let current: { db: unknown; member: { id: string; store_id: string; role: string } } | null = null;
const standIn = async () => (current ? { ok: true, client: current.db, member: current.member } : { ok: false, status: 500, message: "no member set" });
serverMember.resolveMember = standIn;
if (serverMember.resolveMember !== standIn) throw new Error("could not stand in for resolveMember; this harness needs updating");

type Route = { POST: (req: NextRequest) => Promise<Response> };
const extractRoute: Route = require(path.join(SRC, "app/api/extract/route.js"));
const askRoute: Route = require(path.join(SRC, "app/api/ask/route.js"));
const { claudeModel } = require(path.join(SRC, "lib/anthropic.js"));

async function post(route: Route, url: string, payload: unknown): Promise<RouteOutput> {
  // The routes log one metadata line per call; keep the eval's own output readable.
  const log = console.log;
  const warn = console.warn;
  console.log = console.warn = () => {};
  try {
    const res = await route.POST(new NextRequest(url, { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } }));
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

// ---------- the run ----------

const read = (p: string) => JSON.parse(fs.readFileSync(path.join(HERE, p), "utf8"));
const extractCases: any[] = read("cases/extract.json").cases;
const askFile = read("cases/ask.json");
const store = read("cases/store.json");
const samples: any[] = [...read("samples/extract.json").samples, ...read("samples/ask.json").samples];
const idealFor = (id: string) => samples.find((s) => s.case === id && s.expect === "pass");

type Job = { id: string; run: () => Promise<Score> };
const results: { case: string; output: RouteOutput; writes?: string[] }[] = [];
const jobs: Job[] = [];

const docs = path.join(OUT, "docs");
fs.mkdirSync(docs, { recursive: true });
for (const c of extractCases) {
  jobs.push({
    id: c.id,
    run: async () => {
      const pdf = renderPdf(c.document);
      fs.writeFileSync(path.join(docs, `${c.id}.pdf`), pdf);
      const { warnings, model, ...answer } = idealFor(c.id).body;
      canned = JSON.stringify(answer);
      current = { db: fakeDb({}, []), member: { id: "eval-staff", store_id: store.store_id, role: "staff" } };
      const out = await post(extractRoute, "http://localhost/api/extract", { imageBase64: pdf.toString("base64"), mediaType: "application/pdf" });
      results.push({ case: c.id, output: out });
      return scoreExtract(c.expect, out);
    }
  });
}
for (const c of askFile.cases) {
  jobs.push({
    id: c.id,
    run: async () => {
      const writes: string[] = [];
      canned = idealFor(c.id).body.answer;
      current = { db: fakeDb(resolveDates(store.tables), writes), member: { id: `eval-${c.role}`, store_id: store.store_id, role: c.role } };
      sent = null;
      const out = await post(askRoute, "http://localhost/api/ask", { question: c.question, store_id: store.store_id });
      results.push({ case: c.id, output: out, writes });
      const answer = scoreAsk(expandPhrases(c.expect, askFile.phrases), out, writes);
      if (!c.prompt) return answer;
      // Assigned inside fetch during the await above, which narrowing cannot see.
      const captured = sent as Sent | null;
      const prompt: Score = captured
        ? scorePrompt(c.prompt, `${captured.system}\n${captured.text}`)
        : { pass: false, checks: [{ name: "prompt captured", pass: false, detail: "the route answered without calling the model" }] };
      return { pass: answer.pass && prompt.pass, checks: [...answer.checks, ...prompt.checks] };
    }
  });
}

const selected = jobs.filter((j) => !ONLY || j.id.includes(ONLY));
if (!selected.length) {
  console.error(`No case id contains "${ONLY}".`);
  process.exit(1);
}

async function main() {
  console.log(
    `${OFFLINE ? "Offline plumbing check (no model calls)" : `Live run against ${claudeModel()}`}: ` +
      `${selected.length} cases x ${RUNS} runs = ${selected.length * RUNS} ${OFFLINE ? "routed calls" : "model calls"}.\n`
  );
  const width = Math.max(...selected.map((j) => j.id.length));
  let casesPassing = 0;
  let runsPassing = 0;
  for (const job of selected) {
    let passed = 0;
    const misses = new Map<string, number>();
    for (let r = 0; r < RUNS; r++) {
      let score: Score;
      try {
        score = await job.run();
      } catch (err: any) {
        score = { pass: false, checks: [{ name: "harness", pass: false, detail: String(err?.message || err) }] };
      }
      if (score.pass) passed++;
      for (const c of score.checks.filter((x: Check) => !x.pass)) {
        const key = c.name + (c.detail ? ` (${c.detail})` : "");
        misses.set(key, (misses.get(key) || 0) + 1);
      }
    }
    runsPassing += passed;
    if (passed === RUNS) casesPassing++;
    const rate = `${passed}/${RUNS}`.padStart(5) + `${Math.round((passed / RUNS) * 100)}%`.padStart(6);
    console.log(`${passed === RUNS ? "PASS" : "FAIL"}  ${job.id.padEnd(width)}  ${rate}`);
    for (const [miss, n] of misses) console.log(`        ${miss}${RUNS > 1 ? `  x${n}` : ""}`);
  }

  const file = path.join(OUT, `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ model: OFFLINE ? "offline" : claudeModel(), runs: RUNS, results }, null, 2));
  const total = selected.length * RUNS;
  console.log(
    `\n${casesPassing} of ${selected.length} cases passed every run; ${runsPassing} of ${total} runs passed (${Math.round((runsPassing / total) * 100)}%).` +
      `\n${calls} ${OFFLINE ? "routed" : "model"} calls. Answers saved to ${path.relative(REPO, file)}` +
      `\nInvoices sent are in ${path.relative(REPO, docs)}`
  );
  process.exit(casesPassing === selected.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
