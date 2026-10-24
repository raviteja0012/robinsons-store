import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaudeResult } from "./anthropic";

// The ai_call log and the daily per-store cap, called from callClaude in src/lib/anthropic.ts.
// One row per model call: store, route, model, token counts, outcome. Never the prompt, the
// store data sent with it, or the answer.
//
// Both halves fail open. A missing table (the migration has not run), a slow database, or an
// insert the policies refuse logs a warning and lets the call through: the cap protects the
// monthly bill, not the store's data, and an invoice read at the receiving door matters more
// than one uncounted call. A route that passes no scope, or no store, skips both, so a blank
// env never touches a database.

export type AiUsageScope = { db: SupabaseClient; storeId: string | null };

export type AiCallOutcome = "ok" | "refused" | "cut_off" | "failed" | "capped";

// Sonnet 5 list price is $2 per million input tokens and $10 per million output. The
// largest call here is about $0.10 (extract at its 8,000-token output ceiling, or Ask with
// the whole store as context), so 100 calls bounds a runaway day near $10. AI_DAILY_CAP_PER_STORE
// raises or lowers it; anything that is not a whole number above zero falls back to this.
export const DEFAULT_DAILY_CAP = 100;

// Both database calls sit in front of, or just after, a model call the person is waiting on,
// so a hung database costs them at most twice this. Extract already waits up to 45s on the
// model against a 45s client timeout, which leaves little room.
const DB_TIMEOUT_MS = 1500;

export function dailyCap(): number {
  const n = Number(process.env.AI_DAILY_CAP_PER_STORE);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

export function outcomeOf(r: ClaudeResult): AiCallOutcome {
  if (r.ok) return "ok";
  if (r.kind === "refusal") return "refused";
  if (r.kind === "max_tokens") return "cut_off";
  if (r.kind === "capped") return "capped";
  return "failed";
}

function warn(route: string, outcome: string, err: any) {
  console.warn(JSON.stringify({ ai_call: route, outcome, detail: String(err?.message || err).slice(0, 200) }));
}

// True when the store has already made its allowance of calls today. Counted by
// public.ai_calls_today, which runs as definer: under enforced login only the owner can read
// ai_call rows, and a staff capture still has to count against the store.
export async function overDailyCap(scope: AiUsageScope | undefined, route: string): Promise<boolean> {
  if (!scope?.storeId) return false;
  try {
    const { data, error } = await scope.db
      .rpc("ai_calls_today", { p_store_id: scope.storeId })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw error;
    return Number(data) >= dailyCap();
  } catch (err) {
    warn(route, "cap_check_skipped", err);
    return false;
  }
}

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

// usage is the provider's raw usage object, read here rather than from the result so a
// refusal or a cut-off, which still bill their tokens, are recorded with them.
export async function recordAiCall(scope: AiUsageScope | undefined, route: string, r: ClaudeResult, usage: any): Promise<void> {
  if (!scope?.storeId) return;
  const outcome = outcomeOf(r);
  try {
    const { error } = await scope.db
      .from("ai_call")
      .insert({
        store_id: scope.storeId,
        route,
        model: r.model,
        outcome,
        failure_kind: outcome === "failed" && !r.ok ? r.kind : null,
        input_tokens: count(usage?.input_tokens),
        output_tokens: count(usage?.output_tokens),
        cache_read_tokens: count(usage?.cache_read_input_tokens),
        cache_write_tokens: count(usage?.cache_creation_input_tokens),
        duration_ms: r.ms
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw error;
  } catch (err) {
    warn(route, "log_skipped", err);
  }
}
