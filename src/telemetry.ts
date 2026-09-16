import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { loadConfig, saveConfig, type Config } from "./config.js";

export interface TelemetryEvent {
  schema: 1;
  time: string;
  harmonyVersion: string;
  event: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  timeToFirstTokenMs?: number;
  fallbackDepth?: number;
  toolCalls?: number;
  errorClass?: string;
  status?: number;
  nodeMajor: number;
  platform: string;
}

const QUEUE_PATH = process.env.SNEEZE_TELEMETRY_QUEUE ?? `${homedir()}/.config/harmony/telemetry.jsonl`;
const PACKAGE_VERSION = "0.1.0";

function telemetryConfig(cfg = loadConfig()): NonNullable<Config["telemetry"]> {
  return cfg.telemetry ?? { enabled: false, endpoint: process.env.SNEEZE_TELEMETRY_ENDPOINT };
}

export function telemetryStatus(): { enabled: boolean; endpoint?: string; queued: number; path: string } {
  let queued = 0;
  try { if (existsSync(QUEUE_PATH)) queued = readFileSync(QUEUE_PATH, "utf8").split("\n").filter(Boolean).length; } catch { /* best effort */ }
  const t = telemetryConfig();
  return { enabled: !!t.enabled, endpoint: t.endpoint, queued, path: QUEUE_PATH };
}

export function setTelemetry(enabled: boolean, endpoint?: string): void {
  const cfg = loadConfig();
  cfg.telemetry = { ...(cfg.telemetry ?? {}), enabled, endpoint: endpoint ?? cfg.telemetry?.endpoint ?? process.env.SNEEZE_TELEMETRY_ENDPOINT };
  saveConfig(cfg);
}

export function recordTelemetry(event: Omit<TelemetryEvent, "schema" | "time" | "harmonyVersion" | "nodeMajor" | "platform">): void {
  const t = telemetryConfig();
  if (!t.enabled) return;
  const row: TelemetryEvent = {
    schema: 1,
    time: new Date().toISOString(),
    harmonyVersion: PACKAGE_VERSION,
    nodeMajor: Number(process.versions.node.split(".")[0]),
    platform: process.platform,
    ...event,
  };
  try {
    mkdirSync(dirname(QUEUE_PATH), { recursive: true });
    writeFileSync(QUEUE_PATH, JSON.stringify(row) + "\n", { flag: "a" });
  } catch { /* telemetry never affects an agent run */ }
}

export async function flushTelemetry(): Promise<{ sent: number; remaining: number; reason?: string }> {
  const t = telemetryConfig();
  if (!t.enabled) return { sent: 0, remaining: 0, reason: "disabled" };
  if (!t.endpoint) return { sent: 0, remaining: telemetryStatus().queued, reason: "no endpoint configured" };
  let lines: string[];
  try { lines = readFileSync(QUEUE_PATH, "utf8").split("\n").filter(Boolean); } catch { return { sent: 0, remaining: 0 }; }
  if (!lines.length) return { sent: 0, remaining: 0 };
  try {
    const response = await fetch(t.endpoint, { method: "POST", headers: { "content-type": "application/x-ndjson" }, body: lines.join("\n") + "\n", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { sent: 0, remaining: lines.length, reason: `HTTP ${response.status}` };
    writeFileSync(QUEUE_PATH, "");
    return { sent: lines.length, remaining: 0 };
  } catch (error: any) {
    return { sent: 0, remaining: lines.length, reason: error?.message ?? String(error) };
  }
}

export function telemetryPath(): string { return QUEUE_PATH; }
