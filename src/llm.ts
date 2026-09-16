import type { ModelEntry } from "./config.js";
import { PROVIDERS } from "./providers.js";
import { findCatalogModel } from "./catalog.js";
import { loadConfig } from "./config.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { debugLog } from "./debug-log.js";
import { recordTelemetry } from "./telemetry.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  timeoutMs?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  raw?: unknown;
}

export interface StreamCallbacks {
  onContent?: (delta: string) => void;
  onCorruption?: (content: string, reason: string, provider: string, model: string) => void;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- usage / budget tracking ----------

interface RateState {
  minuteStart: number;
  minuteCount: number;
  dayStart: number;
  dayCount: number;
  tokensSpent: number;
}

export interface Usage {
  requests: number;
  tokensIn: number;
  tokensOut: number;
}

export const usageLog = new Map<string, Usage>();
const cooldownUntil = new Map<string, number>();

/** Rate state persisted to disk so one-shot `run` invocations share budgets. */
const RATE_PATH = process.env.HARMONY_RATE ?? process.env.SNEEZE_RATE ?? `${homedir()}/.config/harmony/rate.json`;

function loadRateStates(): Map<string, RateState> {
  try {
    if (existsSync(RATE_PATH)) {
      return new Map(Object.entries(JSON.parse(readFileSync(RATE_PATH, "utf8"))));
    }
  } catch {
    // corrupt state — start fresh
  }
  return new Map();
}

const rateStates = loadRateStates();

function persistRateStates(): void {
  try {
    mkdirSync(dirname(RATE_PATH), { recursive: true });
    writeFileSync(RATE_PATH, JSON.stringify(Object.fromEntries(rateStates)));
  } catch {
    // best-effort
  }
}

export function entryKey(e: ModelEntry): string {
  return `${e.provider}:${e.model}`;
}

/** Rate-limit bucket key: provider-scoped limits share one bucket across models. */
function bucketKey(e: ModelEntry): string {
  const def = PROVIDERS[e.provider];
  return def.limits.scope === "provider" ? `provider:${e.provider}` : entryKey(e);
}

function nowMinute(): number {
  return Math.floor(Date.now() / 60_000);
}
function nowDay(): number {
  return Math.floor(Date.now() / 86_400_000);
}

function getState(k: string): RateState {
  let s = rateStates.get(k);
  if (!s) {
    s = { minuteStart: nowMinute(), minuteCount: 0, dayStart: nowDay(), dayCount: 0, tokensSpent: 0 };
    rateStates.set(k, s);
  }
  if (s.minuteStart !== nowMinute()) {
    s.minuteStart = nowMinute();
    s.minuteCount = 0;
  }
  if (s.dayStart !== nowDay()) {
    s.dayStart = nowDay();
    s.dayCount = 0;
  }
  return s;
}

/** Put a model on cooldown for the rest of this minute (after a 429). */
export function markRateLimited(e: ModelEntry): void {
  const nextMinute = (nowMinute() + 1) * 60_000;
  cooldownUntil.set(bucketKey(e), nextMinute + 250);
}

export function checkBudget(e: ModelEntry): { ok: boolean; reason?: string } {
  const def = PROVIDERS[e.provider];
  const k = bucketKey(e);
  const until = cooldownUntil.get(k);
  if (until && Date.now() < until) {
    return { ok: false, reason: `cooling down ${Math.ceil((until - Date.now()) / 1000)}s (429)` };
  }
  const cat = findCatalogModel(e.provider, e.model);
  const rpm = e.rpm ?? cat?.rpm ?? def.limits.rpm;
  const s = getState(k);
  if (rpm !== undefined && s.minuteCount >= rpm) {
    return { ok: false, reason: `rpm cap ${rpm}` };
  }
  if (def.limits.rpd !== undefined && s.dayCount >= def.limits.rpd) {
    return { ok: false, reason: `daily cap ${def.limits.rpd}` };
  }
  if (def.limits.totalTokens !== undefined && s.tokensSpent >= def.limits.totalTokens) {
    return { ok: false, reason: `token budget exhausted` };
  }
  return { ok: true };
}

function recordRequest(e: ModelEntry, tokensIn: number, tokensOut: number): void {
  const s = getState(bucketKey(e));
  s.minuteCount++;
  s.dayCount++;
  s.tokensSpent += tokensIn + tokensOut;
  persistRateStates();
  const u = usageLog.get(entryKey(e)) ?? { requests: 0, tokensIn: 0, tokensOut: 0 };
  u.requests++;
  u.tokensIn += tokensIn;
  u.tokensOut += tokensOut;
  usageLog.set(entryKey(e), u);
}

function estTokens(msgs: ChatMessage[]): number {
  return msgs.reduce((n, m) => n + Math.ceil((m.content?.length ?? 0) / 4), 0);
}

function apiKeyFor(e: ModelEntry): string | undefined {
  const def = PROVIDERS[e.provider];
  if (def.keyless) return undefined;
  return process.env[def.keyEnv] ?? loadConfig().apiKeys?.[e.provider];
}

// ---------- mock provider (dev dogfooding) ----------

let mockCalls = 0;
export function resetMock(): void {
  mockCalls = 0;
}

interface MockScript {
  calls: { tool: string; args: Record<string, unknown> }[];
  final: string;
}

function loadMockScript(): MockScript | undefined {
  const p = process.env.HARMONY_MOCK_SCRIPT ?? process.env.SNEEZE_MOCK_SCRIPT;
  if (!p) return undefined;
  return JSON.parse(readFileSync(p, "utf8")) as MockScript;
}

function mockResponse(req: ChatRequest): ChatResponse {
  const script = loadMockScript();
  if (script) {
    if (mockCalls < script.calls.length) {
      const c = script.calls[mockCalls++];
      return {
        content: "",
        toolCalls: [
          {
            id: `mock_call_${mockCalls}`,
            type: "function",
            function: { name: c.tool, arguments: JSON.stringify(c.args) },
          },
        ],
      };
    }
    return { content: script.final, toolCalls: [] };
  }
  if (mockCalls === 0) {
    mockCalls++;
    return {
      content: "",
      toolCalls: [
        {
          id: "mock_call_1",
          type: "function",
          function: { name: "list_dir", arguments: JSON.stringify({ path: "." }) },
        },
      ],
    };
  }
  return { content: `Mock complete. Saw ${req.messages.length} messages in context.`, toolCalls: [] };
}

// ---------- main chat call ----------

export async function chat(
  entry: ModelEntry,
  req: ChatRequest,
  cb?: StreamCallbacks
): Promise<ChatResponse> {
  const def = PROVIDERS[entry.provider];
  const startedAt = Date.now();

  if (entry.provider === "mock") {
    if ((process.env.HARMONY_MOCK ?? process.env.SNEEZE_MOCK) !== "1") throw new Error("Mock provider requires HARMONY_MOCK=1");
    const r = mockResponse(req);
    recordRequest(entry, estTokens(req.messages), Math.ceil(r.content.length / 4));
    if (r.content && cb?.onContent) cb.onContent(r.content);
    return r;
  }

  const key = apiKeyFor(entry);
  if (!key && !def.keyless) throw new Error(`${def.name}: missing ${def.keyEnv} env var`);
  if (!def.baseUrl) throw new Error(`${def.name}: no baseUrl configured`);

  const body: Record<string, unknown> = {
    model: entry.model,
    messages: req.messages,
    max_tokens: req.maxTokens ?? 4096,
  };
  body.temperature = req.temperature ?? 0.2;
  body.top_p = req.topP ?? 0.9;
  const timeoutMs = req.timeoutMs ?? Number(process.env.HARMONY_TIMEOUT_MS ?? process.env.SNEEZE_TIMEOUT_MS ?? 10_000);
  debugLog("request.start", {
    provider: entry.provider,
    model: entry.model,
    messageCount: req.messages.length,
    toolCount: req.tools?.length ?? 0,
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    topP: body.top_p,
    timeoutMs,
    streaming: !!cb?.onContent,
  });
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools;
    body.tool_choice = "auto";
  }
  const streaming = !!cb?.onContent;
  if (streaming) body.stream = true;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  if (entry.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/harmony";
    headers["X-Title"] = "harmony";
  }

  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 700));
    let res: Response;
    try {
      res = await fetch(`${def.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      debugLog("request.http", { provider: entry.provider, model: entry.model, status: res.status });
      recordTelemetry({ event: "http", provider: entry.provider, model: entry.model, status: res.status, latencyMs: Date.now() - startedAt });
    } catch (err: any) {
      lastErr = new Error(`${def.name}: network/timeout error: ${err?.message ?? err}`);
      debugLog("request.network_error", { provider: entry.provider, model: entry.model, error: lastErr.message });
      recordTelemetry({ event: "timeout_or_network_error", provider: entry.provider, model: entry.model, latencyMs: Date.now() - startedAt, errorClass: "network_or_timeout" });
      // Network failures and timeouts belong to the router. Retrying here
      // hides the fallback transition for another full timeout period and
      // makes the TUI look frozen. Only rate limits are retried locally.
      throw lastErr;
    }

    if (res.status === 429) {
      markRateLimited(entry);
      lastErr = new HttpError(429, `${def.name}: rate limited`);
      debugLog("request.rate_limited", { provider: entry.provider, model: entry.model });
      recordTelemetry({ event: "rate_limited", provider: entry.provider, model: entry.model, status: 429, latencyMs: Date.now() - startedAt, errorClass: "rate_limited" });
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new HttpError(res.status, `${def.name} HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    if (streaming && res.body) {
      debugLog("stream.start", { provider: entry.provider, model: entry.model });
      return await consumeStream(entry, req, res, cb!);
    }

    const json = (await res.json()) as any;
    const choice = json.choices?.[0]?.message ?? {};
    const tokensIn = json.usage?.prompt_tokens ?? estTokens(req.messages);
    const tokensOut = json.usage?.completion_tokens ?? Math.ceil((choice.content?.length ?? 0) / 4);
    recordRequest(entry, tokensIn, tokensOut);
    const content = choice.content ?? "";
    const toolCalls = choice.tool_calls?.length ? choice.tool_calls : parseEmbeddedToolCalls(content);
    if (toolCalls.length === 0 && looksGarbled(content)) {
      throw new Error(`${def.name}: model returned likely corrupted text`);
    }
    return {
      content,
      toolCalls,
      raw: json,
    };
  }
  throw lastErr ?? new Error(`${def.name}: request failed`);
}

