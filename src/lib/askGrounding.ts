// Grounding check for Ask answers: every vendor the answer names must be in what the route
// put in the prompt (the store data and the app guide). A made-up vendor sitting next to a
// real phone number or dollar figure reads as fact, so one unsupported name fails the whole
// answer and the route shows UNCONFIRMED_ANSWER instead.
//
// How names are found. The prompt asks the model to wrap every vendor name in [[ ]], so a
// vendor the model believes in is marked even when it is not real. Unmarked text is also
// scanned for two shapes that read as a vendor: a legal suffix ("Northern Leather Ltd") and a
// name straight after "vendor", "supplier", or "order/reorder/buy from" (a broken "[[" counts
// as a cue too). Any other unmarked capitalised word is left alone: the store's real vendors
// are short brand names (no Inc, no Ltd), and flagging every capitalised word would replace
// good answers. So an unmarked made-up name with neither shape is NOT caught.
//
// How names are matched. Case, accents, punctuation, possessives, "&" vs "and" and plurals
// are ignored everywhere. Legal suffixes ("Co" vs "Company" vs none) are ignored only against
// the listed vendors. Anywhere else in the prompt a name must appear as written, suffix
// included, so words from a note or the app guide cannot be assembled into a vendor. A
// trimmed piece of a longer name needs two name words or an exact listed vendor, and a marked
// one-word name must be a word of a listed vendor.
//
// The question is not a source: a name the person typed can still come back in "Costco is
// not on file", so an answer whose only unsupported names are in the question passes, but
// only when it carries no digits (invented terms, phones, amounts and dates all have them).
//
// No imports, so scripts/askgrounding-check runs it in node as is.

export const UNCONFIRMED_ANSWER =
  "I could not confirm that answer from the store's records, so I am not showing it. Check the Vendors screen, or ask again in different words.";

export type GroundingSources = {
  // Every vendor name the prompt listed: the vendor lines and the invoice lines.
  vendorNames: string[];
  // Everything else the prompt carried that may vouch for a name, verbatim: the store data
  // and the app guide.
  texts: string[];
  // The person's question. It never vouches for a name; see the header.
  question?: string;
};

