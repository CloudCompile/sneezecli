import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
export function recordingPath() {
    return process.env.HARMONY_RECORDINGS ?? process.env.SNEEZE_RECORDINGS ?? `${homedir()}/.config/harmony/recordings.jsonl`;
}
export function recordRun(startedAt, task, cwd, result) {
    const path = recordingPath();
    mkdirSync(dirname(path), { recursive: true });
    const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startedAt,
        endedAt: new Date().toISOString(),
        cwd,
        task,
        status: result.status,
        iterations: result.iterations,
        filesChanged: result.filesChanged,
        toolCalls: result.toolCallsMade.map((call) => ({ name: call.name, resultChars: call.result.length })),
        verificationPassed: result.verificationPassed,
        plan: result.plan,
    };
    appendFileSync(path, JSON.stringify(item) + "\n");
}
