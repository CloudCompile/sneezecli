import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CATALOG } from "./catalog.js";
import type { ModelEntry } from "./config.js";

export interface ModelMetadata {
  provider: string;
  model: string;
  /** Composite capability score, on a 0–100 scale. */
  capability?: number;
  /** Human preference score, normalized to 0–100. */
  arena?: number;
  /** Coding benchmark score, normalized to 0–100. */
  coding?: number;
  /** Measured output tokens/second. */
  outputTokensPerSecond?: number;
  /** Measured time-to-first-token in milliseconds. */
  ttftMs?: number;
  /** Context window in tokens. */
  context?: number;
  /** semantic capability labels, such as code, reasoning, fast */
  tags?: string[];
  source?: string;
  updatedAt?: string;
}

export interface ModelMetadataFile {
  version: 1;
  generatedAt: string;
  models: ModelMetadata[];
}

const REPO_DATA = resolve(process.cwd(), "data/model-metadata.json");
const FALLBACK_DATA: ModelMetadataFile = {
  version: 1,
  generatedAt: "catalog",
  models: CATALOG.map((m) => ({
    provider: m.provider,
    model: m.model,
    context: m.ctx,
    tags: m.tags,
    source: "built-in-catalog",
  })),
};

export function metadataPath(): string {
  return process.env.SNEEZE_METADATA ?? REPO_DATA;
}

export function loadMetadata(): ModelMetadataFile {
  const p = metadataPath();
  if (!existsSync(p)) return FALLBACK_DATA;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as ModelMetadataFile;
    return { version: 1, generatedAt: parsed.generatedAt ?? "unknown", models: parsed.models ?? [] };
  } catch {
    return FALLBACK_DATA;
  }
}

export function metadataFor(entry: Pick<ModelEntry, "provider" | "model">): ModelMetadata {
  const stored = loadMetadata().models.find((m) => m.provider === entry.provider && m.model === entry.model);
  const catalog = CATALOG.find((m) => m.provider === entry.provider && m.model === entry.model);
  return stored ?? {
    provider: entry.provider,
    model: entry.model,
    context: catalog?.ctx,
    tags: catalog?.tags,
    source: "built-in-catalog",
  };
}

export function allMetadata(): ModelMetadata[] {
  return loadMetadata().models;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[%,$]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function modelName(row: Record<string, unknown>): string | undefined {
  for (const key of ["model", "model_id", "modelId", "slug", "name"]) {
    if (typeof row[key] === "string" && row[key]) return row[key] as string;
  }
  return undefined;
}

function normalizeRows(payload: unknown, source: string): ModelMetadata[] {
  const rows = Array.isArray(payload)
    ? payload
    : (payload as any)?.data ?? (payload as any)?.models ?? (payload as any)?.results ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const model = modelName(row);
    if (!model) return [];
    const provider = String(row.provider ?? row.organization ?? row.org ?? "unknown");
    const tags = [row.tags, row.capabilities].flatMap((v) => Array.isArray(v) ? v : [])
      .filter((v): v is string => typeof v === "string");
    return [{
      provider,
      model,
      capability: numberValue(row.capability ?? row.intelligence_index ?? row.score),
      arena: numberValue(row.arena ?? row.elo ?? row.arena_score),
      coding: numberValue(row.coding ?? row.swe_bench ?? row.swebench),
      outputTokensPerSecond: numberValue(row.output_tokens_per_second ?? row.tokens_per_second ?? row.tps),
      ttftMs: numberValue(row.ttft_ms ?? row.time_to_first_token_ms ?? row.ttft),
      context: numberValue(row.context ?? row.context_window ?? row.max_context),
      tags: tags.length ? tags : undefined,
      source,
      updatedAt: new Date().toISOString(),
    } satisfies ModelMetadata];
  });
}

async function fetchJson(url: string, key?: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

/** Fetch configured public/private datasets and persist a reviewable snapshot. */
export async function syncMetadata(): Promise<ModelMetadataFile> {
  const sources: { url?: string; key?: string; name: string }[] = [
    { url: process.env.SNEEZE_ARTIFICIAL_ANALYSIS_URL, key: process.env.ARTIFICIAL_ANALYSIS_API_KEY, name: "artificial-analysis" },
    { url: process.env.SNEEZE_LMARENA_URL, name: "lmarena" },
  ];
  const fetched: ModelMetadata[] = [];
  for (const source of sources) {
    if (!source.url) continue;
    fetched.push(...normalizeRows(await fetchJson(source.url, source.key), source.name));
  }
  const byKey = new Map<string, ModelMetadata>();
  for (const item of [...FALLBACK_DATA.models, ...fetched]) {
    const key = `${item.provider}:${item.model}`;
    byKey.set(key, { ...byKey.get(key), ...item });
  }
  const output: ModelMetadataFile = { version: 1, generatedAt: new Date().toISOString(), models: [...byKey.values()] };
  const path = metadataPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(output, null, 2) + "\n");
  return output;
}

function tagScore(tags: string[] | undefined, wanted: string[]): number {
  return (tags ?? []).reduce((score, tag) => score + (wanted.includes(tag.toLowerCase()) ? 8 : 0), 0);
}

export function taskProfile(task: string): string[] {
  const text = task.toLowerCase();
  const tags: string[] = [];
  if (/code|refactor|bug|test|debug|implement|function|class|api|regex|sql/.test(text)) tags.push("code");
  if (/architect|design|compare|reason|plan|analy[sz]e|complex/.test(text)) tags.push("reasoning");
  if (/quick|fast|simple|short|summarize|compact/.test(text)) tags.push("fast");
  if (/image|vision|screenshot/.test(text)) tags.push("vision");
  return tags.length ? tags : ["general"];
}

/** Score a model for a task. Availability is applied by the router separately. */
export function scoreModel(entry: ModelEntry, task: string): number {
  const m = metadataFor(entry);
  const wanted = taskProfile(task);
  const capability = m.capability ?? 50;
  const benchmark = Math.max(m.coding ?? 0, wanted.includes("code") ? (m.coding ?? 0) : 0);
  const preference = m.arena ?? 50;
  const speed = m.outputTokensPerSecond ? Math.min(10, m.outputTokensPerSecond / 10) : 0;
  const latency = m.ttftMs ? Math.max(-10, 5 - m.ttftMs / 500) : 0;
  const manualPriority = entry.priority === undefined ? 0 : Math.max(-20, Math.min(20, 10 - entry.priority));
  return capability * 0.55 + benchmark * 0.2 + preference * 0.15 + speed + latency +
    tagScore(m.tags, wanted) + manualPriority;
}
