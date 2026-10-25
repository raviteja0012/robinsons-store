const { checkVendorGrounding, UNCONFIRMED_ANSWER } = require("./askGrounding.js");
let pass = 0, fail = 0;
const t = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  [" + d + "]" : ""}`); };

// A small store shaped like the prompt /api/ask builds: vendor lines, invoice lines, notes.
const storeData = [
  "Today is 2026-10-24. Store: Robinsons General Store, Dorset, Ontario. Money is CAD.",
  "KNOWLEDGE NOTES:",
  "- [Hardware] Moccasin reorders: the old supplier was Laurentian Leather; switched in 2025.",
  "VENDORS:",
  "- Pinecrest Moccasins [DryGoods & Lakeside], terms Net 30, status active, phone 705-555-0101, summer order: rep visits in Jan, order by end of Feb-Mar",
  "- Lakeview Candle Co [DryGoods & Lakeside], terms Net 60, status active",
  "- G.G.S [Hardware], terms n/a, status active",
  "- Hudson's Bay Company [DryGoods & Lakeside], terms Net 30, status active",
  "- Maple + Birch Designs [DryGoods & Lakeside], terms Net 30, status active",
  "- Boulangerie Côté Ltée [Bakery], terms COD, status active",
  "- Socksmith Canada Inc [DryGoods & Lakeside], terms Net 30, status active",
  "INVOICES (amount owed = amount + freight + HST, except where the tax is already inside the amount):",
  "- Pinecrest Moccasins: $1234.00, overdue, due 2026-09-01, terms Net 30"
].join("\n");
const vendorNames = ["Pinecrest Moccasins", "Lakeview Candle Co", "G.G.S", "Hudson's Bay Company", "Maple + Birch Designs", "Boulangerie Côté Ltée", "Socksmith Canada Inc", "Pinecrest Moccasins"];
const appGuide = "SCREENS: Capture, Vendors, Reorder, Due and overdue, Payments, Suggestions.";
// The question is passed on its own: it can excuse "X is not on file", never vouch for facts.
const check = (answer, question = "What is overdue?") => checkVendorGrounding(answer, { vendorNames, texts: [storeData, appGuide], question });

// Marked names: the brackets never reach the screen, and real vendors pass however they are written.
const plain = check("- [[Pinecrest Moccasins]]: $1,234.00, due 2026-09-01.");
t("marked real vendor passes", plain.ok);
t("brackets removed from the text", plain.text === "- Pinecrest Moccasins: $1,234.00, due 2026-09-01.", plain.text);
t("case and possessive ignored", check("Call [[pinecrest moccasins]]'s rep.").ok);
t("Company vs Co ignored", check("[[Lakeview Candle Company]] is on Net 60.").ok);
t("no suffix vs Co ignored", check("[[Lakeview Candle]] is on Net 60.").ok);
t("plural ignored", check("[[Lakeview Candles Co]] is on Net 60.").ok);
t("punctuation ignored (GGS vs G.G.S)", check("[[GGS]] has no terms on file.").ok);
t("plus vs and ignored", check("[[Maple and Birch Designs]] is active.").ok);
t("accents ignored", check("[[Boulangerie Cote]] is cash on delivery.").ok);
t("short form of a real vendor passes", check("[[Hudson's Bay]] is on Net 30.").ok);
t("supplier named only in a note passes", check("The old supplier was [[Laurentian Leather]].").ok);
t("name the person typed passes", check("[[Costco]] is not on file.", "Do we buy from Costco?").ok);
t("store name passes", check("This is [[Robinsons General Store]].").ok);

// Marked names that are nowhere in the prompt fail the whole answer.
const fake = check("Call [[Northern Mukluk Co]] at 705-555-0199.");
t("made-up marked vendor fails", !fake.ok && fake.unsupported.join() === "Northern Mukluk Co", fake.unsupported.join());
t("made-up single word fails", !check("Reorder moccasins from [[Manitobah]].").ok);
t("one fake among real ones fails", !check("- [[Pinecrest Moccasins]]: overdue\n- [[Brightwater Gifts]]: overdue").ok);
t("text still has no brackets when it fails", !fake.text.includes("[[") && !fake.text.includes("]]"));

// Unmarked names are caught by shape: a legal suffix, or straight after a vendor cue.
t("unmarked legal-suffix fake fails", !check("Call Northern Leather Ltd. at 705-555-0199.").ok);
t("unmarked legal-suffix real passes after a sentence-start word", check("Call Lakeview Candle Co. today.").ok);
t("unmarked real vendor with a different suffix passes", check("Try Lakeview Candle Inc for wicks.").ok);
t("two names in one run checked separately", !check("Both Lakeview Candle Co and Fakeco Ltd ship in May.").ok);
t("unmarked fake after 'reorder from' fails", !check("You can reorder from Manitobah Mukluks next week.").ok);
t("unmarked real after 'reorder from' passes", check("Reorder from Pinecrest Moccasins in March.").ok);
t("trailing capitalised word after a real name passes", check("Order from Pinecrest Moccasins Monday morning.").ok);
t("unmarked fake after 'supplier' fails", !check("The supplier Brightwater is not on file.").ok);
t("unmarked fake after 'vendor is' fails", !check("The vendor is Brightwater Gifts.").ok);
t("piece of a real name cannot carry a fake", !check("Order from Hudson Leather instead.").ok);
t("cue broken by punctuation is not a cue", check("Ask the vendor. Northwind replied in May.").ok);

