import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = await mkdtemp(join(tmpdir(), "harmony-verify-"));
await writeFile(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e process.exit(0)" } }));
const { verifyWorkspace } = await import("../dist/verification.js");
const result = await verifyWorkspace(cwd);
assert.equal(result.passed, true);
assert.equal(result.checks.length, 1);
assert.equal(result.checks[0].name, "npm");
await rm(cwd, { recursive: true, force: true });
console.log("workspace verification: ok");
