// Grounding check for Ask answers: every vendor the answer names must be in what the route
// put in the prompt (the store data, the app guide, or the question itself). A made-up vendor
// sitting next to a real phone number or dollar figure reads as fact, so one unsupported name
// fails the whole answer and the route shows UNCONFIRMED_ANSWER instead.
//
// How names are found. The prompt asks the model to wrap every vendor name in [[ ]], so a
// vendor the model believes in is marked even when it is not real. Unmarked text is also
// scanned for two shapes that read as a vendor: a legal suffix ("Northern Leather Ltd") and a
// name straight after "vendor", "supplier", or "order/reorder/buy from". Any other unmarked
// capitalised word is left alone: the store's real vendors are short brand names (no Inc, no
// Ltd), and flagging every capitalised word would replace good answers.
//
// How names are matched. Case, accents, punctuation, possessives, "&" vs "and", plurals, and
// legal suffixes ("Co" vs "Company" vs none) are ignored. A name matches when it appears as
// whole words anywhere in the prompt text, or when it is the same name as a listed vendor once
// suffixes are dropped. Pieces of a longer name only count when two or more words long, so
// "Hudson Leather" does not pass on the strength of "Hudson's Bay Company".
//
// No imports, so scripts/askgrounding-check runs it in node as is.

export const UNCONFIRMED_ANSWER =
  "I could not confirm that answer from the store's records, so I am not showing it. Check the Vendors screen, or ask again in different words.";

export type GroundingSources = {
  // Every vendor name the prompt listed: the vendor lines and the invoice lines.
  vendorNames: string[];
  // Everything else the prompt carried, verbatim: the store data, the app guide, the question.
  texts: string[];
};

export type GroundingResult = {
  ok: boolean;
  // The answer with the [[ ]] markers removed. Show it only when ok.
  text: string;
  // The names that matched nothing. For the check script; never logged or shown.
  unsupported: string[];
};

const LEGAL = new Set(["inc", "incorporated", "ltd", "limited", "ltee", "co", "company", "corp", "corporation", "llc", "llp", "ulc"]);
const CONNECTORS = new Set(["and", "of", "the", "de", "du", "des", "la", "le", "&", "+"]);
const VENDOR_WORDS = new Set(["vendor", "vendors", "supplier", "suppliers", "distributor", "distributors", "wholesaler", "wholesalers"]);
const FROM_VERBS = new Set([
  "order", "orders", "ordered", "ordering", "reorder", "reorders", "reordered", "reordering",
  "buy", "buys", "bought", "buying", "purchase", "purchases", "purchased", "purchasing",
  "source", "sources", "sourced", "sourcing"
]);

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

// The comparison form of any text: lowercase words, no accents or punctuation, stemmed.
function words(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .replace(/[&+]/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem);
}

// The name without legal suffixes or a leading "the"/"and".
function core(ws: string[]): string[] {
  const c = ws.filter((w) => !LEGAL.has(w));
  while (c.length && (c[0] === "the" || c[0] === "and" || c[0] === "of")) c.shift();
  return c;
}

type Index = { text: string; cores: Set<string>; compact: Set<string> };

function buildIndex(sources: GroundingSources): Index {
  const cores = new Set<string>();
  const compact = new Set<string>();
  for (const name of sources.vendorNames) {
    const ws = words(name || "");
    const c = core(ws);
    if (c.length) {
      cores.add(c.join(" "));
      compact.add(c.join(""));
    }
    if (ws.length) compact.add(ws.join(""));
  }
  return { text: ` ${sources.texts.map((t) => words(t || "").join(" ")).join(" ")} `, cores, compact };
}

// partial: this is a trimmed piece of a longer candidate, which must be more specific to count.
function nameIsGrounded(name: string, idx: Index, partial = false): boolean {
  const ws = words(name);
  const c = core(ws);
  if (!c.length) return true; // nothing name-like left ("Inc", "the"): nothing to check
  if (idx.cores.has(c.join(" ")) || idx.compact.has(c.join(""))) return true;
  const hasPhrase = (p: string) => idx.text.includes(` ${p} `);
  const specific = !partial || c.length >= 2 || c.length < ws.length;
  if (specific && hasPhrase(ws.join(" "))) return true;
  return c.length >= 2 && hasPhrase(c.join(" "));
}

type Tok = { raw: string; clean: string; lower: string; breakBefore: boolean; breakAfter: boolean };

