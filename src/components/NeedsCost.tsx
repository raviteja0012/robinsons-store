"use client";

// The "Needs a cost" list at the top of the feed, for roles that see money. Staff never see
// costs, so an amber line they capture is saved without its unit cost (lib/captureLines), and
// a line can also be saved with the cost left blank. This lists every such line in the active
// store, newest delivery first, so the owner or a manager can type the cost from the invoice.
// Saving sets confidence to 1 (a person checked it), writes through the existing
// receiving_line policy, and logs who entered it. Renders nothing when no line is waiting.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useActiveStore } from "@/lib/store";
import { REQUIRE_AUTH, canSeeMoney, currentActorId, type Member, type Role } from "@/lib/auth";
import { costEntry } from "@/lib/captureLines";
import { FieldError, fieldInputClass, type FieldErrors } from "@/components/FieldError";

type CostLine = { id: string; description: string | null; qty: number | null; confidence: number | null };
type CostEvent = { id: string; vendor_name: string | null; received_date: string | null; created_at: string; receiving_line: CostLine[] };

const LIMIT = 50;

// refresh changes when the feed deletes a delivery, so its lines leave this list too.
export default function NeedsCost({ role, member, refresh, onSaved }: { role: Role | null; member: Member | null; refresh: number; onSaved: () => void }) {
  const { storeId, ready } = useActiveStore();
  const showMoney = canSeeMoney(role);
  const [events, setEvents] = useState<CostEvent[]>([]);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Each load is numbered and only the latest may land, so a slow answer for a store the
  // person has already left never shows its lines under the new one.
  const loadSeq = useRef(0);

  async function load() {
    const mine = ++loadSeq.current;
    // !inner keeps only deliveries that still have a line with no cost, and the embedded
    // filter returns just those lines.
    let q = supabase
      .from("receiving_event")
      .select("id, vendor_name, received_date, created_at, receiving_line!inner(id, description, qty, confidence)")
      .is("voided_at", null)
      .is("receiving_line.unit_cost", null)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (storeId) q = q.eq("store_id", storeId);
    const { data, error } = await q;
    if (mine !== loadSeq.current) return;
    if (error) setLoadError(error.message);
    else {
      setLoadError(null);
      setEvents((data as unknown as CostEvent[]) || []);
    }
  }

  useEffect(() => {
    if (!ready || !showMoney) return;
    setEvents([]);
    setNotice(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, storeId, showMoney, refresh]);

  function flag(id: string, message: string) {
    setErrors((prev) => ({ ...prev, [id]: message }));
  }

  async function save(ev: CostEvent, line: CostLine) {
    if (!showMoney || busyId) return;
    const patch = costEntry(typed[line.id] || "");
    if (!patch) {
      flag(line.id, "Type the unit cost as a number, like 12.50.");
      return;
    }
    // The audit row must say who entered the cost, so no identity means no save.
    const actor = currentActorId(member);
    if (!actor) {
      flag(line.id, REQUIRE_AUTH
        ? "We could not tell who you are, so nothing was saved. Sign in again, then retry."
        : "Pick your name under Acting as on the Capture screen first, so the cost is saved under it.");
      return;
    }
    setBusyId(line.id);
    flag(line.id, "");
    setNotice(null);
    try {
      // The list can be older than a delete or a store switch, so the delivery must still be
      // live and in this store. Login's RLS holds the store line too; this holds it in the demo.
      let check = supabase.from("receiving_event").select("id").eq("id", ev.id).is("voided_at", null);
      if (storeId) check = check.eq("store_id", storeId);
      const live = await check;
      if (live.error) throw new Error(live.error.message);
      if (!live.data || live.data.length === 0) {
        flag(line.id, "This delivery was deleted or is in another store. The list is refreshed.");
        await load();
        return;
      }
      // Fills a blank cost only, on the delivery it was listed under. If someone else entered
      // it first, no row changes and the reload drops it from the list.
      const up = await supabase
        .from("receiving_line")
        .update(patch)
        .eq("id", line.id)
        .eq("receiving_event_id", ev.id)
        .is("unit_cost", null)
        .select("id");
      if (up.error) throw new Error(up.error.message);
      if (!up.data || up.data.length === 0) {
        flag(line.id, "This line already has a cost or was removed. The list is refreshed.");
        await load();
        return;
      }
      const log = await supabase.from("activity_log").insert({ actor_id: actor, action: "cost_entered", entity: "receiving_line", entity_id: line.id });
      if (log.error) {
        // No cost without a record of who entered it: put the line back as it was.
        const undo = await supabase.from("receiving_line").update({ unit_cost: null, confidence: line.confidence }).eq("id", line.id);
        if (!undo.error) throw new Error(`could not record who entered it. ${log.error.message}`);
        setNotice(`The cost for "${line.description || "a line"}" was saved, but who entered it was not recorded and undoing it failed. Tell the developer. ${undo.error.message}`);
      }
      setTyped((prev) => {
        const rest = { ...prev };
        delete rest[line.id];
        return rest;
      });
      await load();
      onSaved();
    } catch (e: any) {
      flag(line.id, `Not saved: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  if (!showMoney) return null;
  if (loadError) {
    return (
      <div className="card" style={{ padding: 16, marginBottom: 20 }}>
        <span className="chip chip-error">Connection</span>
        <p className="help" style={{ marginTop: 8 }}>Could not load the lines that need a cost: {loadError}</p>
      </div>
    );
  }
  const count = events.reduce((n, ev) => n + ev.receiving_line.length, 0);
  if (count === 0 && !notice) return null;

  return (
    <div id="needs-cost" className="card" style={{ padding: 16, marginBottom: 20, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span className="chip chip-warning">Needs a cost</span>
        <span className="help">{count === 1 ? "1 line" : `${count} lines`} saved without a unit cost</span>
      </div>
      <p className="help" style={{ margin: 0 }}>
        Staff do not see costs, so lines the invoice reader was unsure of are saved without one. Type the unit cost from the
        invoice and save. Each one is saved under your name.
      </p>
      {notice && <p className="field-error" role="alert" style={{ margin: 0 }}>{notice}</p>}

      {events.map((ev) => (
        <div key={ev.id} style={{ display: "grid", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div>
            <strong>{ev.vendor_name || "Unknown vendor"}</strong>{" "}
            <span className="help">received {ev.received_date || new Date(ev.created_at).toLocaleDateString()}</span>
          </div>
          {ev.receiving_line.map((l) => (
            <div key={l.id}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <div>{l.description || "No description"}</div>
                  <div className="help">Qty {l.qty ?? "not given"}</div>
                </div>
                <div style={{ width: 130 }}>
                  <label className="label" htmlFor={`cost-${l.id}`}>Unit cost</label>
                  <input
                    id={`cost-${l.id}`}
                    className={`${fieldInputClass(errors, l.id)} tabular`}
                    inputMode="decimal"
                    value={typed[l.id] ?? ""}
                    onChange={(e) => setTyped((prev) => ({ ...prev, [l.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") save(ev, l); }}
                  />
                </div>
                <button className="btn-primary" onClick={() => save(ev, l)} disabled={busyId !== null}>
                  {busyId === l.id ? "Saving" : "Save"}
                </button>
              </div>
              <FieldError errors={errors} name={l.id} />
            </div>
          ))}
        </div>
      ))}

      {events.length === LIMIT && <p className="help" style={{ margin: 0 }}>Showing the {LIMIT} most recent deliveries. Older ones appear as these are done.</p>}
    </div>
  );
}
