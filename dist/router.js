import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { checkBudget, chat } from "./llm.js";
import { scoreModel } from "./model-data.js";
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/** Per-ranked-group round-robin cursor: next call starts where the last one left off.
 *  Persisted to disk so separate one-shot `run` invocations keep rotating. */
const CURSOR_PATH = process.env.SNEEZE_CURSOR ?? `${homedir()}/.config/harmony/cursor.json`;
function loadCursor() {
    try {
        if (existsSync(CURSOR_PATH)) {
            return new Map(Object.entries(JSON.parse(readFileSync(CURSOR_PATH, "utf8"))).map(([k, v]) => [k, v]));
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
const modelCursor = loadCursor();
/**
 * Rank the model pool for the current task using checked-in/live metadata.
 * Availability and provider/model limits are evaluated at call time, so an
 * exhausted high-scoring model falls through safely.
 * Skip rate-limited / budget-exhausted models. On a 429, wait for the
 * cooldown to expire and retry the same model (up to 2 waits) before
 * falling to the next tier — preserving capability-first ordering.
 */
export async function route(req, pool, cb, task = "") {
    const attempts = [];
    const ranked = [...pool].sort((a, b) => scoreModel(b, task) - scoreModel(a, task));
    const groups = new Map();
    for (const entry of ranked) {
        const score = Math.round(scoreModel(entry, task));
        const group = groups.get(score) ?? [];
        group.push(entry);
        groups.set(score, group);
    }
    for (const group of groups.values()) {
        const key = group.map((e) => `${e.provider}:${e.model}`).join("|");
        const start = (modelCursor.get(key) ?? 0) % group.length;
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
                modelCursor.set(key, (start + gi + 1) % group.length);
                saveCursor(modelCursor);
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
