import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import type { ProviderId } from "./providers.js";

export interface ModelEntry {
  provider: ProviderId;
  /** exact model id string as the provider API expects — user supplies this */
  model: string;
  /** capability tier: 1 = best, higher = lower. Router picks lowest tier available. */
  tier: number;
  /** per-model rpm override (e.g. Pollinations per-model limits) */
  rpm?: number;
  label?: string;
}

export interface Config {
  models: ModelEntry[];
  maxTokens?: number;
  systemPrompt?: string;
  /** auto-approve tool calls without prompting (default: prompt for writes/bash) */
  yolo?: boolean;
  /** max context messages kept before trimming (default 40) */
  maxContextMessages?: number;
  /** max agent loop iterations (default 40) */
  maxIterations?: number;
  /** optional session name shown in pickers */
  name?: string;
}

const CONFIG_DIR = `${homedir()}/.config/sneezecli`;
const SESSIONS_DIR = `${CONFIG_DIR}/sessions`;
const CONFIG_PATH = `${CONFIG_DIR}/config.json`;

export function configPath(): string {
  return process.env.SNEEZE_CONFIG ?? CONFIG_PATH;
}
export function sessionsDir(): string {
  return SESSIONS_DIR;
}

export function loadConfig(): Config {
  const p = configPath();
  if (!existsSync(p)) return { models: [] };
  return JSON.parse(readFileSync(p, "utf8")) as Config;
}

export function saveConfig(cfg: Config): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

export function defaultConfig(): Config {
  return {
    models: [],
    maxTokens: 4096,
    maxContextMessages: 40,
    yolo: false,
    systemPrompt:
      "You are sneezecli, a capable coding agent working in the user's repository. " +
      "Use the provided tools to read, explore, edit, and run code. " +
      "Prefer precise edit_file operations over rewriting whole files. " +
      "When done, summarize what you changed.",
  };
}

// ---------- sessions ----------

export interface Session {
  id: string;
  created: string;
  cwd: string;
  name?: string;
  messages: ChatMessageLite[];
}

export interface ChatMessageLite {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export function saveSession(s: Session): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(`${SESSIONS_DIR}/${s.id}.json`, JSON.stringify(s, null, 2) + "\n");
}

export function loadSession(id: string): Session | undefined {
  const p = `${SESSIONS_DIR}/${id}.json`;
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, "utf8")) as Session;
}

export function listSessions(): Session[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSorted(SESSIONS_DIR)
    .map((f) => JSON.parse(readFileSync(`${SESSIONS_DIR}/${f}`, "utf8")) as Session)
    .sort((a, b) => b.created.localeCompare(a.created));
}

function readdirSorted(dir: string): string[] {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir).filter((f) => f.endsWith(".json"));
}

export function newSessionId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