function tokenize(text: string): Tok[] {
  return text.split(/\s+/).filter(Boolean).map((raw) => {
    const clean = raw.replace(/^[("'‘“[{]+/, "").replace(/[.,;:!?)"'’”\]}]+$/, "");
    return {
      raw,
      clean,
      lower: clean.toLowerCase(),
      breakBefore: clean !== raw && /^[("'‘“[{]/.test(raw),
      breakAfter: /[.,;:!?)"”\]}]$/.test(raw)
    };
  });
}

function nameLike(t: Tok): boolean {
  return /^\p{Lu}/u.test(t.clean) || /^\d+\p{L}/u.test(t.clean);
}

// Runs of capitalised words (with "and", "of", "&" between them), and the words before each.
function runs(toks: Tok[]): { words: Tok[]; before: Tok[] }[] {
  const out: { words: Tok[]; before: Tok[] }[] = [];
  let cur: Tok[] = [];
  let start = 0;
  const close = () => {
    while (cur.length && CONNECTORS.has(cur[cur.length - 1].lower)) cur.pop();
    if (cur.length) out.push({ words: cur, before: toks.slice(Math.max(0, start - 3), start) });
    cur = [];
  };
  toks.forEach((t, i) => {
    if (t.breakBefore) close();
    if (nameLike(t) || (cur.length && CONNECTORS.has(t.lower))) {
      if (!cur.length) start = i;
      cur.push(t);
    } else {
      close();
    }
    if (t.breakAfter) close();
  });
  close();
  return out;
}

// The cue has to run straight into the name: "vendor: Acme" or "ordered from. Acme" does not.
function cued(before: Tok[], first: Tok): boolean {
  if (first.breakBefore) return false;
  const w = before.slice(before.map((t) => t.breakAfter).lastIndexOf(true) + 1).map((t) => t.lower);
  let i = w.length - 1;
  if (w[i] === "the") i--;
  if (VENDOR_WORDS.has(w[i])) return true;
  if ((w[i] === "is" || w[i] === "called" || w[i] === "named") && VENDOR_WORDS.has(w[i - 1])) return true;
  return w[i] === "from" && FROM_VERBS.has(w[i - 1]);
}

function isLegal(t: Tok): boolean {
  const w = words(t.clean);
  return w.length === 1 && LEGAL.has(w[0]);
}

// A legal-suffix name passes if it, or the end of it, matches: "Call Acme Ltd" is checked as
// "Call Acme Ltd" and then "Acme Ltd". Two names in one run ("Acme Ltd and Beta Inc") are
// checked separately, so a real one cannot carry a made-up one.
function legalNames(ws: Tok[], idx: Index): { name: string; ok: boolean }[] {
  const out: { name: string; ok: boolean }[] = [];
  let seg: Tok[] = [];
  for (const t of ws) {
    if (!seg.length && CONNECTORS.has(t.lower)) continue;
    seg.push(t);
    if (!isLegal(t)) continue;
    if (seg.length > 1) {
      const name = seg.map((s) => s.clean).join(" ");
      let ok = false;
      for (let i = 0; i < seg.length - 1 && !ok; i++) {
        if (CONNECTORS.has(seg[i].lower)) continue;
        ok = nameIsGrounded(seg.slice(i).map((s) => s.clean).join(" "), idx, i > 0);
      }
      out.push({ name, ok });
    }
    seg = [];
  }
  return out;
}

// A name after a vendor cue passes if it, or the start of it, matches: "order from Acme
// Monday" is checked as "Acme Monday" and then "Acme".
function cuedName(ws: Tok[], idx: Index): { name: string; ok: boolean } {
  const name = ws.map((s) => s.clean).join(" ");
  for (let j = ws.length; j > 0; j--) {
    if (CONNECTORS.has(ws[j - 1].lower)) continue;
    if (nameIsGrounded(ws.slice(0, j).map((s) => s.clean).join(" "), idx, j < ws.length)) return { name, ok: true };
  }
  return { name, ok: false };
}

export function checkVendorGrounding(answer: string, sources: GroundingSources): GroundingResult {
  const src = answer || "";
  const text = src.replace(/\[\[\s*([^[\]]*?)\s*\]\]/g, "$1").replace(/\[\[|\]\]/g, "");
  const idx = buildIndex(sources);
  const unsupported: string[] = [];

  // Marked names first. Each marked span is then blanked so the scan below cannot see it twice.
  const unmarked = src.replace(/\[\[([^[\]]*)\]\]/g, (_m, inner: string) => {
    const name = inner.trim();
    if (name && !nameIsGrounded(name, idx)) unsupported.push(name);
    return " , ";
  });

  for (const r of runs(tokenize(unmarked))) {
    const hasLegal = r.words.some((t, i) => i > 0 && isLegal(t));
    const found = hasLegal ? legalNames(r.words, idx) : cued(r.before, r.words[0]) ? [cuedName(r.words, idx)] : [];
    for (const f of found) if (!f.ok) unsupported.push(f.name);
  }

  return { ok: unsupported.length === 0, text, unsupported };
}
