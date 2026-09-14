import type { ModelEntry } from "./config.js";
import { checkBudget, chat, type ChatRequest, type ChatResponse, type StreamCallbacks } from "./llm.js";

export interface RouteAttempt {
  entry: ModelEntry;
  error?: string;
}

export interface RouteResult extends ChatResponse {
  entry: ModelEntry;
  attempts: RouteAttempt[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Walk the model pool by tier (ascending = best first), then pool order.
 * Skip rate-limited / budget-exhausted models. On a 429, wait for the
 * cooldown to expire and retry the same model (up to 2 waits) before
 * falling to the next tier — preserving capability-first ordering.
 */
export async function route(
  req: ChatRequest,
  pool: ModelEntry[],
  cb?: StreamCallbacks
): Promise<RouteResult> {
  const sorted = [...pool].sort((a, b) => a.tier - b.tier);
  const attempts: RouteAttempt[] = [];

  for (const entry of sorted) {
    // wait out 429 cooldowns instead of immediately degrading capability
    for (let waits = 0; waits < 2; waits++) {
      const budget = checkBudget(entry);
      if (budget.ok) break;
      const cooling = budget.reason?.includes("cooling down");
      if (!cooling) {
        attempts.push({ entry, error: budget.reason });
        break;
      }
      attempts.push({ entry, error: budget.reason });
      await sleep(2_500);
    }

    if (!checkBudget(entry).ok) continue;

    try {
      const resp = await chat(entry, req, cb);
      attempts.push({ entry });
      return { ...resp, entry, attempts };
    } catch (err: any) {
      attempts.push({ entry, error: err?.message ?? String(err) });
      continue;
    }
  }

  throw new Error(
    `All ${pool.length} models exhausted or unavailable.\n` +
      attempts.map((a) => `  - ${a.entry.provider}/${a.entry.model}: ${a.error ?? "ok"}`).join("\n")
  );
}
