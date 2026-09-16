import { route } from "./router.js";
import { runTool, toolDefs, isDangerous } from "./tools.js";
import { debugLog } from "./debug-log.js";
export class AgentAborted extends Error {
    constructor() {
        super("aborted by user");
    }
}
export async function runAgent(userTask, pool, cfg, cwd, history = [], events = {}) {
    const toolCallsMade = [];
    let filesChanged = 0;
    const messages = [...history];
    if (messages.length === 0 && cfg.systemPrompt) {
        messages.push({ role: "system", content: cfg.systemPrompt });
    }
    messages.push({ role: "user", content: userTask });
    debugLog("agent.start", { task: userTask, cwd, poolSize: pool.length, history: history.length });
    const tools = toolDefs();
    let selectedModel;
    const maxIter = cfg.maxIterations ?? 40;
    for (let i = 0; i < maxIter; i++) {
        if (events.isAborted?.() || events.abortSignal?.aborted) {
            const result = { finalText: "(cancelled)", status: "cancelled", iterations: i, filesChanged, toolCallsMade, messages };
            events.onTurnEnd?.(result);
            throw new AgentAborted();
        }
        const resp = await route({
            messages,
            tools,
            maxTokens: cfg.maxTokens,
            temperature: 1.0,
            topP: 0.9,
            timeoutMs: Number(process.env.SNEEZE_TIMEOUT_MS ?? 10_000),
        }, pool, { onContent: events.onContent, onCorruption: events.onCorruption }, userTask, selectedModel);
        selectedModel = resp.entry;
        debugLog("agent.model", { provider: resp.entry.provider, model: resp.entry.model, iteration: i + 1 });
        events.onModel?.(resp.entry.provider, resp.entry.model);
        if (resp.toolCalls.length === 0) {
            messages.push({ role: "assistant", content: resp.content });
            const result = { finalText: resp.content, status: "completed", iterations: i + 1, filesChanged, toolCallsMade, messages };
            events.onTurnEnd?.(result);
            return result;
        }
        messages.push({
            role: "assistant",
            content: resp.content,
            tool_calls: resp.toolCalls,
        });
        for (const tc of resp.toolCalls) {
            if (events.isAborted?.() || events.abortSignal?.aborted)
                throw new AgentAborted();
            let args = {};
            try {
                args = JSON.parse(tc.function.arguments || "{}");
            }
            catch {
                args = {};
            }
            if (isDangerous(tc.function.name) && !cfg.yolo && events.confirm) {
                const ok = await events.confirm(tc.function.name, summarize(tc.function.name, args));
                if (!ok) {
                    messages.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        content: "DENIED by user.",
                    });
                    continue;
                }
            }
            events.onToolStart?.(tc.function.name, args);
            debugLog("tool.start", { name: tc.function.name, args });
            const result = await runTool(tc.function.name, args, {
                cwd,
                confirm: events.confirm,
                pool,
                cfg,
                signal: events.abortSignal,
            });
            toolCallsMade.push({ name: tc.function.name, args, result });
            if (["write_file", "edit_file", "patch_file", "delete_file"].includes(tc.function.name))
                filesChanged++;
            events.onToolEnd?.(tc.function.name, result);
            debugLog("tool.end", { name: tc.function.name, chars: result.length });
            messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
        trimContext(messages, cfg.maxContextMessages ?? 40);
    }
    const result = {
        finalText: "(max iterations reached without final answer)",
        status: "max_iterations",
        iterations: maxIter,
        filesChanged,
        toolCallsMade,
        messages,
    };
    events.onTurnEnd?.(result);
    return result;
}
function summarize(name, args) {
    switch (name) {
        case "bash":
        case "bash_bg":
            return `$ ${args.command}`;
        case "write_file":
            return `write ${args.path} (${(args.content ?? "").length} bytes)`;
        case "edit_file":
            return `edit ${args.path}`;
        case "patch_file":
            return `patch ${args.path} (${args.edits?.length ?? 0} edits)`;
        case "delete_file":
            return `delete ${args.path}`;
        default:
            return `${name} ${JSON.stringify(args).slice(0, 80)}`;
    }
}
/** Keep system prompt + recent messages; drop oldest middle content when over budget. */
function trimContext(messages, max) {
    if (messages.length <= max)
        return;
    const hasSystem = messages[0]?.role === "system";
    const system = hasSystem ? messages[0] : undefined;
    const rest = hasSystem ? messages.slice(1) : messages;
    const overflow = rest.length - (max - (hasSystem ? 1 : 0));
    if (overflow <= 0)
        return;
    let kept = rest.slice(overflow);
    // Preserve complete assistant tool-call + tool-result exchanges. If the
    // boundary lands inside one, discard that incomplete exchange.
    while (kept.length > 0 && kept[0].role !== "user" && kept[0].role !== "assistant")
        kept.shift();
    if (kept[0]?.role === "assistant" && kept[0].tool_calls) {
        const ids = new Set(kept[0].tool_calls.map((c) => c.id));
        let end = 1;
        while (end < kept.length && kept[end].role === "tool" && ids.has(kept[end].tool_call_id ?? ""))
            end++;
        const complete = [...ids].every((id) => kept.slice(1, end).some((m) => m.tool_call_id === id));
        if (!complete)
            kept = kept.slice(end);
    }
    messages.length = 0;
    if (system)
        messages.push(system);
    messages.push(...kept);
}