interface ToolAcc {
  id: string;
  name: string;
  args: string;
}

async function consumeStream(
  entry: ModelEntry,
  req: ChatRequest,
  res: Response,
  cb: StreamCallbacks
): Promise<ChatResponse> {
  const startedAt = Date.now();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  const toolAcc = new Map<number, ToolAcc>();
  let tokensIn = estTokens(req.messages);
  let tokensOut = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        if (j.usage) {
          tokensIn = j.usage.prompt_tokens ?? tokensIn;
          tokensOut = j.usage.completion_tokens ?? tokensOut;
        }
        const d = j.choices?.[0]?.delta ?? {};
        if (d.content) {
          content += d.content;
          tokensOut += Math.ceil(d.content.length / 4);
          cb.onContent?.(d.content);
          if (content.length >= 60 && looksGarbled(content)) {
            const reason = "mixed scripts / statistically unlikely text";
            cb.onCorruption?.(content, reason, entry.provider, entry.model);
            debugLog("response.corrupt", { provider: entry.provider, model: entry.model, chars: content.length, reason });
            recordTelemetry({ event: "corrupt_output", provider: entry.provider, model: entry.model, latencyMs: Date.now() - startedAt, errorClass: "corrupt_output" });
            throw new Error(`${PROVIDERS[entry.provider].name}: model returned likely corrupted text`);
          }
        }
        if (Array.isArray(d.tool_calls)) {
          for (const t of d.tool_calls) {
            const i = t.index ?? 0;
            const acc = toolAcc.get(i) ?? { id: "", name: "", args: "" };
            if (t.id) acc.id = t.id;
            if (t.function?.name) acc.name += t.function.name;
            if (t.function?.arguments) acc.args += t.function.arguments;
            toolAcc.set(i, acc);
          }
        }
      } catch (err) {
        // Ignore malformed individual SSE chunks, but never swallow the
        // deliberate corruption signal: the router must receive it so it can
        // abandon this model and retry with the next one.
        if (err instanceof Error && err.message.includes("model returned likely corrupted text")) {
          throw err;
        }
      }
    }
  }

  recordRequest(entry, tokensIn, tokensOut);
  let toolCalls: ToolCall[] = [...toolAcc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, acc]) => ({
      id: acc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: "function" as const,
      function: { name: acc.name, arguments: acc.args },
    }));
  if (toolCalls.length === 0) toolCalls = parseEmbeddedToolCalls(content);
  if (toolCalls.length === 0 && looksGarbled(content)) {
    throw new Error(`${PROVIDERS[entry.provider].name}: model returned likely corrupted text`);
  }
  debugLog("response.complete", { provider: entry.provider, model: entry.model, chars: content.length, toolCalls: toolCalls.length });
  recordTelemetry({ event: "success", provider: entry.provider, model: entry.model, latencyMs: Date.now() - startedAt, toolCalls: toolCalls.length });
  return { content, toolCalls };
}

