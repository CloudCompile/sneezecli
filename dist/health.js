import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
const PATH = process.env.SNEEZE_HEALTH ?? `${homedir()}/.config/harmony/health.json`;
const records = new Map();
try {
    if (existsSync(PATH)) {
        for (const [key, value] of Object.entries(JSON.parse(readFileSync(PATH, "utf8")))) {
            records.set(key, value);
        }
    }
}
catch { /* reset corrupt diagnostics */ }
const keyOf = (entry) => `${entry.provider}:${entry.model}`;
function save() {
    try {
        mkdirSync(dirname(PATH), { recursive: true });
        writeFileSync(PATH, JSON.stringify(Object.fromEntries(records), null, 2) + "\n");
    }
    catch { /* best effort */ }
}
export function healthOf(entry) {
    return records.get(keyOf(entry)) ?? { failures: 0, successes: 0 };
}
export function healthCheck(entry) {
    const record = healthOf(entry);
    if (record.quarantineUntil && record.quarantineUntil > Date.now()) {
        return { ok: false, reason: `quarantined ${Math.ceil((record.quarantineUntil - Date.now()) / 1000)}s after ${record.failures} failures` };
    }
    return { ok: true };
}
export function recordHealthFailure(entry, error, permanent = false) {
    const old = healthOf(entry);
    const failures = old.failures + 1;
    // Quarantine after repeated failures; duration grows to 30 minutes.
    const quarantineUntil = permanent
        ? Date.now() + 24 * 60 * 60_000
        : failures >= 3 ? Date.now() + Math.min(30 * 60_000, 10_000 * 2 ** Math.min(failures - 3, 7)) : undefined;
    const next = { ...old, failures, lastFailure: new Date().toISOString(), lastError: error, quarantineUntil };
    records.set(keyOf(entry), next);
    save();
    return next;
}
export function recordHealthSuccess(entry) {
    const old = healthOf(entry);
    records.set(keyOf(entry), { ...old, successes: old.successes + 1, failures: 0, quarantineUntil: undefined });
    save();
}
export function healthPath() { return PATH; }
