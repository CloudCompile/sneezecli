import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "harmony-telemetry-"));
process.env.HARMONY_CONFIG_DIR = dir;
process.env.HARMONY_CONFIG = join(dir, "config.json");
process.env.HARMONY_TELEMETRY_QUEUE = join(dir, "telemetry.jsonl");
const { recordTelemetry, setTelemetry, flushTelemetry, telemetryStatus } = await import("../dist/telemetry.js");

recordTelemetry({ event: "disabled", provider: "secret-provider", model: "secret-model" });
assert.equal(telemetryStatus().queued, 0);
setTelemetry(true, "https://collector.invalid/events");
recordTelemetry({ event: "success", provider: "openrouter", model: "safe-model", toolCalls: 1 });
const body = await readFile(join(dir, "telemetry.jsonl"), "utf8");
assert(!body.includes("secret-provider"));
assert(!body.includes("prompt"));
assert(body.includes("openrouter"));

const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  assert.equal(options.method, "POST");
  assert.equal(options.headers["content-type"], "application/x-ndjson");
  assert(!String(options.body).includes("secret"));
  return new Response("ok", { status: 200 });
};
const result = await flushTelemetry();
assert.equal(result.sent, 1);
assert.equal(telemetryStatus().queued, 0);
globalThis.fetch = originalFetch;
await rm(dir, { recursive: true, force: true });
console.log("telemetry privacy and flush: ok");
