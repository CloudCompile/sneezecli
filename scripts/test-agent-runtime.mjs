import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = await mkdtemp(join(tmpdir(), "harmony-agent-"));
process.env.SNEEZE_MOCK = "1";
process.env.SNEEZE_CONFIG_DIR = cwd;
const { runAgent } = await import("../dist/agent.js");

const events = [];
const result = await runAgent("inspect the repository", [{ provider: "mock", model: "mock" }], {
  models: [{ provider: "mock", model: "mock" }],
  maxIterations: 2,
  maxTokens: 100,
  systemPrompt: "You are a test agent.",
}, cwd, [], { onTurnEnd: (r) => events.push(r) });
assert.equal(result.status, "completed");
assert.equal(result.iterations, 2);
assert.equal(result.filesChanged, 0);
assert.equal(events.length, 1);
await rm(cwd, { recursive: true, force: true });
console.log("agent runtime lifecycle: ok");
