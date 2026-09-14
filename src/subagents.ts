import { runAgent, type AgentEvents } from "./agent.js";
import type { ModelEntry, Config } from "./config.js";

export interface Subtask {
  id: string;
  task: string;
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
  started: string;
  toolCalls: number;
}

const tasks = new Map<string, Subtask>();
let counter = 0;

export function listTasks(): Subtask[] {
  return [...tasks.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getTask(id: string): Subtask | undefined {
  return tasks.get(id);
}

/**
 * Spawn a forked subagent: fresh context, own system prompt, same model pool.
 * Runs in the background; onDone fires with the final result.
 */
export function spawnSubtask(
  task: string,
  pool: ModelEntry[],
  cfg: Config,
  cwd: string,
  events: Partial<AgentEvents> = {},
  onDone?: (t: Subtask) => void
): Subtask {
  const id = `sub-${++counter}`;
  const t: Subtask = { id, task, status: "running", started: new Date().toISOString(), toolCalls: 0 };
  tasks.set(id, t);

  const subCfg: Config = {
    ...cfg,
    maxIterations: 20,
    systemPrompt:
      "You are a focused subagent spawned by the main agent. " +
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