function looksGarbled(content: string): boolean {
  if (content.trim().length < 60) return false;
  const counts = [
    /[A-Za-z]/gu,
    /[\u0400-\u04ff]/gu,
    /[\u0370-\u03ff]/gu,
    /[\u0600-\u06ff]/gu,
    /[\u0900-\u097f]/gu,
    /[\u3040-\u30ff]/gu,
    /[\u4e00-\u9fff]/gu,
  ].map((re) => content.match(re)?.length ?? 0);
  // A normal answer may quote another language. Require several substantial
  // script fragments instead of rejecting any response containing one foreign
  // word. This targets the random-token failure mode seen from bad endpoints.
  const substantialScripts = counts.filter((n) => n >= 3).length;
  const letters = counts.reduce((a, b) => a + b, 0);
  return substantialScripts >= 3 && letters >= 24 && letters / content.length > 0.25;
}

/** Recover the simple XML-like tool format emitted by some OpenAI-compatible
 * free models instead of treating it as a successful final answer. */
export function parseEmbeddedToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const re = /<tool_call>\s*<function=([^>]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const args: Record<string, unknown> = {};
    const body = match[2];
    const parameters = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/gi;
    let parameter: RegExpExecArray | null;
    while ((parameter = parameters.exec(body))) {
      const value = parameter[2].trim();
      try {
        args[parameter[1]] = JSON.parse(value);
      } catch {
        args[parameter[1]] = value;
      }
    }
    calls.push({
      id: `embedded_${calls.length + 1}`,
      type: "function",
      function: { name: match[1].trim(), arguments: JSON.stringify(args) },
    });
  }
  return calls;
}
