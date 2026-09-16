import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import type { AgentResult } from "./agent.js";

export interface RunRecording {
  id: string;
  startedAt: string;
  endedAt: string;
  cwd: string;
  task: string;
  status: AgentResult["status"];
  iterations: number;
  filesChanged: number;
  toolCalls: { name: string; resultChars: number }[];
  verificationPassed?: boolean;
  plan?: AgentResult["plan"];
}

export function recordingPath(): string {
  return process.env.HARMONY_RECORDINGS ?? process.env.SNEEZE_RECORDINGS ?? `${homedir()}/.config/harmony/recordings.jsonl`;
}

export function recordRun(startedAt: string, task: string, cwd: string, result: AgentResult): void {
  const path = recordingPath();
  mkdirSync(dirname(path), { recursive: true });
  const item: RunRecording = {
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