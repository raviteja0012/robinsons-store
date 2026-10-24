// Value checks on what the invoice reader returns.
//
// Structured outputs guarantee the SHAPE of the extraction, not the values: the schema
// cannot express a 0-to-1 bound, a non-negative quantity, or a real calendar date (see the
// note on OUTPUT_SCHEMA in the extract route). A confidence of 7, a quantity of -2, or a date
// of 2026-02-30 would otherwise reach the capture screen looking like a confident read.
//
// The rule is fail closed: any value this has to coerce gets confidence 0 on its line, so it
// lands in the amber band and goes through the existing acknowledgement and the database
// trigger rather than being saved quietly.

export type ExtractedLine = {
  description: string;
  qty: number | null;
  unit_cost: number | null;
  retail_price_note: number | null;
  confidence: number;
};

export type Extraction = {
  vendor: string;
  invoice_date: string;
  notes: string;
  line_items: ExtractedLine[];
};

const MAX_TEXT = 500;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "";
}

function realDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// null means "not a usable amount"; the caller decides what that does to confidence.
function amount(v: unknown, nullable: boolean): { value: number | null; coerced: boolean } {
  if (v === null || v === undefined) return { value: null, coerced: !nullable };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return { value: null, coerced: true };
  return { value: n, coerced: typeof v !== "number" };
}

export function normalizeExtraction(parsed: any): { data: Extraction; warnings: string[] } {
  const warnings: string[] = [];
  const src = parsed && typeof parsed === "object" ? parsed : {};

  let invoice_date = text(src.invoice_date);
  if (invoice_date && !realDate(invoice_date)) {
    warnings.push(`invoice date "${invoice_date}" is not a real date; left blank`);
    invoice_date = "";
  }

  const rawLines: any[] = Array.isArray(src.line_items) ? src.line_items : [];
  const line_items: ExtractedLine[] = [];
  rawLines.forEach((l, i) => {
    const line = l && typeof l === "object" ? l : {};
    const description = text(line.description);
    const qty = amount(line.qty, false);
    const unit = amount(line.unit_cost, false);
    const retail = amount(line.retail_price_note, true);

    // A line with nothing on it is noise from the reader, not a line to acknowledge.
    if (!description && !qty.value && !unit.value && retail.value === null) return;

    let confidence = typeof line.confidence === "number" && Number.isFinite(line.confidence) ? line.confidence : 0;
    if (confidence < 0 || confidence > 1) {
      warnings.push(`line ${i + 1}: confidence ${confidence} outside 0 to 1`);
      confidence = 0;
    }
    if (qty.coerced || unit.coerced || retail.coerced) {
      warnings.push(`line ${i + 1}: a quantity or price was not a usable number`);
      confidence = 0;
    }
    line_items.push({ description, qty: qty.value, unit_cost: unit.value, retail_price_note: retail.value, confidence });
  });

  return {
    data: { vendor: text(src.vendor), invoice_date, notes: text(src.notes), line_items },
    warnings
  };
}

// The formats the reader accepts. Anything else is refused before it costs a model call.
export const EXTRACT_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);

// Vercel's request body limit is 4.5 MB; base64 inflates by a third, and the capture screen
// already shrinks photos below this. A payload this large is not one the screen sent.
export const EXTRACT_MAX_BASE64 = 4_400_000;
