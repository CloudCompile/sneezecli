import assert from "node:assert/strict";
import { parseEmbeddedToolCalls } from "../dist/llm.js";

const calls = parseEmbeddedToolCalls(
  `<tool_call><function=list_dir><parameter=path>out</parameter></function></tool_call>`
);
assert.equal(calls.length, 1);
assert.equal(calls[0].function.name, "list_dir");
assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: "out" });
console.log("embedded tool parser: ok");
