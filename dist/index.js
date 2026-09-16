#!/usr/bin/env node
import { PROVIDERS, visibleProviders } from "./providers.js";
import { CATALOG, catalogFor, findCatalogModel } from "./catalog.js";
import { scoreModel, syncMetadata, metadataPath } from "./model-data.js";
import { loadConfig, saveConfig, configPath, loadSession } from "./config.js";
import { runAgent } from "./agent.js";
import { usageLog, checkBudget } from "./llm.js";
import { debugLogPath } from "./debug-log.js";
import { flushTelemetry, setTelemetry, telemetryStatus } from "./telemetry.js";
import { startTui } from "./tui.js";
const C = {
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
};
function arg(args, name) {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}
function usage() {
    console.log(`harmony — BYOK agent harness over free LLM providers

Usage:
  harmony                                Interactive TUI (main mode)
  harmony --catalog                      Interactive provider/model catalog
  harmony run "<task>"                   One-shot agent task
  harmony -p "<task>"                    Same as run
  harmony run "<task>" --yolo            Auto-approve dangerous tools
  harmony run "<task>" --resume <id>     Continue a saved session

Pool management:
  harmony add <provider> <model> [priority] [--rpm N]  (advanced)
  harmony add --auto                    Add all catalog models (advanced)
  harmony models [provider]             Browse catalog (advanced)
  harmony remove <index>
  harmony pool                           Show model pool
  harmony status                         Rate-limit / budget state
  harmony cost                           Session token/request usage
  harmony telemetry status               Show anonymous telemetry status
  harmony telemetry enable               Enable local telemetry queueing
  harmony telemetry disable              Disable telemetry queueing
  harmony telemetry flush                Upload queued telemetry
  harmony sync-models                    Refresh optional model metadata

Other:
  harmony setup                          Show provider + key setup
  harmony providers                      List built-in providers
  harmony --help

Providers: ${visibleProviders().map((p) => p.id).join(", ")}

Config: ${configPath()}
Diagnostics: ${debugLogPath()} (override with SNEEZE_LOG)`);
    process.exit(0);
}
function cmdStatus() {
    const cfg = loadConfig();
    if (cfg.models.length === 0) {
        console.log("Pool is empty. Run `harmony setup` or `harmony add`.");
        return;
    }
    console.log("Model pool (task score descending = best first):\n");
    const sorted = [...cfg.models].sort((a, b) => scoreModel(b, "") - scoreModel(a, ""));
    sorted.forEach((m, i) => {
        const def = PROVIDERS[m.provider];
        const b = checkBudget(m);
        const rpm = m.rpm ?? def.limits.rpm;
        const lim = [
            rpm !== undefined ? `${rpm} rpm` : null,
            def.limits.rpd !== undefined ? `${def.limits.rpd} rpd` : null,
            def.limits.totalTokens !== undefined
                ? `${(def.limits.totalTokens / 1e6).toFixed(0)}M token budget`
                : null,
        ]
            .filter(Boolean)
            .join(", ");
        console.log(`  [${i}] score ${String(Math.round(scoreModel(m, ""))).padStart(3)}  ${def.name.padEnd(15)} ${m.model.padEnd(30)} ${lim}  ${b.ok ? "✓" : "✗ " + b.reason}`);
    });
    if (usageLog.size > 0) {
        console.log("\nThis session:");
        for (const [k, u] of usageLog) {
            console.log(`  ${k}: ${u.requests} req, ${u.tokensIn} in, ${u.tokensOut} out`);
        }
    }
}
function cmdModels(provider, tag) {
    let list = provider ? catalogFor(provider) : CATALOG;
    if (tag)
        list = list.filter((m) => m.tags?.includes(tag));
    if (list.length === 0) {
        console.log(provider ? `No models for "${provider}".` : "Catalog is empty.");
        return;
    }
    const byProvider = new Map();
    for (const m of list) {
        if (!byProvider.has(m.provider))
            byProvider.set(m.provider, []);
        byProvider.get(m.provider).push(m);
    }
    for (const [pid, models] of byProvider) {
        const def = PROVIDERS[pid];
        console.log(`\n${def?.name ?? pid}  (${models.length})`);
        for (const m of models) {
            const rpm = m.rpm !== undefined ? ` ${m.rpm} rpm` : " ∞ rpm";
            const ctx = m.ctx ? ` — ${(m.ctx / 1000).toFixed(0)}k ctx` : "";
            const tags = m.tags?.length ? ` [${m.tags.join(",")}]` : "";
            console.log(`  ${m.model.padEnd(55)}${rpm.padEnd(10)}${ctx} ${C.dim(tags)}`);
        }
    }
    console.log(`\nadd with: harmony add <provider> <model> [priority]  |  or: harmony add --auto`);
}
function cmdAddAuto() {
    const cfg = loadConfig();
    let added = 0;
    for (const m of CATALOG) {
        // skip non-text models (asr/tts/image/embed) — the agent can't use them
        if (m.tags?.some((t) => ["asr", "tts", "image", "embed"].includes(t)))
            continue;
        if (cfg.models.some((e) => e.provider === m.provider && e.model === m.model))
            continue;
        const entry = { provider: m.provider, model: m.model };
        if (m.rpm !== undefined)
            entry.rpm = m.rpm;
        cfg.models.push(entry);
        added++;
    }
    saveConfig(cfg);
    console.log(`Added ${added} models from catalog.`);
}
function cmdAdd(provider, model, priorityStr, rpmStr) {
    if (!(provider in PROVIDERS)) {
        console.error(`Unknown provider "${provider}". Providers are a closed list:`);
        console.error(`  ${visibleProviders().map((p) => p.id).join(", ")}`);
        process.exit(1);
    }
    const cfg = loadConfig();
    const entry = {
        provider: provider,
        model,
        priority: priorityStr ? parseInt(priorityStr, 10) : undefined,
    };
    if (rpmStr)
        entry.rpm = parseInt(rpmStr, 10);
    cfg.models.push(entry);
    saveConfig(cfg);
    console.log(`Added ${provider}/${model}${entry.priority !== undefined ? ` at priority ${entry.priority}` : ""}${entry.rpm ? ` (${entry.rpm} rpm)` : ""}`);
}
function cmdRemove(idxStr) {
    const cfg = loadConfig();
    const idx = parseInt(idxStr, 10);
    if (isNaN(idx) || idx < 0 || idx >= cfg.models.length) {
        console.error(`Invalid index. Pool has ${cfg.models.length} entries.`);
        process.exit(1);
    }
    const [removed] = cfg.models.splice(idx, 1);
    saveConfig(cfg);
    console.log(`Removed ${removed.provider}/${removed.model}`);
}
function cmdPool() {
    const cfg = loadConfig();
    if (cfg.models.length === 0) {
        console.log("Pool is empty.");
        return;
    }
    cfg.models.forEach((m, i) => {
        console.log(`  [${i}] ${m.provider}/${m.model}${m.priority !== undefined ? ` (priority ${m.priority})` : ""}${m.rpm ? ` (${m.rpm} rpm)` : ""}`);
    });
}
function cmdProviders() {
    console.log("Built-in providers (closed list — more coming):\n");
    for (const def of visibleProviders()) {
        const lim = [
            def.limits.rpm !== undefined ? `${def.limits.rpm} rpm` : null,
            def.limits.rpd !== undefined ? `${def.limits.rpd} rpd` : null,
            def.limits.totalTokens !== undefined
                ? `${(def.limits.totalTokens / 1e6).toFixed(0)}M tokens one-time`
                : null,
        ]
            .filter(Boolean)
            .join(", ");
        console.log(`  ${def.id.padEnd(15)} ${def.name.padEnd(15)} ${lim || "no known limits"}`);
        console.log(`  ${" ".padEnd(15)} ${def.notes}`);
        console.log(`  ${" ".padEnd(15)} key: ${def.keyEnv}\n`);
    }
}
function cmdSetup() {
    console.log("harmony setup\n");
    console.log("1. Export your API keys:\n");
    for (const def of visibleProviders()) {
        console.log(`   export ${def.keyEnv}=...   # ${def.name} — ${def.notes}`);
    }
    console.log(`\n2. Add the catalog and let task-aware routing rank models:\n`);
    console.log(`   harmony add --auto`);
    console.log(`\n3. Check and run:\n`);
    console.log(`   harmony status`);
    console.log(`   harmony            # interactive REPL`);
    console.log(`   harmony run "task"`);
    console.log(`\nConfig: ${configPath()}`);
}
async function cmdRun(task, cfg, resumeId) {
    const missing = new Set();
    for (const m of cfg.models) {
        const def = PROVIDERS[m.provider];
        if (!def.keyless && !process.env[def.keyEnv] && !cfg.apiKeys?.[m.provider])
            missing.add(def.keyEnv);
    }
    if (missing.size > 0) {
        console.error(`Missing API keys: ${[...missing].join(", ")}`);
        console.error(`Models without keys will be skipped.\n`);
    }
    const cwd = process.cwd();
    console.log(`harmony — task: ${task}\ncwd: ${cwd}\n`);
    const history = resumeId ? (loadSession(resumeId)?.messages ?? []) : [];
    if (resumeId && history.length === 0) {
        console.error(`Session ${resumeId} not found or empty — starting fresh.`);
    }
    const result = await runAgent(task, cfg.models, cfg, cwd, history, {
        onModel: (p, m) => console.log(`[${p}/${m}]`),
        onToolStart: (name, args) => console.log(`⚡ ${name} ${JSON.stringify(args).slice(0, 100)}`),
        onToolEnd: (name, result) => console.log(`  ↳ ${result.split("\n")[0].slice(0, 100)}`),
        onContent: (d) => process.stdout.write(d),
        onCorruption: (_content, reason, provider, model) => console.error(`\n[rejected ${provider}/${model}: ${reason}; retrying]`),
    });
    console.log(`\n---\n${result.finalText}`);
    console.log(`\n(${result.iterations} iterations, ${result.toolCallsMade.length} tool calls)`);
}
function applyRunFlags(args, cfg) {
    const yolo = args.includes("--yolo");
    if (yolo)
        cfg.yolo = true;
    const ri = args.indexOf("--resume");
    const resumeId = ri >= 0 ? args[ri + 1] : undefined;
    const task = args.find((a, i) => a !== "run" && a !== "-p" && a !== "--yolo" && a !== "--resume" && args[i - 1] !== "--resume");
    return { task: task ?? "", resumeId };
}
function cmdCost() {
    if (usageLog.size === 0) {
        console.log("No usage this session yet.");
        return;
    }
    console.log("Session usage:\n");
    let reqs = 0, tin = 0, tout = 0;
    for (const [k, u] of usageLog) {
        console.log(`  ${k.padEnd(40)} ${String(u.requests).padStart(4)} req  ${u.tokensIn} in  ${u.tokensOut} out`);
        reqs += u.requests;
        tin += u.tokensIn;
        tout += u.tokensOut;
    }
    console.log(`  ${"total".padEnd(40)} ${String(reqs).padStart(4)} req  ${tin} in  ${tout} out`);
}
async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    if (cmd === "--catalog" || cmd === "catalog") {
        const cfg = loadConfig();
        await startTui(cfg.models, cfg, process.cwd(), "/catalog");
        return;
    }
    if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
        // no args = TUI mode
        if (!cmd) {
            const cfg = loadConfig();
            if (cfg.models.length === 0) {
                // allow TUI with empty pool — user configures a provider interactively
                console.error(cDim("Pool is empty — use /provider or /catalog inside the TUI."));
                console.error("");
            }
            await startTui(cfg.models, cfg, process.cwd());
            return;
        }
        usage();
    }
    function cDim(s) {
        return `\x1b[2m${s}\x1b[0m`;
    }
    switch (cmd) {
        case "telemetry": {
            const action = args[1] ?? "status";
            if (action === "enable") {
                setTelemetry(true, args[2]);
                console.log("Telemetry enabled. It records only anonymous reliability metrics locally.");
            }
            else if (action === "disable") {
                setTelemetry(false);
                console.log("Telemetry disabled. Existing queued data was retained.");
            }
            else if (action === "flush") {
                console.log(await flushTelemetry());
            }
            else if (action === "status") {
                console.log(telemetryStatus());
            }
            else {
                console.error("Usage: harmony telemetry [status|enable [endpoint]|disable|flush]");
                process.exitCode = 1;
            }
            break;
        }
        case "cost":
            cmdCost();
            break;
        case "setup":
            cmdSetup();
            break;
        case "providers":
            cmdProviders();
            break;
        case "sync-models":
            await syncMetadata();
            console.log(`Model metadata written to ${metadataPath()}`);
            break;
        case "models":
            cmdModels(args[1] === "--tag" ? undefined : args[1], arg(args, "--tag"));
            break;
        case "add": {
            if (args[1] === "--auto") {
                cmdAddAuto();
                break;
            }
            const provider = args[1];
            const model = args[2];
            const tier = args[3];
            const rpm = arg(args, "--rpm");
            if (!provider || !model) {
                console.error("Usage: harmony add <provider> <model> [tier] [--rpm N]");
                process.exit(1);
            }
            const cat = findCatalogModel(provider, model);
            if (!cat) {
                console.error(`"${model}" is not in the ${provider} catalog.`);
                console.error(`Browse: harmony models ${provider}`);
                process.exit(1);
            }
            cmdAdd(provider, model, tier, rpm);
            break;
        }
        case "remove":
            if (!args[1]) {
                console.error("Usage: harmony remove <index>");
                process.exit(1);
            }
            cmdRemove(args[1]);
            break;
        case "pool":
            cmdPool();
            break;
        case "status":
            cmdStatus();
            break;
        case "run":
        case "-p": {
            const cfg = loadConfig();
            const { task, resumeId } = applyRunFlags(args, cfg);
            if (!task) {
                console.error(`Usage: harmony run "<task>" [--yolo] [--resume <id>]`);
                process.exit(1);
            }
            if (cfg.models.length === 0) {
                console.error("Pool is empty. Add models first: harmony add --auto");
                process.exit(1);
            }
            await cmdRun(task, cfg, resumeId);
            break;
        }
        default:
            console.error(`Unknown command: ${cmd}`);
            usage();
    }
}
main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
});
