// Can dev and production be told apart?
//
// This guard's whole job is to stop seed_dev.sql and the dev migrations from being applied
// to the store's real ledger because two connection strings got mixed up on a clipboard.
// It has to be right in both directions, and the two directions fail differently:
//
//   a missed match  -> dev data lands in the live database, silently, and looks fine
//   a false match   -> a legitimate dev run is blocked, loudly, and someone reads the log
//
// The first is unrecoverable and invisible; the second is an inconvenience. So where this is
// unsure it must NOT claim a match, and it must say it was unsure rather than pass quietly.
//
// The last section holds the Supabase MCP server in .mcp.json to the same standard: what it
// is allowed to reach in production is checked here, not left to whoever edits the file.
//
// Run: node .github/scripts/distinct-databases.test.mjs

import { existsSync, readFileSync } from "node:fs";
import { projectRef, sameProject } from "./distinct-databases.mjs";

const PROD = "mhcjreqvvhnrtgwtuwvr";
const DEV = "abcdefghijklmnopqrst";

const pooler = (ref, pw = "pw") =>
  `postgresql://postgres.${ref}:${pw}@aws-1-ca-central-1.pooler.supabase.com:5432/postgres`;
const direct = (ref, pw = "pw") =>
  `postgresql://postgres:${pw}@db.${ref}.supabase.co:5432/postgres`;

const refCases = [
  { name: "session pooler", conn: pooler(PROD), want: PROD },
  { name: "direct connection", conn: direct(PROD), want: PROD },
  { name: "transaction pooler port", conn: pooler(PROD).replace(":5432", ":6543"), want: PROD },
  { name: "password containing an @", conn: pooler(PROD, "p%40ss"), want: PROD },
  { name: "uppercase in the host", conn: direct(PROD).replace("supabase.co", "SUPABASE.CO"), want: PROD },
  { name: "empty string", conn: "", want: null },
  { name: "undefined", conn: undefined, want: null },
  { name: "not a postgres url at all", conn: "https://example.com", want: null },
  { name: "a local database", conn: "postgresql://postgres:pw@localhost:5432/postgres", want: null }
];

let failed = 0;
console.log("reading the project reference:");
for (const c of refCases) {
  const got = projectRef(c.conn);
  const ok = got === c.want;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${c.name}: got ${got}, want ${c.want}`);
}

const matchCases = [
  {
    name: "the mistake this exists to catch: production pasted into the dev secret",
    a: pooler(PROD), b: pooler(PROD), want: true,
    why: "identical strings are the ordinary way this goes wrong"
  },
  {
    name: "same project, different connection shape",
    a: pooler(PROD), b: direct(PROD), want: true,
    why: "the sneaky version: it looks different and is the same database"
  },
  {
    name: "same project, different password after a rotation",
    a: pooler(PROD, "old"), b: pooler(PROD, "new"), want: true,
    why: "the password is not what makes it the same database"
  },
  {
    name: "two genuinely different projects",
    a: pooler(DEV), b: pooler(PROD), want: false,
    why: "the normal case: it must not block real work"
  },
  {
    name: "one string unreadable",
    a: "not a connection string", b: pooler(PROD), want: false,
    why: "unknown is not a match; the caller warns instead of blocking"
  },
  {
    name: "both unreadable",
    a: "nonsense", b: "other nonsense", want: false,
    why: "two unknowns must never compare equal, or every junk pair would block a run"
  },
  {
    name: "both empty",
    a: "", b: "", want: false,
    why: "absence is not sameness"
  }
];

console.log("\ndeciding whether two strings are the same database:");
for (const c of matchCases) {
  const got = sameProject(c.a, c.b);
  const ok = got === c.want;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${c.name}: got ${got}, want ${c.want} (${c.why})`);
}

// The Supabase MCP server committed in .mcp.json.
//
// Every session that opens this repo loads that file, and the hosted server's URL is its
// whole configuration. The file stays rather than being deleted, because the vendored
// Supabase skill writes a new one with no parameters when it finds none. So the URL is held
// to three rules:
//
//   read_only=true, always       SQL runs as a read-only Postgres user and write tools hide
//   a features list, always      without one the server turns on its defaults, database too
//   production: docs, debugging  documentation, logs and advisors, and nothing else
//
// No project_ref, or more than one, is held to the production list: an unscoped server can
// reach every project the signed-in account can. A Supabase server written in any other
// shape fails, because this reads only the hosted URL and cannot vouch for anything else.

const MCP_HOST = "mcp.supabase.com";
const PROD_GROUPS = new Set(["docs", "debugging"]);

