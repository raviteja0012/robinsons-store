import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaudeResult } from "./anthropic";

// The ai_call log and the daily per-store cap, called from callClaude in src/lib/anthropic.ts.
// One row per model call: store, route, model, token counts, outcome. Never the prompt, the
// store data sent with it, or the answer.
//
// A call is reserved before the model is asked (public.ai_call_begin counts and inserts under
// a per-store lock, so a burst of parallel requests cannot all fit under the cap) and finished
// after (public.ai_call_finish fills in how it ended). Both fail open: a missing function (the
// migration has not run), a slow database, or an error logs a warning and lets the call
// through. The cap protects the monthly bill, not the store's data, and an invoice read at the
// receiving door matters more than one uncounted call. A reservation the database saves after
// the timeout leaves a pending row with no tokens, which still counts. A route that passes no
// scope, or no store, skips both, so a blank env never touches a database.

export type AiUsageScope = { db: SupabaseClient; storeId: string | null };

export type AiCallOutcome = "ok" | "refused" | "cut_off" | "failed" | "capped";

// What the reservation said. id is the pending row to finish; null when nothing was reserved.
export type AiCallSlot = { capped: boolean; id: string | null };

// Sonnet 5 list price is $2 per million input tokens and $10 per million output. The
// largest call here is about $0.10 (extract at its 8,000-token output ceiling, or Ask with
// the whole store as context), so 100 calls bounds a runaway day near $10. AI_DAILY_CAP_PER_STORE
// raises or lowers it; anything that is not a whole number above zero falls back to this.
export const DEFAULT_DAILY_CAP = 100;

// The cap travels as a Postgres integer. A bigger value would make every reservation fail
// and, failing open, switch off both the cap and the log; this is far above any real day.
export const MAX_DAILY_CAP = 100000;

// Both database calls sit in front of, or just after, a model call the person is waiting on,
// so a hung database costs them at most twice this. Extract already waits up to 45s on the
// model against a 45s client timeout, which leaves little room.
const DB_TIMEOUT_MS = 1500;

export function dailyCap(): number {
  const n = Number(process.env.AI_DAILY_CAP_PER_STORE);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_DAILY_CAP) : DEFAULT_DAILY_CAP;
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

// Reserve this call against the store's allowance for today, or learn it is used up. A
// refused call is recorded as capped by the same database call.
export async function reserveAiCall(scope: AiUsageScope | null | undefined, route: string, model: string): Promise<AiCallSlot> {
  const open: AiCallSlot = { capped: false, id: null };
  if (!scope?.storeId) return open;
  try {
    const { data, error } = await scope.db
      .rpc("ai_call_begin", { p_store_id: scope.storeId, p_route: route, p_model: model, p_cap: dailyCap() })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw error;
    return { capped: data?.allowed === false, id: typeof data?.id === "string" ? data.id : null };
  } catch (err) {
    warn(route, "cap_check_skipped", err);
    return open;
  }
}

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

// Fill in how a reserved call ended. usage is the provider's raw usage object, read here
// rather than from the result so a refusal or a cut-off, which still bill their tokens, are
// recorded with them.
export async function finishAiCall(scope: AiUsageScope | null | undefined, id: string | null, route: string, r: ClaudeResult, usage: any): Promise<void> {
  if (!scope || !id) return;
  const outcome = outcomeOf(r);
  try {
    const { error } = await scope.db
      .rpc("ai_call_finish", {
        p_id: id,
        p_outcome: outcome,
        p_model: r.model,
        p_failure_kind: outcome === "failed" && !r.ok ? r.kind : null,
        p_input_tokens: count(usage?.input_tokens),
        p_output_tokens: count(usage?.output_tokens),
        p_cache_read_tokens: count(usage?.cache_read_input_tokens),
        p_cache_write_tokens: count(usage?.cache_creation_input_tokens),
        p_duration_ms: r.ms
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw error;
  } catch (err) {
    warn(route, "log_skipped", err);
  }
}