// Ordinary capitalised words and app answers are left alone.
t("app how-to answer passes untouched", check("Open the Capture screen and take a photo of the invoice.").text === "Open the Capture screen and take a photo of the invoice.");
t("places, taxes and screens do not trip it", check("Ontario HST is 13 percent. Use the Due and overdue screen, then Payments.").ok);
t("screen after 'order from the' passes", check("Place the order from the Reorder screen.").ok);
t("empty answer passes", check("").ok && check("").text === "");
t("stray brackets removed", check("[[ ]] and [[Pinecrest Moccasins").text === " and Pinecrest Moccasins");

// Review of #59: each case below failed before the fix.
// A name built from words in the question, the app guide or the store data is not a vendor.
t("made-up 'product Company' from the question fails", !check("Order the chairs from [[Muskoka Chair Company]].", "Who sells us Muskoka chairs?").ok);
t("made-up 'product Co.' from the question fails", !check("Try Adirondack Chair Co. for those.", "Who sells us Adirondack chairs?").ok);
t("made-up name from app guide words fails", !check("Call [[Capture Vendors Ltd]] for wicks.").ok);
t("made-up name from store data words fails", !check("[[Summer Order Co]] ships in May.").ok);
// A shared tail word plus a suffix does not make a vendor real.
t("fake sharing 'Candle Co' fails", !check("Call Northern Candle Co. at 705-555-0199.").ok);
t("fake sharing 'Bay Company' fails", !check("Call Northwest Bay Company at 705-555-0199.").ok);
t("fake sharing 'Canada Inc' fails", !check("Order wool socks from Smartwool Canada Inc.").ok);
t("fake sharing 'Canada Inc' fails after 'Call'", !check("Call Smartwool Canada Inc at 416-555-0101.").ok);
t("real 'Canada Inc' vendor passes", check("Order from Socksmith Canada Inc.").ok);
t("fake before a real suffixed vendor fails", !check("You can reorder from Manitobah Mukluks and Lakeview Candle Co.").ok);
t("fake after a real suffixed vendor fails", !check("Reorder from Lakeview Candle Co and Manitobah Mukluks.").ok);
t("real after a real suffixed vendor passes", check("Reorder from Lakeview Candle Co and Pinecrest Moccasins.").ok);
// A one-word marked name must be a vendor word, not any word in the prompt.
t("department word as a vendor fails", !check("[[Lakeside]] supplies candles.").ok);
t("town as a vendor fails", !check("[[Dorset]] supplies candles.").ok);
t("department name as a vendor fails", !check("[[Hardware]] supplies candles.").ok);
t("one word of a listed vendor passes", check("[[Lakeview]] is on Net 60.").ok);
// The question can excuse "X is not on file", never vouch for invented facts.
t("question-only vendor with invented terms and phone fails", !check("[[Northern Mukluk Co]] is on Net 30, phone 705-555-0199.", "What are Northern Mukluk Co's terms and phone?").ok);
// Months, weekdays, "I" and new lines do not withhold a correct answer.
t("month after 'orders from' passes", check("[[Pinecrest Moccasins]] takes orders from January.").ok);
t("month range after 'order from' passes", check("You order from February to March for [[Pinecrest Moccasins]].").ok);
t("weekday after a real short name passes", check("You can reorder from Pinecrest Monday.").ok);
t("'supplier I' passes", check("The only supplier I see is [[Pinecrest Moccasins]].").ok);
t("heading ending in 'vendor' does not cue the next line", check("Overdue by vendor\nTotal: $1,234.00").ok);
t("fake before a weekday still fails", !check("Order from Hudson Leather Monday.").ok);
t("fake after 'order from' fails", !check("Order from Northwind Traders.").ok);
// A broken marker is still checked.
t("unclosed marker around a fake fails", !check("Call [[Brightwater Gifts at 705-555-0199.").ok);
t("half-closed marker around a fake fails", !check("Call [[Brightwater Gifts] at 705-555-0199.").ok);
t("unclosed marker around a real vendor passes", check("Call [[Pinecrest Moccasins at 705-555-0101.").ok);
// Every name in a cued list is checked, not just the first.
t("fake after 'and' in a cued list fails", !check("The supplier Pinecrest Moccasins and Brightwater Gifts both ship in May.").ok);
t("fake after 'or' in a cued list fails", !check("Order from Pinecrest Moccasins or Brightwater Gifts.").ok);
t("two real vendors in a cued list pass", check("Order from Pinecrest Moccasins and Lakeview Candle.").ok);
t("weekday after a comma passes", check("Order from Pinecrest Moccasins, Monday at the latest.").ok);
// Known limit, pinned so it is tested and not just described: an unwrapped fake with no
// legal suffix and no vendor cue is not checked (see STATUS.md).
t("known limit: unwrapped fake with no suffix or cue passes", check("Call Brightwater Gifts.").ok);

t("refusal copy is plain, no em dash", UNCONFIRMED_ANSWER.length > 0 && !UNCONFIRMED_ANSWER.includes("—"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
