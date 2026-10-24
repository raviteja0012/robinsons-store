// One door to the Anthropic Messages API for every AI route.
//
// Before this, each route made its own fetch with no timeout and no retry, and three of the
// four read the first text block without looking at stop_reason. A stalled call held the
// screen until Vercel killed the function, an overloaded API (429/529) failed on the first
// try, and a refusal or a cut-off answer reached the person as an empty or half sentence.
// Raw provider text also reached the screens, including the capture screen a seasonal
// employee uses at the receiving door.
//
// The env is read at call time, never at import, so the build still passes with a blank env.
// No temperature or other sampling parameter is sent: current Claude models reject
// non-default sampling params, and one rejected parameter would fail every call.

export type ClaudeFailure =
  | "no_key"
  | "timeout"
  | "overloaded"
  | "refusal"
  | "max_tokens"
  | "bad_request"
  | "upstream";

export type ClaudeResult =
  | {
      ok: true;
      text: string;
      stopReason: string;
      model: string;
      ms: number;
      usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | null;
    }
  | { ok: false; kind: ClaudeFailure; detail: string; model: string; ms: number };

type CallOptions = {
  route: string;
  system?: string;
  messages: unknown[];
  max_tokens: number;
  output_config?: unknown;
  timeoutMs?: number;
};

// 429 is rate limited, 529 is overloaded, the 5xx are transient on the API side. A 400 or
// 401 will fail the same way every time, so retrying it only makes the person wait longer.
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
const BACKOFF_MS = [500, 1500];

export function claudeModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
}

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms + Math.floor(Math.random() * 250)));

export async function callClaude(opts: CallOptions): Promise<ClaudeResult> {
  const model = claudeModel();
  const started = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, kind: "no_key", detail: "ANTHROPIC_API_KEY is not set", model, ms: 0 };

  const body = JSON.stringify({
    model,
    max_tokens: opts.max_tokens,
    ...(opts.system ? { system: opts.system } : {}),
    ...(opts.output_config ? { output_config: opts.output_config } : {}),
    messages: opts.messages
  });

  let last: { kind: ClaudeFailure; detail: string } = { kind: "upstream", detail: "no attempt made" };
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1]);
    let resp: Response;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25000)
      });
    } catch (err: any) {
      // A timeout is not retried: the person has already waited the whole budget, and a
      // second full wait would outlast the function's maxDuration anyway.
      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        last = { kind: "timeout", detail: `no answer within ${opts.timeoutMs ?? 25000} ms` };
        break;
      }
      last = { kind: "upstream", detail: String(err?.message || err).slice(0, 300) };
      continue;
    }

    if (!resp.ok) {
      const detail = (await resp.text().catch(() => "")).slice(0, 300);
      if (RETRYABLE.has(resp.status)) {
        last = { kind: resp.status === 429 || resp.status === 529 ? "overloaded" : "upstream", detail: `${resp.status} ${detail}` };
        continue;
      }
      last = { kind: "bad_request", detail: `${resp.status} ${detail}` };
      break;
    }

    const data = await resp.json();
    const ms = Date.now() - started;
    // A refusal and a cut-off both arrive as HTTP 200, so they have to be read from
    // stop_reason rather than the status code.
    const textPart = (data.content || []).find((c: any) => c.type === "text");
    const result: ClaudeResult =
      data.stop_reason === "refusal" || data.stop_reason === "max_tokens"
        ? { ok: false, kind: data.stop_reason, detail: `stop_reason ${data.stop_reason}`, model, ms }
        : {
            ok: true,
            text: textPart?.text || "",
            stopReason: data.stop_reason || "",
            model: data.model || model,
            ms,
            usage: data.usage || null
          };
    logCall(opts.route, result);
    return result;
  }

  const failed: ClaudeResult = { ok: false, ...last, model, ms: Date.now() - started };
  logCall(opts.route, failed);
  return failed;
}

// Metadata only, to the function log: never the prompt, the store data, or the answer.
// The raw provider detail lands here instead of on a screen.
function logCall(route: string, r: ClaudeResult) {
  const base = { ai_call: route, model: r.model, ms: r.ms };
  if (r.ok) {
    console.log(JSON.stringify({ ...base, outcome: "ok", stop_reason: r.stopReason, ...r.usage }));
  } else {
    console.warn(JSON.stringify({ ...base, outcome: r.kind, detail: r.detail }));
  }
}

// The words a person sees for each failure. Plain, no em dashes, and always a next step.
export function failureMessage(kind: ClaudeFailure): string {
  switch (kind) {
    case "no_key":
      return "The AI helper is off. The owner can turn it on in the settings.";
    case "timeout":
      return "The AI helper took too long to answer. Try again in a minute.";
    case "overloaded":
      return "The AI helper is busy right now. Try again in a minute.";
    case "refusal":
      return "The AI helper would not answer this one. Try rewording it, or tell the owner.";
    case "max_tokens":
      return "The answer was too long to finish. Ask a narrower question.";
    case "bad_request":
    case "upstream":
    default:
      return "The AI helper could not answer just now. Try again, and tell the owner if it keeps happening.";
  }
}