export type GroundingResult = {
  ok: boolean;
  // The answer with the [[ ]] markers removed. Show it only when ok.
  text: string;
  // The names that matched nothing (when ok, the question excused them). For the check
  // script; never logged or shown.
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
// Words that follow "order from" or "supplier" without being a name. "Sat", "Sun" and "Wed"
// are left out because they also start real names.
const STOP = new Set([
  "i",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "thu", "thur", "thurs", "fri"
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

const asText = (ws: string[]) => ` ${ws.join(" ")} `;

type Index = { text: string; cores: Set<string>; compact: Set<string>; vendorWords: Set<string> };

function buildIndex(sources: GroundingSources): Index {
  const cores = new Set<string>();
  const compact = new Set<string>();
  const vendorWords = new Set<string>();
  for (const name of sources.vendorNames) {
    const ws = words(name || "");
    const c = core(ws);
    if (c.length) {
      cores.add(c.join(" "));
      compact.add(c.join(""));
      for (const w of c) if (w.length > 1 && !CONNECTORS.has(w)) vendorWords.add(w);
    }
    if (ws.length) compact.add(ws.join(""));
  }
  return { text: asText(sources.texts.flatMap((t) => words(t || ""))), cores, compact, vendorWords };
}

// partial: this is a trimmed piece of a longer candidate, which must be more specific to count.
function nameIsGrounded(name: string, idx: Index, partial = false): boolean {
  const ws = words(name);
  const c = core(ws);
  if (!c.length) return true; // nothing name-like left ("Inc", "the"): nothing to check
  if (idx.cores.has(c.join(" ")) || idx.compact.has(c.join(""))) return true;
  return (!partial || c.length >= 2) && idx.text.includes(asText(ws));
}

// A marked one-word name ("[[Lakeside]]") must be a word of a listed vendor: one word that
// merely appears somewhere in the prompt (a town, a department) is not a vendor.
function markedIsGrounded(name: string, idx: Index): boolean {
  const ws = words(name);
  const c = core(ws);
  if (c.length === 1 && ws.length === 1) return idx.cores.has(c[0]) || idx.compact.has(c[0]) || idx.vendorWords.has(c[0]);
  return nameIsGrounded(name, idx);
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

type Run = { words: Tok[]; before: Tok[]; start: number; end: number };

// Runs of capitalised words (with "and", "of", "&" between them), and the words before each.
function runs(toks: Tok[]): Run[] {
  const out: Run[] = [];
  let cur: Tok[] = [];
  let start = 0;
  const close = () => {
    while (cur.length && CONNECTORS.has(cur[cur.length - 1].lower)) cur.pop();
    if (cur.length) out.push({ words: cur, before: toks.slice(Math.max(0, start - 3), start), start, end: start + cur.length - 1 });
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

const join = (ws: Tok[]) => ws.map((s) => s.clean).join(" ");

// "from January", "supplier I": drop leading stop words and stop at the next one.
function trimStops(ws: Tok[]): Tok[] {
  let i = 0;
  while (i < ws.length && STOP.has(ws[i].lower)) i++;
  const cut = ws.findIndex((t, k) => k >= i && STOP.has(t.lower));
  return ws.slice(i, cut < 0 ? ws.length : cut);
}

// A name after a vendor cue passes if it, or the start of it, matches: "order from Acme
// Monday" is checked as "Acme Monday" and then "Acme". Words joined on after the match by a
// connector ("and", "&", "of") are a second name and are checked the same way. Returns the
// names that fail.
function cuedNames(ws: Tok[], idx: Index): string[] {
  for (let j = ws.length; j > 0; j--) {
    if (CONNECTORS.has(ws[j - 1].lower)) continue;
    if (!nameIsGrounded(join(ws.slice(0, j)), idx, j < ws.length)) continue;
    let k = j;
    while (k < ws.length && CONNECTORS.has(ws[k].lower)) k++;
    return k > j && k < ws.length ? cuedNames(ws.slice(k), idx) : [];
  }
  return ws.length ? [join(ws)] : [];
}

// A legal-suffix name passes if it, or the end of it, matches: "Call Acme Ltd" is checked as
// "Call Acme Ltd" and then "Acme Ltd". Two names in one run ("Acme Ltd and Beta Inc") are
// checked separately, so a real one cannot carry a made-up one. In a cued run the words
// before a matched end are a name too ("from Fakeco and Acme Ltd"), and so are words joined
// on after the last suffix ("from Acme Ltd and Fakeco"). Returns the names that fail.
function legalNames(ws: Tok[], idx: Index, isCued: boolean): string[] {
  const out: string[] = [];
  let seg: Tok[] = [];
  let first = true;
  let joined = false; // the current segment came after an "and"/"of"/"&"
  for (const t of ws) {
    if (!seg.length && CONNECTORS.has(t.lower)) {
      joined = true;
      continue;
    }
    seg.push(t);
    if (!isLegal(t)) continue;
    if (seg.length > 1) {
      let at = -1;
      for (let i = 0; i < seg.length - 1 && at < 0; i++) {
        if (!CONNECTORS.has(seg[i].lower) && nameIsGrounded(join(seg.slice(i)), idx, i > 0)) at = i;
      }
      if (at < 0) out.push(join(seg));
      else if (at > 0 && isCued && first) {
        const lead = seg.slice(0, at);
        while (lead.length && CONNECTORS.has(lead[lead.length - 1].lower)) lead.pop();
        out.push(...cuedNames(trimStops(lead), idx));
      }
    }
    seg = [];
    first = false;
    joined = false;
  }
  if (isCued && joined && seg.length) out.push(...cuedNames(trimStops(seg), idx));
  return out;
}

export function checkVendorGrounding(answer: string, sources: GroundingSources): GroundingResult {
  const src = answer || "";
  const text = src.replace(/\[\[\s*([^[\]]*?)\s*\]\]/g, "$1").replace(/\[\[|\]\]/g, "");
  const idx = buildIndex(sources);
  const unsupported: string[] = [];

  // Marked names first. Each marked span is then blanked so the scan below cannot see it
  // twice, and a new line ends a sentence like a full stop does.
  const unmarked = src.replace(/\[\[([^[\]]*)\]\]/g, (_m, inner: string) => {
    const name = inner.trim();
    if (name && !markedIsGrounded(name, idx)) unsupported.push(name);
    return " , ";
  });

  const toks = tokenize(unmarked.replace(/\n/g, " , "));
  // A cue carries across "or"/"and" to the next run: "order from Acme or Fakeco".
  let carryEnd = -1;
  for (const r of runs(toks)) {
    const carried = carryEnd >= 0 && r.start === carryEnd + 2 && (toks[carryEnd + 1].lower === "or" || toks[carryEnd + 1].lower === "and");
    const isCued = carried || r.words[0].raw.startsWith("[[") || cued(r.before, r.words[0]);
    const hasLegal = r.words.some((t, i) => i > 0 && isLegal(t));
    if (hasLegal) unsupported.push(...legalNames(r.words, idx, isCued));
    else if (isCued) unsupported.push(...cuedNames(trimStops(r.words), idx));
    carryEnd = isCued && !r.words[r.words.length - 1].breakAfter ? r.end : -1;
  }

  const q = sources.question ? asText(words(sources.question)) : "";
  const excused =
    unsupported.length > 0 &&
    !/\d/.test(text) &&
    unsupported.every((n) => {
      const ws = words(n);
      return ws.length > 0 && q.includes(asText(ws));
    });
  return { ok: unsupported.length === 0 || excused, text, unsupported };
}