function mcpProblems(config, prodRef) {
  const problems = [];
  for (const [name, server] of Object.entries(config?.mcpServers || {})) {
    let url = null;
    try {
      url = new URL(String(server?.url || ""));
    } catch {
      url = null;
    }
    if (!url || url.hostname !== MCP_HOST) {
      if (/supabase/i.test(JSON.stringify(server))) {
        problems.push(`${name}: a Supabase server not written as the hosted URL, which this cannot check`);
      }
      continue;
    }
    const q = url.searchParams;
    const readOnly = q.getAll("read_only");
    if (readOnly.length !== 1 || readOnly[0] !== "true") {
      problems.push(`${name}: read_only is not exactly true`);
    }
    const groups = q
      .getAll("features")
      .flatMap((f) => f.split(","))
      .map((g) => g.trim().toLowerCase())
      .filter(Boolean);
    if (!groups.length) {
      problems.push(`${name}: no features list, so the server would turn on its defaults`);
    }
    const refs = q.getAll("project_ref").map((r) => r.trim().toLowerCase());
    if (refs.length !== 1 || refs[0] === prodRef) {
      const extra = groups.filter((g) => !PROD_GROUPS.has(g));
      if (extra.length) {
        problems.push(`${name}: ${extra.join(", ")} on production; only docs and debugging are allowed`);
      }
    }
  }
  return problems;
}

const hosted = (query) => ({
  mcpServers: { supabase: { type: "http", url: `https://${MCP_HOST}/mcp?${query}` } }
});

const mcpCases = [
  {
    name: "production, read-only, docs and debugging",
    config: hosted(`project_ref=${PROD}&read_only=true&features=docs,debugging`), want: true,
    why: "the committed shape"
  },
  {
    name: "production with no read_only",
    config: hosted(`project_ref=${PROD}&features=docs,debugging`), want: false,
    why: "read-only is required on every hosted URL"
  },
  {
    name: "read_only=false",
    config: hosted(`project_ref=${PROD}&read_only=false&features=docs`), want: false,
    why: "only the exact value true counts"
  },
  {
    name: "read_only=true and no features",
    config: hosted(`project_ref=${PROD}&read_only=true`), want: false,
    why: "no list means the server's defaults, and those include database"
  },
  {
    name: "an empty features list",
    config: hosted(`project_ref=${PROD}&read_only=true&features=`), want: false,
    why: "empty is the same as absent"
  },
  {
    name: "production with database",
    config: hosted(`project_ref=${PROD}&read_only=true&features=docs,database`), want: false,
    why: "production gets docs and debugging only"
  },
  {
    name: "production with development, in a second features parameter",
    config: hosted(`project_ref=${PROD}&read_only=true&features=docs&features=development`), want: false,
    why: "every features parameter counts, not just the first"
  },
  {
    name: "read_only given twice, true then false",
    config: hosted(`project_ref=${PROD}&read_only=true&read_only=false&features=docs`), want: false,
    why: "two answers is not a yes"
  },
  {
    name: "no project_ref, with database",
    config: hosted("read_only=true&features=database"), want: false,
    why: "an unscoped server can reach production, so it gets the production list"
  },
  {
    name: "dev project, read-only, with database",
    config: hosted(`project_ref=${DEV}&read_only=true&features=docs,database`), want: true,
    why: "the production list applies to production; dev may read its own tables"
  },
  {
    name: "dev project with no read_only",
    config: hosted(`project_ref=${DEV}&features=docs`), want: false,
    why: "read-only is required on every hosted URL, dev included"
  },
  {
    name: "a local Supabase server instead of the hosted one",
    config: { mcpServers: { supabase: { command: "npx", args: ["-y", "@supabase/mcp-server-supabase"] } } },
    want: false,
    why: "a shape this cannot read is not a shape it can vouch for"
  },
  {
    name: "an unrelated server",
    config: { mcpServers: { other: { type: "http", url: "https://example.com/mcp" } } }, want: true,
    why: "only Supabase servers are this check's business"
  },
  {
    name: "no servers at all",
    config: {}, want: true,
    why: "nothing configured is nothing to refuse"
  }
];

console.log("\nchecking a Supabase MCP config:");
for (const c of mcpCases) {
  const problems = mcpProblems(c.config, PROD);
  const ok = (problems.length === 0) === c.want;
  if (!ok) failed++;
  const got = problems.length ? problems.join("; ") : "allowed";
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${c.name}: ${got} (${c.why})`);
}

console.log("\nchecking the committed .mcp.json:");
const mcpFile = new URL("../../.mcp.json", import.meta.url);
if (!existsSync(mcpFile)) {
  console.log("  ok    no .mcp.json, nothing to check");
} else {
  let config = null;
  try {
    config = JSON.parse(readFileSync(mcpFile, "utf8"));
  } catch (e) {
    failed++;
    console.log(`  FAIL  .mcp.json is not valid JSON, so it cannot be checked: ${e.message}`);
  }
  if (config) {
    const problems = mcpProblems(config, PROD);
    if (problems.length) failed++;
    for (const p of problems) console.log(`  FAIL  ${p}`);
    if (!problems.length) console.log("  ok    every Supabase server is read-only and inside its allowed groups");
  }
}

if (failed) {
  console.error(`\n${failed} case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${refCases.length + matchCases.length + mcpCases.length + 1} checks passed.`);
