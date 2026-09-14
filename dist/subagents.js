import { runAgent } from "./agent.js";
const tasks = new Map();
let counter = 0;
export function listTasks() {
    return [...tasks.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function getTask(id) {
    return tasks.get(id);
}
/**
 * Spawn a forked subagent: fresh context, own system prompt, same model pool.
 * Runs in the background; onDone fires with the final result.
 */
export function spawnSubtask(task, pool, cfg, cwd, events = {}, onDone) {
    const id = `sub-${++counter}`;
    const t = { id, task, status: "running", started: new Date().toISOString(), toolCalls: 0 };
    tasks.set(id, t);
    const subCfg = {
        ...cfg,
        maxIterations: 20,
        systemPrompt: "You are a focused subagent spawned by the main agent. " +
            "Complete the given task autonomously and report a concise result. " +
            (cfg.systemPrompt ?? ""),
    };
    runAgent(task, pool, subCfg, cwd, [], {
        ...events,
        onToolEnd: (name, result) => {
            t.toolCalls++;
            events.onToolEnd?.(name, result);
        },
    })
        .then((r) => {
        t.status = "done";
        t.result = r.finalText;
        onDone?.(t);
    })
        .catch((err) => {
        t.status = "error";
        t.error = err?.message ?? String(err);
        onDone?.(t);
    });
    return t;
}
