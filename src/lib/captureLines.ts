// Line rules for the capture screen, kept free of React and Supabase so
// scripts/extractvalidate-check can run them.
//
// An amber line is one the invoice reader was unsure of. The figure that matters is the unit
// cost: it is what the store will owe. So only a person retyping that cost clears the flag;
// fixing a description or a quantity does not vouch for a cost the reader got wrong.

import type { LineItem } from "@/lib/types";

// Applies one edit to a line. Confidence goes to 1 only when the patch carries a typed unit
// cost that is a real number. Emptying the box (null) or typing something that is not a
// number (NaN) leaves the line amber, so it cannot save a blank cost that looks checked.
export function editLine(line: LineItem, patch: Partial<LineItem>): LineItem {
  const retypedCost = typeof patch.unit_cost === "number" && Number.isFinite(patch.unit_cost);
  return { ...line, ...patch, ...(retypedCost ? { confidence: 1 } : {}) };
}

// The receiving_line rows to insert, without the event id. A role that cannot see money never
// saw an amber line's cost, so it cannot have checked it: that cost is saved as null for the
// owner to enter, and the confidence stays as read so the line still shows as unsure. A null
// cost passes the database confidence trigger by design.
export function linesToSave(lines: LineItem[], showMoney: boolean, threshold: number): LineItem[] {
  return lines.map((l) => {
    const low = l.confidence !== null && l.confidence < threshold;
    return {
      description: l.description,
      qty: l.qty,
      unit_cost: !showMoney && low ? null : l.unit_cost,
      retail_price_note: l.retail_price_note,
      confidence: l.confidence
    };
  });
}
