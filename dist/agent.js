import { route } from "./router.js";
import { runTool, toolDefs, isDangerous } from "./tools.js";
export class AgentAborted extends Error {
    constructor() {
        super("aborted by user");
    }
}
export async function runAgent(userTask, pool, cfg, cwd, history = [], events = {}) {
    const toolCallsMade = [];
    const messages = [...history];
    if (messages.length === 0 && cfg.systemPrompt) {
        messages.push({ role: "system", content: cfg.systemPrompt });
    }
    messages.push({ role: "user", content: userTask });
    const tools = toolDefs();
    let selectedModel;
    const maxIter = cfg.maxIterations ?? 40;
    for (let i = 0; i < maxIter; i++) {
        if (events.isAborted?.()) {
            throw new AgentAborted();
        }
        const resp = await route({ messages, tools, maxTokens: cfg.maxTokens }, pool, { onContent: events.onContent, onCorruption: events.onCorruption }, userTask, selectedModel);
        selectedModel = resp.entry;
        events.onModel?.(resp.entry.provider, resp.entry.model);
        if (resp.toolCalls.length === 0) {
            messages.push({ role: "assistant", content: resp.content });
            return { finalText: resp.content, iterations: i + 1, toolCallsMade, messages };
        }
        messages.push({
            role: "assistant",
            content: resp.content,
            tool_calls: resp.toolCalls,
        });
        for (const tc of resp.toolCalls) {
            if (events.isAborted?.()) {
                throw new AgentAborted();
            }
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
            const result = await runTool(tc.function.name, args, {
                cwd,
                confirm: events.confirm,
                pool,
                cfg,
                signal: events.abortSignal,
            });
            toolCallsMade.push({ name: tc.function.name, args, result });
            events.onToolEnd?.(tc.function.name, result);
            messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
        trimContext(messages, cfg.maxContextMessages ?? 40);
    }
    return {
        finalText: "(max iterations reached without final answer)",
        iterations: maxIter,
        toolCallsMade,
        messages,
    };
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
    const kept = rest.slice(overflow);
    // never start mid tool-exchange: drop until we hit a user message
    while (kept.length > 0 && kept[0].role === "tool")
        kept.shift();
    messages.length = 0;
    if (system)
        messages.push(system);
    messages.push(...kept);
}
