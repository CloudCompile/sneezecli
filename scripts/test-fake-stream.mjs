import assert from "node:assert/strict";
import { chat } from "../dist/llm.js";

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.signal instanceof AbortSignal, true);
    const body = [
      'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join("");
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  let output = "";
  const result = await chat(
    { provider: "openrouter", model: "test-model" },
    { messages: [{ role: "user", content: "hi" }], timeoutMs: 1000 },
    { onContent: (delta) => { output += delta; } },
  );
  assert.equal(output, "hello world");
  assert.equal(result.content, "hello world");
  console.log("fake streaming provider: ok");
} finally {
  globalThis.fetch = originalFetch;
}
