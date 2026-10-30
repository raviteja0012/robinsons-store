// Which database does each push reach?
//
// .github/workflows/migrate.yml picks its connection with a GitHub expression on the ref.
// A push to develop must reach the dev database or nothing; a push to main reaches
// production. GitHub's `a && b || c` returns c whenever b is empty, so an expression that
// falls back to another secret would quietly send a develop push somewhere else while its
// dev secret is unset. This evaluates every PGCONN expression in the workflow against both
// refs, with each secret set and unset, and fails on any answer other than the one wanted.
//
// Run: node .github/scripts/migrate-connection.test.mjs [path to migrate.yml]

import { readFileSync } from "node:fs";

const file = process.argv[2] || ".github/workflows/migrate.yml";
const yml = readFileSync(file, "utf8").replace(/\r\n/g, "\n");

// GitHub expressions with only ==, !=, &&, || and string literals behave like their
// JavaScript counterparts: && and || return an operand, and an unset secret is "".
function compile(expr) {
  if (!/^[\w.'\s=!&|]+$/.test(expr)) throw new Error(`unexpected syntax: ${expr}`);
  const js = expr
    .replace(/github\.ref_name/g, "ctx.ref")
    .replace(/secrets\.(\w+)/g, "ctx.secrets.$1")
    .replace(/!=/g, "!==")
    .replace(/([^!=])==/g, "$1===");
  return new Function("ctx", `return (${js});`);
}

const exprs = [...yml.matchAll(/^\s*PGCONN:\s*\$\{\{(.*)\}\}\s*$/gm)].map((m) => m[1].trim());

const DEV = "dev-connection";
const PROD = "prod-connection";
const cases = [
  { name: "develop, dev secret unset", ref: "develop", secrets: { SUPABASE_DB_URL: PROD }, want: "" },
  { name: "develop, dev secret set", ref: "develop", secrets: { SUPABASE_DB_URL_DEV: DEV, SUPABASE_DB_URL: PROD }, want: DEV },
  { name: "develop, neither secret set", ref: "develop", secrets: {}, want: "" },
  { name: "main, both secrets set", ref: "main", secrets: { SUPABASE_DB_URL_DEV: DEV, SUPABASE_DB_URL: PROD }, want: PROD },
  { name: "main, production secret unset", ref: "main", secrets: { SUPABASE_DB_URL_DEV: DEV }, want: "" },
  { name: "a run by hand from another branch", ref: "some-branch", secrets: { SUPABASE_DB_URL_DEV: DEV, SUPABASE_DB_URL: PROD }, want: PROD }
];

let failed = 0;
if (exprs.length < 2) {
  console.log(`  FAIL  expected a PGCONN expression on the gate and the apply step, found ${exprs.length}`);
  failed++;
}
exprs.forEach((expr, i) => {
  console.log(`PGCONN expression ${i + 1}: ${expr}`);
  const run = compile(expr);
  for (const c of cases) {
    const secrets = new Proxy(c.secrets, { get: (s, k) => (k in s ? s[k] : "") });
    const got = run({ ref: c.ref, secrets }) || "";
    const ok = got === c.want;
    if (!ok) failed++;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${c.name}: ${JSON.stringify(got)}${ok ? "" : `, wanted ${JSON.stringify(c.want)}`}`);
  }
});

if (failed) {
  console.error(`\n${failed} case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${exprs.length * cases.length + 1} checks passed.`);
