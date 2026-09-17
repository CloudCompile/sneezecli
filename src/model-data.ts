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
  /** OpenRouter model id used to join provider aliases to broad model data. */
  canonicalId?: string;
  /** Model provider/vendor and pricing/capability hints from public registries. */
  vendor?: string;
  inputPrice?: number;
  outputPrice?: number;
  supportsTools?: boolean;
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
    supportsTools: m.supportsTools,
    tags: m.tags,
    source: "built-in-catalog",
  })),
};

export function metadataPath(): string {
  return process.env.HARMONY_METADATA ?? process.env.SNEEZE_METADATA ?? REPO_DATA;
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
  const all = loadMetadata().models;
  const stored = all.find((m) => m.provider === entry.provider && m.model === entry.model)
    ?? all.find((m) => m.canonicalId === entry.model || m.model === entry.model)
    ?? all.find((m) => normalizeModelId(m.model) === normalizeModelId(entry.model));
  const catalog = CATALOG.find((m) => m.provider === entry.provider && m.model === entry.model);
  return stored ?? {
    provider: entry.provider,
    model: entry.model,
    context: catalog?.ctx,
    supportsTools: catalog?.supportsTools,
    tags: catalog?.tags,
    source: "built-in-catalog",
  };
}

function normalizeModelId(value: string): string {
  return value
    .toLowerCase()
    .replace(/:free$/, "")
    .replace(/^community\/[^/]+\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function allMetadata(): ModelMetadata[] {
  return loadMetadata().models;
}

export function codingScore(entry: Pick<ModelEntry, "provider" | "model">): number {
  const metadata = metadataFor(entry);
  const catalog = CATALOG.find((m) => m.provider === entry.provider && m.model === entry.model);
  const codeTag = metadata.tags?.includes("code") || catalog?.tags?.includes("code");
  return (metadata.coding ?? 0) * 0.5 + (metadata.capability ?? 0) * 0.2 + (codeTag ? 30 : 0) + (metadata.supportsTools === true ? 20 : 0);
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
  for (const key of ["model", "model_id", "modelId", "model_name", "slug", "name"]) {
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
      canonicalId: typeof row.canonical_slug === "string" ? row.canonical_slug : undefined,
      vendor: typeof row.vendor === "string" ? row.vendor : typeof row.organization === "string" ? row.organization : undefined,
      inputPrice: numberValue(row.input_price ?? row.prompt_price ?? row.input_cost),
      outputPrice: numberValue(row.output_price ?? row.completion_price ?? row.output_cost),
      supportsTools: typeof row.supports_tools === "boolean" ? row.supports_tools : undefined,
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

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { Accept: "application/jsonl, text/plain" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

/** Fetch configured public/private datasets and persist a reviewable snapshot. */
export async function syncMetadata(): Promise<ModelMetadataFile> {
  const sources: { url?: string; key?: string; name: string }[] = [
    { url: "https://openrouter.ai/api/v1/models", name: "openrouter" },
    { url: "https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard?name=text", name: "arena-text" },
    { url: "https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard?name=code", name: "arena-code" },
    { url: "https://datasets-server.huggingface.co/first-rows?dataset=open-llm-leaderboard%2Fresults&config=default&split=train", name: "huggingface" },
    { url: "https://raw.githubusercontent.com/Jwrede/llm-bench-data/main/data/2026-09/2026-09-15.jsonl", name: "llm-bench" },
    { url: process.env.HARMONY_ARTIFICIAL_ANALYSIS_URL ?? process.env.SNEEZE_ARTIFICIAL_ANALYSIS_URL, key: process.env.ARTIFICIAL_ANALYSIS_API_KEY, name: "artificial-analysis" },
    { url: process.env.HARMONY_LMARENA_URL ?? process.env.SNEEZE_LMARENA_URL, name: "lmarena" },
  ];
  const fetched: ModelMetadata[] = [];
  for (const source of sources) {
    if (!source.url) continue;
    const payload = source.name === "llm-bench"
      ? await fetchText(source.url)
      : await fetchJson(source.url, source.key);
    if (source.name === "openrouter") fetched.push(...normalizeOpenRouter(payload));
    else if (source.name.startsWith("arena-")) fetched.push(...normalizeArena(payload, source.name));
    else if (source.name === "huggingface") fetched.push(...normalizeHuggingFace(payload));
    else if (source.name === "llm-bench") fetched.push(...normalizeBenchmarkJsonl(payload));
    else fetched.push(...normalizeRows(payload, source.name));
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

function normalizeHuggingFace(payload: unknown): ModelMetadata[] {
  const rows = (payload as any)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((item: any) => {
    const row = item?.row ?? item;
    if (!row || typeof row !== "object") return [];
    const model = modelName(row);
    if (!model) return [];
    const values = Object.values(row).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const capability = values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
    return [{ provider: "unknown", model, capability, source: "huggingface", updatedAt: new Date().toISOString() } satisfies ModelMetadata];
  });
}

function normalizeBenchmarkJsonl(payload: unknown): ModelMetadata[] {
  if (typeof payload !== "string") return [];
  return payload.split(/\r?\n/).flatMap((line) => {
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const model = modelName(row);
      if (!model) return [];
      return [{
        provider: "unknown",
        model,
        outputTokensPerSecond: numberValue(row.output_tokens_per_second ?? row.tokens_per_second ?? row.tps ?? row.itl),
        ttftMs: numberValue(row.ttft_ms ?? row.time_to_first_token_ms ?? row.ttft),
        source: "llm-bench",
        updatedAt: new Date().toISOString(),
      } satisfies ModelMetadata];
    } catch {
      return [];
    }
  });
}

function normalizeOpenRouter(payload: unknown): ModelMetadata[] {
  const rows = (payload as any)?.data;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: any) => {
    if (!row?.id) return [];
    const prompt = Number(row.pricing?.prompt);
    const completion = Number(row.pricing?.completion);
    return [{
      provider: "openrouter",
      model: String(row.id),
      canonicalId: String(row.id),
      vendor: typeof row.name === "string" ? row.name : undefined,
      context: numberValue(row.context_length),
      inputPrice: Number.isFinite(prompt) ? prompt : undefined,
      outputPrice: Number.isFinite(completion) ? completion : undefined,
      supportsTools: Array.isArray(row.supported_parameters) && row.supported_parameters.includes("tools"),
      tags: [row.architecture?.modality].filter((v): v is string => typeof v === "string"),
      source: "openrouter",
      updatedAt: new Date().toISOString(),
    } satisfies ModelMetadata];
  });
}

function normalizeArena(payload: unknown, source: string): ModelMetadata[] {
  const rows = (payload as any)?.models;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: any) => {
    if (!row?.model) return [];
    const score = numberValue(row.score);
    return [{
      provider: "unknown",
      model: String(row.model),
      arena: score,
      capability: score,
      vendor: typeof row.vendor === "string" ? row.vendor : undefined,
      source,
      updatedAt: new Date().toISOString(),
    } satisfies ModelMetadata];
  });
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
