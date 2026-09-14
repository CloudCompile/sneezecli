import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { checkBudget, chat } from "./llm.js";
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/** Per-tier round-robin cursor: next call starts where the last one left off.
 *  Persisted to disk so separate one-shot `run` invocations keep rotating. */
const CURSOR_PATH = process.env.SNEEZE_CURSOR ?? `${homedir()}/.config/sneezecli/cursor.json`;
function loadCursor() {
    try {
        if (existsSync(CURSOR_PATH)) {
            return new Map(Object.entries(JSON.parse(readFileSync(CURSOR_PATH, "utf8"))).map(([k, v]) => [Number(k), v]));
        }
    }
    catch {
        // corrupt cursor — start fresh
    }
    return new Map();
}
function saveCursor(c) {
    try {
        mkdirSync(dirname(CURSOR_PATH), { recursive: true });
        writeFileSync(CURSOR_PATH, JSON.stringify(Object.fromEntries(c)));
    }
    catch {
        // cursor persistence is best-effort
    }
}
const tierCursor = loadCursor();
/**
 * Walk the model pool by tier (ascending = best first), then pool order.
 * Within a tier, round-robin: consecutive calls start at the next model,
 * spreading load across same-tier models (critical for OpenRouter's 50 RPD
 * account cap and for multiplying Pollinations' per-model RPM).
 * Skip rate-limited / budget-exhausted models. On a 429, wait for the
 * cooldown to expire and retry the same model (up to 2 waits) before
 * falling to the next tier — preserving capability-first ordering.
 */
export async function route(req, pool, cb) {
    const attempts = [];
    const tiers = [...new Set(pool.map((m) => m.tier))].sort((a, b) => a - b);
    for (const tier of tiers) {
        const group = pool.filter((m) => m.tier === tier);
        const start = group.length > 0 ? (tierCursor.get(tier) ?? 0) % group.length : 0;
        const rotated = [...group.slice(start), ...group.slice(0, start)];
        for (let gi = 0; gi < rotated.length; gi++) {
            const entry = rotated[gi];
            // wait out 429 cooldowns instead of immediately degrading capability
            let waited = false;
            for (let waits = 0; waits < 2; waits++) {
                const budget = checkBudget(entry);
                if (budget.ok)
                    break;
                const cooling = budget.reason?.includes("cooling down");
                if (!cooling) {
                    attempts.push({ entry, error: budget.reason });
                    waited = false;
                    break;
                }
                attempts.push({ entry, error: budget.reason });
                await sleep(2_500);
                waited = true;
            }
            if (waited && !checkBudget(entry).ok)
                continue;
            if (!checkBudget(entry).ok)
                continue;
            try {
                const resp = await chat(entry, req, cb);
                // advance cursor past the model that just succeeded
                tierCursor.set(tier, (start + gi + 1) % group.length);
                saveCursor(tierCursor);
                attempts.push({ entry });
                return { ...resp, entry, attempts };
            }
            catch (err) {
                attempts.push({ entry, error: err?.message ?? String(err) });
                continue;
            }
        }
    }
    throw new Error(`All ${pool.length} models exhausted or unavailable.\n` +
        attempts.map((a) => `  - ${a.entry.provider}/${a.entry.model}: ${a.error ?? "ok"}`).join("\n"));
}
