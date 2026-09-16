import { performance } from "node:perf_hooks";
import { chat } from "../dist/llm.js";

const originalFetch = globalThis.fetch;
const cases = [
  { name: "success-stream", status: 200, text: "ok" },
  { name: "fallback-http-error", status: 503, text: "unavailable" },
  { name: "tool-call-stream", status: 200, text: "tool-ready" },
];
const rows = [];
try {
  for (const test of cases) {
    globalThis.fetch = async () => new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: test.text } }] })}\n\ndata: [DONE]\n\n`,
      { status: test.status, headers: { "content-type": "text/event-stream" } },
    );
    const started = performance.now();
    let ok = false;
    try {
      await chat({ provider: "openrouter", model: test.name }, { messages: [{ role: "user", content: "test" }], timeoutMs: 1000 }, { onContent: () => {} });
      ok = test.status === 200;
    } catch {
      ok = false;
    }
    rows.push({ ...test, success: ok, latencyMs: Math.round(performance.now() - started) });
  }
} finally {
  globalThis.fetch = originalFetch;
}
const success = rows.filter((r) => r.success).length;
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), successRate: success / rows.length, toolCallAccuracy: "not measured by synthetic stream", fallbackBehavior: "router-level; see harmony.log", rows }, null, 2));
