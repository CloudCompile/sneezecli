import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CATALOG } from "./catalog.js";
const REPO_DATA = resolve(process.cwd(), "data/model-metadata.json");
const FALLBACK_DATA = {
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
export function metadataPath() {
    return process.env.SNEEZE_METADATA ?? REPO_DATA;
}
export function loadMetadata() {
    const p = metadataPath();
    if (!existsSync(p))
        return FALLBACK_DATA;
    try {
        const parsed = JSON.parse(readFileSync(p, "utf8"));
        return { version: 1, generatedAt: parsed.generatedAt ?? "unknown", models: parsed.models ?? [] };
    }
    catch {
        return FALLBACK_DATA;
    }
}
export function metadataFor(entry) {
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
export function allMetadata() {
    return loadMetadata().models;
}
function numberValue(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const n = Number(value.replace(/[%,$]/g, ""));
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}
function modelName(row) {
    for (const key of ["model", "model_id", "modelId", "slug", "name"]) {
        if (typeof row[key] === "string" && row[key])
            return row[key];
    }
    return undefined;
}
function normalizeRows(payload, source) {
    const rows = Array.isArray(payload)
        ? payload
        : payload?.data ?? payload?.models ?? payload?.results ?? [];
    if (!Array.isArray(rows))
        return [];
    return rows.flatMap((item) => {
        if (!item || typeof item !== "object")
            return [];
        const row = item;
        const model = modelName(row);
        if (!model)
            return [];
        const provider = String(row.provider ?? row.organization ?? row.org ?? "unknown");
        const tags = [row.tags, row.capabilities].flatMap((v) => Array.isArray(v) ? v : [])
            .filter((v) => typeof v === "string");
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
            }];
    });
}
async function fetchJson(url, key) {
    const headers = { Accept: "application/json" };
    if (key)
        headers.Authorization = `Bearer ${key}`;
    const response = await fetch(url, { headers });
    if (!response.ok)
        throw new Error(`${url} returned HTTP ${response.status}`);
    return response.json();
}
/** Fetch configured public/private datasets and persist a reviewable snapshot. */
export async function syncMetadata() {
    const sources = [
        { url: process.env.SNEEZE_ARTIFICIAL_ANALYSIS_URL, key: process.env.ARTIFICIAL_ANALYSIS_API_KEY, name: "artificial-analysis" },
        { url: process.env.SNEEZE_LMARENA_URL, name: "lmarena" },
    ];
    const fetched = [];
    for (const source of sources) {
        if (!source.url)
            continue;
        fetched.push(...normalizeRows(await fetchJson(source.url, source.key), source.name));
    }
    const byKey = new Map();
    for (const item of [...FALLBACK_DATA.models, ...fetched]) {
        const key = `${item.provider}:${item.model}`;
        byKey.set(key, { ...byKey.get(key), ...item });
    }
    const output = { version: 1, generatedAt: new Date().toISOString(), models: [...byKey.values()] };
    const path = metadataPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(output, null, 2) + "\n");
    return output;
}
function tagScore(tags, wanted) {
    return (tags ?? []).reduce((score, tag) => score + (wanted.includes(tag.toLowerCase()) ? 8 : 0), 0);
}
export function taskProfile(task) {
    const text = task.toLowerCase();
    const tags = [];
    if (/code|refactor|bug|test|debug|implement|function|class|api|regex|sql/.test(text))
        tags.push("code");
    if (/architect|design|compare|reason|plan|analy[sz]e|complex/.test(text))
        tags.push("reasoning");
    if (/quick|fast|simple|short|summarize|compact/.test(text))
        tags.push("fast");
    if (/image|vision|screenshot/.test(text))
        tags.push("vision");
    return tags.length ? tags : ["general"];
}
/** Score a model for a task. Availability is applied by the router separately. */
export function scoreModel(entry, task) {
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
