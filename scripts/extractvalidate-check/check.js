const { normalizeExtraction, EXTRACT_MEDIA_TYPES } = require("./extractValidate.js");
const { editLine, linesToSave, costEntry } = require("./captureLines.js");
let pass = 0, fail = 0;
const t = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  [" + d + "]" : ""}`); };
const line = (o) => ({ description: "Rope 50ft", qty: 2, unit_cost: 12.5, retail_price_note: 19.99, confidence: 0.9, ...o });
const one = (o) => normalizeExtraction({ vendor: "Acme", invoice_date: "2026-06-01", notes: "", line_items: [line(o)] });

// A clean read passes through untouched and raises nothing.
const clean = one({});
t("clean line unchanged", JSON.stringify(clean.data.line_items[0]) === JSON.stringify(line({})));
t("clean read has no warnings", clean.warnings.length === 0);

// Every coercion drops confidence to 0, so the line goes through the amber acknowledgement.
t("confidence above 1 becomes 0", one({ confidence: 7 }).data.line_items[0].confidence === 0);
t("negative confidence becomes 0", one({ confidence: -0.2 }).data.line_items[0].confidence === 0);
t("missing confidence becomes 0", one({ confidence: undefined }).data.line_items[0].confidence === 0);
const neg = one({ qty: -2 }).data.line_items[0];
t("negative qty becomes null with confidence 0", neg.qty === null && neg.confidence === 0);
const nan = one({ unit_cost: NaN }).data.line_items[0];
t("NaN cost becomes null with confidence 0", nan.unit_cost === null && nan.confidence === 0);
const str = one({ unit_cost: "12.50" }).data.line_items[0];
t("numeric string is kept but flagged", str.unit_cost === 12.5 && str.confidence === 0);

// retail_price_note is legitimately null (no handwritten price); that is not a coercion.
const noRetail = one({ retail_price_note: null }).data.line_items[0];
t("null retail note keeps confidence", noRetail.retail_price_note === null && noRetail.confidence === 0.9);
// Zero is the prompt's own "missing" value, not a bad number.
t("zero qty is not a coercion", one({ qty: 0 }).data.line_items[0].confidence === 0.9);

// Dates must be real calendar dates.
const bad = normalizeExtraction({ invoice_date: "2026-02-30", line_items: [] });
t("impossible date left blank", bad.data.invoice_date === "" && bad.warnings.length === 1);
t("loose date format left blank", normalizeExtraction({ invoice_date: "June 1 2026" }).data.invoice_date === "");
t("real date kept", one({}).data.invoice_date === "2026-06-01");

// Empty lines are noise; a garbage payload is an empty extraction, not a crash.
t("all-empty line dropped", one({ description: "", qty: 0, unit_cost: 0, retail_price_note: null }).data.line_items.length === 0);
t("null payload does not crash", normalizeExtraction(null).data.line_items.length === 0);
t("line_items not an array becomes empty", normalizeExtraction({ line_items: "x" }).data.line_items.length === 0);
t("long text capped at 500", one({ description: "x".repeat(900) }).data.line_items[0].description.length === 500);

t("PDF and JPEG accepted, HEIC refused", EXTRACT_MEDIA_TYPES.has("application/pdf") && EXTRACT_MEDIA_TYPES.has("image/jpeg") && !EXTRACT_MEDIA_TYPES.has("image/heic"));

// Capture screen: only a retyped unit cost clears an amber line.
const amber = line({ confidence: 0.5 });
t("description edit keeps an amber line amber", editLine(amber, { description: "Rope 100ft" }).confidence === 0.5);
t("qty edit keeps an amber line amber", editLine(amber, { qty: 3 }).confidence === 0.5);
const retyped = editLine(amber, { unit_cost: 13 });
t("retyped unit cost clears the flag", retyped.confidence === 1 && retyped.unit_cost === 13);
t("emptied cost box keeps an amber line amber", editLine(amber, { unit_cost: null }).confidence === 0.5);
t("non-number cost keeps an amber line amber", editLine(amber, { unit_cost: NaN }).confidence === 0.5);

// A role that cannot see money never posts an amber cost it could not check.
const staffRow = linesToSave([amber], false, 0.7)[0];
t("staff save drops an amber cost", staffRow.unit_cost === null && staffRow.confidence === 0.5 && staffRow.qty === 2);
t("money role save keeps an amber cost", linesToSave([amber], true, 0.7)[0].unit_cost === 12.5);
t("staff save keeps a confident cost", linesToSave([line({ confidence: 0.9 })], false, 0.7)[0].unit_cost === 12.5);
t("staff save keeps a cost at exactly the threshold", linesToSave([line({ confidence: 0.7 })], false, 0.7)[0].unit_cost === 12.5);
t("staff save keeps a null-confidence cost", linesToSave([line({ confidence: null })], false, 0.7)[0].unit_cost === 12.5);

// A cost typed later on the feed is a human check: confidence 1, so the trigger passes.
// Anything else comes back as { error } with the sentence shown under the box.
const cost = (s) => { const r = costEntry(s); return "error" in r ? undefined : r.unit_cost; };
const refused = (s) => "error" in costEntry(s);
const typed = costEntry("12.50");
t("typed cost sets confidence 1", !("error" in typed) && typed.unit_cost === 12.5 && typed.confidence === 1);
t("dollar sign and thousands commas accepted", cost(" $1,234.5 ") === 1234.5);
t("plain and point-led costs accepted", cost("1234") === 1234 && cost(".5") === 0.5 && cost("12.") === 12);
t("blank cost refused", refused("  "));
t("negative cost refused", refused("-3"));
t("decimal comma refused, not read as 1250", refused("12,50") && refused("1,2,3") && refused("1,23"));
t("comma after a leading 0 refused, not read as 500", refused("0,500"));
t("zero refused: the reader writes 0 for a cost it could not read", refused("0") && refused("0.00") && refused(".0"));
t("cost too long to be finite refused, never saved as null", refused("1" + "0".repeat(309)));
t("cost above the per-unit cap refused", refused("100000.01") && refused("250,000") && cost("100000") === 100000);
t("text cost refused", refused("twelve") && refused("0x10") && refused("1e3"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
