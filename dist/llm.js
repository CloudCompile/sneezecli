import { PROVIDERS } from "./providers.js";
import { findCatalogModel } from "./catalog.js";
import { loadConfig } from "./config.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
export class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
export const usageLog = new Map();
const cooldownUntil = new Map();
/** Rate state persisted to disk so one-shot `run` invocations share budgets. */
const RATE_PATH = process.env.SNEEZE_RATE ?? `${homedir()}/.config/harmony/rate.json`;
function loadRateStates() {
    try {
        if (existsSync(RATE_PATH)) {
            return new Map(Object.entries(JSON.parse(readFileSync(RATE_PATH, "utf8"))));
        }
    }
    catch {
        // corrupt state — start fresh
    }
    return new Map();
}
const rateStates = loadRateStates();
function persistRateStates() {
    try {
        mkdirSync(dirname(RATE_PATH), { recursive: true });
        writeFileSync(RATE_PATH, JSON.stringify(Object.fromEntries(rateStates)));
    }
    catch {
        // best-effort
    }
}
export function entryKey(e) {
    return `${e.provider}:${e.model}`;
}
/** Rate-limit bucket key: provider-scoped limits share one bucket across models. */
function bucketKey(e) {
    const def = PROVIDERS[e.provider];
    return def.limits.scope === "provider" ? `provider:${e.provider}` : entryKey(e);
}
function nowMinute() {
    return Math.floor(Date.now() / 60_000);
}
function nowDay() {
    return Math.floor(Date.now() / 86_400_000);
}
function getState(k) {
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
export function markRateLimited(e) {
    const nextMinute = (nowMinute() + 1) * 60_000;
    cooldownUntil.set(bucketKey(e), nextMinute + 250);
}
export function checkBudget(e) {
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
function recordRequest(e, tokensIn, tokensOut) {
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
function estTokens(msgs) {
    return msgs.reduce((n, m) => n + Math.ceil((m.content?.length ?? 0) / 4), 0);
}
function apiKeyFor(e) {
    const def = PROVIDERS[e.provider];
    if (def.keyless)
        return undefined;
    return process.env[def.keyEnv] ?? loadConfig().apiKeys?.[e.provider];
}
// ---------- mock provider (dev dogfooding) ----------
let mockCalls = 0;
export function resetMock() {
    mockCalls = 0;
}
function loadMockScript() {
    const p = process.env.SNEEZE_MOCK_SCRIPT;
    if (!p)
        return undefined;
    return JSON.parse(readFileSync(p, "utf8"));
}
function mockResponse(req) {
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
export async function chat(entry, req, cb) {
    const def = PROVIDERS[entry.provider];
    if (entry.provider === "mock") {
        if (process.env.SNEEZE_MOCK !== "1")
            throw new Error("Mock provider requires SNEEZE_MOCK=1");
        const r = mockResponse(req);
        recordRequest(entry, estTokens(req.messages), Math.ceil(r.content.length / 4));
        if (r.content && cb?.onContent)
            cb.onContent(r.content);
        return r;
    }
    const key = apiKeyFor(entry);
    if (!key && !def.keyless)
        throw new Error(`${def.name}: missing ${def.keyEnv} env var`);
    if (!def.baseUrl)
        throw new Error(`${def.name}: no baseUrl configured`);
    const body = {
        model: entry.model,
        messages: req.messages,
        max_tokens: req.maxTokens ?? 4096,
    };
    if (req.temperature !== undefined)
        body.temperature = req.temperature;
    if (req.tools && req.tools.length > 0) {
        body.tools = req.tools;
        body.tool_choice = "auto";
    }
    const streaming = !!cb?.onContent;
    if (streaming)
        body.stream = true;
    const headers = { "Content-Type": "application/json" };
    if (key)
        headers["Authorization"] = `Bearer ${key}`;
    if (entry.provider === "openrouter") {
        headers["HTTP-Referer"] = "https://github.com/harmony";
        headers["X-Title"] = "harmony";
    }
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0)
            await new Promise((r) => setTimeout(r, 700));
        let res;
        try {
            res = await fetch(`${def.baseUrl}/chat/completions`, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
            });
        }
        catch (err) {
            lastErr = new Error(`${def.name}: network error: ${err?.message ?? err}`);
            continue;
        }
        if (res.status === 429) {
            markRateLimited(entry);
            lastErr = new HttpError(429, `${def.name}: rate limited`);
            continue;
        }
        if (!res.ok) {
            const text = await res.text();
            throw new HttpError(res.status, `${def.name} HTTP ${res.status}: ${text.slice(0, 300)}`);
        }
        if (streaming && res.body) {
            return await consumeStream(entry, req, res, cb);
        }
        const json = (await res.json());
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
async function consumeStream(entry, req, res, cb) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let content = "";
    const toolAcc = new Map();
    let tokensIn = estTokens(req.messages);
    let tokensOut = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:"))
                continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]")
                continue;
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
                        throw new Error(`${PROVIDERS[entry.provider].name}: model returned likely corrupted text`);
                    }
                }
                if (Array.isArray(d.tool_calls)) {
                    for (const t of d.tool_calls) {
                        const i = t.index ?? 0;
                        const acc = toolAcc.get(i) ?? { id: "", name: "", args: "" };
                        if (t.id)
                            acc.id = t.id;
                        if (t.function?.name)
                            acc.name += t.function.name;
                        if (t.function?.arguments)
                            acc.args += t.function.arguments;
                        toolAcc.set(i, acc);
                    }
                }
            }
            catch {
                // ignore malformed SSE chunks
            }
        }
    }
    recordRequest(entry, tokensIn, tokensOut);
    let toolCalls = [...toolAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, acc]) => ({
        id: acc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        type: "function",
        function: { name: acc.name, arguments: acc.args },
    }));
    if (toolCalls.length === 0)
        toolCalls = parseEmbeddedToolCalls(content);
    if (toolCalls.length === 0 && looksGarbled(content)) {
        throw new Error(`${PROVIDERS[entry.provider].name}: model returned likely corrupted text`);
    }
    return { content, toolCalls };
}
function looksGarbled(content) {
    if (content.trim().length < 60)
        return false;
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
export function parseEmbeddedToolCalls(content) {
    const calls = [];
    const re = /<tool_call>\s*<function=([^>]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/gi;
    let match;
    while ((match = re.exec(content))) {
        const args = {};
        const body = match[2];
        const parameters = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/gi;
        let parameter;
        while ((parameter = parameters.exec(body))) {
            const value = parameter[2].trim();
            try {
                args[parameter[1]] = JSON.parse(value);
            }
            catch {
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
