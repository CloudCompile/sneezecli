import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
const LOG_PATH = process.env.SNEEZE_LOG ?? `${homedir()}/.config/harmony/harmony.log`;
export function debugLog(event, details = {}) {
    try {
        mkdirSync(dirname(LOG_PATH), { recursive: true });
        appendFileSync(LOG_PATH, JSON.stringify({
            time: new Date().toISOString(),
            pid: process.pid,
            event,
            ...details,
        }) + "\n");
    }
    catch {
        // Diagnostics must never break an agent run.
    }
}
export function debugLogPath() {
    return LOG_PATH;
}
