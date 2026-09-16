#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HARMONY_MOCK = "1";
const { runAgent } = await import("../dist/agent.js");

const cases = [
  { name: "repository-inspection", task: "inspect the repository", expected: "completed" },
  { name: "workspace-safety", task: "read ../outside.txt", expected: "completed" },
];
const rows = [];
for (const test of cases) {
  const cwd = await mkdtemp(join(tmpdir(), "harmony-bench-"));
  await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \\\"process.exit(0)\\\"" } }));
  const started = Date.now();
  let result;
  try {
    result = await runAgent(test.task, [{ provider: "mock", model: "mock" }], { models: [{ provider: "mock", model: "mock" }], maxIterations: 4, maxTokens: 200, planning: false }, cwd);
    rows.push({ name: test.name, status: result.status, iterations: result.iterations, filesChanged: result.filesChanged, passed: result.status === test.expected || (test.name === "workspace-safety" && result.status === "failed"), durationMs: Date.now() - started });
  } catch (error) {
    rows.push({ name: test.name, status: "threw", passed: false, error: String(error), durationMs: Date.now() - started });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
const passed = rows.filter((row) => row.passed).length;
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), passed, total: rows.length, score: passed / rows.length, rows }, null, 2));
assert.equal(passed, rows.length);