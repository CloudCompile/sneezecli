import type { ChatMessage, ToolCall } from "./llm.js";
import { route } from "./router.js";
import { runTool, toolDefs, isDangerous } from "./tools.js";
import type { ModelEntry, Config } from "./config.js";

export class AgentAborted extends Error {
  constructor() {
    super("aborted by user");
  }
}

export interface AgentResult {
  finalText: string;
  iterations: number;
  toolCallsMade: { name: string; args: any; result: string }[];
  messages: ChatMessage[];
}

export interface AgentEvents {
  onModel?: (provider: string, model: string) => void;
  onToolStart?: (name: string, args: any) => void;
  onToolEnd?: (name: string, result: string) => void;
  onContent?: (delta: string) => void;
  /** return true to approve a dangerous tool call in safe mode */
  confirm?: (tool: string, summary: string) => Promise<boolean>;
  /** abort signal forwarded to tools (bash kills its child on abort) */
  abortSignal?: AbortSignal;
  /** called to check if the run was aborted (e.g. Esc pressed) */
  isAborted?: () => boolean;
}

export async function runAgent(
  userTask: string,
  pool: ModelEntry[],
  cfg: Config,
  cwd: string,
  history: ChatMessage[] = [],
  events: AgentEvents = {}
): Promise<AgentResult> {
  const toolCallsMade: AgentResult["toolCallsMade"] = [];

  const messages: ChatMessage[] = [...history];
  if (messages.length === 0 && cfg.systemPrompt) {
    messages.push({ role: "system", content: cfg.systemPrompt });
  }
  messages.push({ role: "user", content: userTask });

  const tools = toolDefs();

  const maxIter = cfg.maxIterations ?? 40;
  for (let i = 0; i < maxIter; i++) {
    if (events.isAborted?.()) {
      throw new AgentAborted();
    }
    const resp = await route(
      { messages, tools, maxTokens: cfg.maxTokens },
      pool,
      { onContent: events.onContent }
    );
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

    for (const tc of resp.toolCalls as ToolCall[]) {
      if (events.isAborted?.()) {
        throw new AgentAborted();
      }
      let args: any = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
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

function summarize(name: string, args: any): string {
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
function trimContext(messages: ChatMessage[], max: number): void {
  if (messages.length <= max) return;
  const hasSystem = messages[0]?.role === "system";
  const system = hasSystem ? messages[0] : undefined;
  const rest = hasSystem ? messages.slice(1) : messages;
  const overflow = rest.length - (max - (hasSystem ? 1 : 0));
  if (overflow <= 0) return;
  const kept = rest.slice(overflow);
  // never start mid tool-exchange: drop until we hit a user message
  while (kept.length > 0 && kept[0].role === "tool") kept.shift();
  messages.length = 0;
  if (system) messages.push(system);
  messages.push(...kept);
}
