import * as readline from "node:readline";
import { runAgent, AgentAborted } from "./agent.js";
import { saveSession, listSessions, newSessionId, deleteSession, } from "./config.js";
import { PROVIDERS, visibleProviders } from "./providers.js";
import { CATALOG } from "./catalog.js";
import { usageLog, checkBudget } from "./llm.js";
import { listTasks, spawnSubtask, getTask } from "./subagents.js";
// ── colors ────────────────────────────────────────────────────────────
const c = {
    reset: (s) => `\x1b[0m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    blue: (s) => `\x1b[34m${s}\x1b[0m`,
    magenta: (s) => `\x1b[35m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    gray: (s) => `\x1b[90m${s}\x1b[0m`,
    white: (s) => `\x1b[97m${s}\x1b[0m`,
};
function box(title, lines, width) {
    const out = [];
    const inner = width - 4;
    out.push(`${c.cyan}┌─${c.bold} ${title} ${c.reset}${c.cyan}${"─".repeat(Math.max(0, inner - title.length - 2))}┐${c.reset}`);
    for (const l of lines) {
        const visible = l.replace(/\x1b\[[0-9;]*m/g, "");
        const pad = Math.max(0, inner - visible.length);
        out.push(`${c.cyan}│${c.reset} ${l}${" ".repeat(pad)} ${c.cyan}│${c.reset}`);
    }
    out.push(`${c.cyan}└${"─".repeat(inner + 2)}┘${c.reset}`);
    return out;
}
function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function enableRaw(h) {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", (d) => h.onKey(d.toString(), d));
    }
}
function disableRaw() {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
    }
}
// ── picker ────────────────────────────────────────────────────────────
async function pick(title, items, current) {
    return new Promise((resolve) => {
        let sel = current !== undefined ? Math.max(0, current) : 0;
        const render = () => {
            const lines = items.map((it, i) => {
                const arrow = i === sel ? `${c.cyan}❯${c.reset} ` : "  ";
                const label = i === sel ? `${c.bold}${it.label}${c.reset}` : it.label;
                const hint = it.hint ? ` ${c.gray}${it.hint}${c.reset}` : "";
                return `${arrow}${label}${hint}`;
            });
            console.clear();
            console.log(box(title, lines.slice(0, 30), 90));
            console.log(c.gray("  ↑/↓ move · enter select · esc cancel · type to filter") + c.reset);
        };
        let filter = "";
        const refilter = () => {
            // simple filter: keep items whose label includes filter
            return items.filter((it) => it.label.toLowerCase().includes(filter.toLowerCase()));
        };
        render();
        const h = {
            onKey: (key) => {
                if (key === "\x1b[A") {
                    sel = Math.max(0, sel - 1);
                    render();
                }
                else if (key === "\x1b[B") {
                    sel = Math.min(items.length - 1, sel + 1);
                    render();
                }
                else if (key === "\r" || key === "\n") {
                    cleanup();
                    resolve(items[sel]?.value);
                }
                else if (key === "\x1b" || key === "\x03") {
                    cleanup();
                    resolve(undefined);
                }
                else if (key === "\x7f") {
                    filter = filter.slice(0, -1);
                    render();
                }
                else if (key.length === 1 && key >= " ") {
                    filter += key;
                    const filtered = refilter();
                    if (filtered.length > 0 && !filtered.includes(items[sel])) {
                        sel = items.indexOf(filtered[0]);
                    }
                    render();
                }
            },
        };
        function cleanup() {
            process.stdin.removeListener("data", h.onKey);
            disableRaw();
            console.clear();
        }
        enableRaw(h);
    });
}
// ── confirm ───────────────────────────────────────────────────────────
async function confirmPrompt(tool, summary) {
    return new Promise((resolve) => {
        process.stdout.write(`\n${c.yellow}⚠ ${tool}${c.reset} ${c.gray}${summary}${c.reset}\n${c.bold}[y]es / [a]ll / [n]o ${c.reset}`);
        const h = {
            onKey: (key) => {
                const k = key.toLowerCase();
                if (k === "y" || k === "\r") {
                    cleanup();
                    resolve(true);
                }
                else if (k === "a") {
                    process.env.SNEEZE_YOLO_SESSION = "1";
                    cleanup();
                    resolve(true);
                }
                else if (k === "n" || k === "\x1b" || k === "\x03") {
                    cleanup();
                    resolve(false);
                }
            },
        };
        function cleanup() {
            process.stdout.write("\n");
            process.stdin.removeListener("data", h.onKey);
        }
        enableRaw(h);
    });
}
export async function startTui(pool, cfg, cwd) {
    const state = {
        session: { id: newSessionId(), created: new Date().toISOString(), cwd, messages: [] },
        pool,
        cfg,
        cwd,
        running: false,
        abort: null,
        statusLine: "",
        lastModel: "",
    };
    console.clear();
    banner(state);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${c.green}❯${c.reset} `,
        terminal: true,
    });
    rl.prompt();
    rl.on("line", async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }
        if (input.startsWith("/")) {
            await handleCommand(state, input, rl);
            if (!state.running)
                rl.prompt();
            return;
        }
        // agent turn
        state.running = true;
        rl.pause();
        await agentTurn(state, input, rl);
        state.running = false;
        rl.resume();
        rl.prompt();
    });
    rl.on("close", () => {
        console.log(c.gray("\nbye") + c.reset);
        process.exit(0);
    });
}
function banner(state) {
    const poolInfo = state.pool.length
        ? `${state.pool.length} models`
        : "empty pool — /model to add";
    const lines = [
        `${c.bold}${c.magenta}  ⚡ sneezecli${c.reset} ${c.gray}—${c.reset} ${poolInfo} ${c.gray}·${c.reset} session ${c.dim}${state.session.id}${c.reset}`,
        `${c.gray}  /help for commands · esc aborts a running turn${c.reset}`,
    ];
    console.log(lines.join("\n") + "\n");
}
async function handleCommand(state, input, rl) {
    const [cmd, ...rest] = input.split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd) {
        case "/help":
            printHelp();
            break;
        case "/new":
        case "/clear":
        case "/reset":
            state.session = { id: newSessionId(), created: new Date().toISOString(), cwd: state.cwd, messages: [] };
            console.log(c.gray(`new session ${state.session.id}`) + c.reset);
            break;
        case "/resume":
        case "/continue": {
            const sessions = listSessions().slice(0, 15);
            if (sessions.length === 0) {
                console.log(c.gray("no saved sessions") + c.reset);
                break;
            }
            const picked = await pick("Resume session", sessions.map((s) => ({
                label: s.name ?? s.id,
                hint: `${s.messages.length} msgs · ${s.created.slice(0, 16).replace("T", " ")}`,
                value: s,
            })));
            if (picked) {
                state.session = picked;
                state.cwd = picked.cwd;
                console.log(c.gray(`resumed ${picked.name ?? picked.id} (${picked.messages.length} msgs)`) + c.reset);
            }
            break;
        }
        case "/sessions": {
            const sessions = listSessions().slice(0, 20);
            if (sessions.length === 0)
                console.log(c.gray("no saved sessions") + c.reset);
            else {
                for (const s of sessions) {
                    console.log(`  ${c.cyan}${(s.name ?? s.id).padEnd(24)}${c.reset} ${c.gray}${s.messages.length} msgs · ${s.created.slice(0, 16).replace("T", " ")}${c.reset}`);
                }
            }
            break;
        }
        case "/delete-session": {
            const sessions = listSessions().slice(0, 15);
            const picked = await pick("Delete session", sessions.map((s) => ({ label: s.name ?? s.id, hint: `${s.messages.length} msgs`, value: s })));
            if (picked) {
                deleteSession(picked.id);
                console.log(c.yellow(`deleted ${picked.name ?? picked.id}`) + c.reset);
            }
            break;
        }
        case "/rename":
            if (arg) {
                state.session.name = arg;
                saveSession(state.session);
                console.log(c.gray(`renamed to ${arg}`) + c.reset);
            }
            else
                console.log(c.red("usage: /rename <name>") + c.reset);
            break;
        case "/model":
        case "/models": {
            const picked = await pickModel(state);
            if (picked) {
                state.pool = [picked, ...state.pool.filter((m) => !(m.provider === picked.provider && m.model === picked.model))];
                console.log(c.green(`✓ primary model: ${c.bold}${picked.provider}/${picked.model}${c.reset}${c.green} (tier ${picked.tier})`) + c.reset);
            }
            break;
        }
        case "/pool":
            if (state.pool.length === 0)
                console.log(c.gray("pool is empty — /model to add") + c.reset);
            state.pool.forEach((m, i) => {
                const def = PROVIDERS[m.provider];
                const b = checkBudget(m);
                console.log(`  ${i === 0 ? c.green + "★" : c.gray + " "} [${i}]${c.reset} tier ${m.tier}  ${c.cyan}${m.provider}/${m.model}${c.reset} ${c.gray}${m.rpm ? m.rpm + "rpm" : ""}${b.ok ? "" : " " + c.red + b.reason + c.reset}`);
            });
            break;
        case "/providers":
            for (const p of visibleProviders()) {
                console.log(`  ${c.cyan}${p.id.padEnd(20)}${c.reset} ${c.gray}${p.notes}${c.reset}`);
            }
            break;
        case "/catalog": {
            const prov = arg || (await pickProvider());
            if (!prov)
                break;
            const models = CATALOG.filter((m) => m.provider === prov);
            const picked = await pick(`${prov} models (${models.length})`, models.map((m) => ({
                label: m.model,
                hint: `${m.rpm ? m.rpm + "rpm" : "∞"} ${m.ctx ? (m.ctx / 1000) + "k" : ""} ${(m.tags ?? []).join(",")}`,
                value: m,
            })));
            if (picked) {
                const entry = { provider: picked.provider, model: picked.model, tier: picked.tier ?? 3, rpm: picked.rpm };
                state.pool.push(entry);
                console.log(c.green(`✓ added ${picked.provider}/${picked.model} at tier ${entry.tier}`) + c.reset);
            }
            break;
        }
        case "/cwd":
            if (arg) {
                state.cwd = arg;
                state.session.cwd = arg;
                console.log(c.gray(`cwd → ${state.cwd}`) + c.reset);
            }
            else
                console.log(`  ${c.gray}${state.cwd}${c.reset}`);
            break;
        case "/yolo":
            state.cfg.yolo = !state.cfg.yolo;
            console.log(state.cfg.yolo ? c.yellow("yolo ON — no confirmations") + c.reset : c.gray("yolo OFF — prompting for dangerous tools") + c.reset);
            break;
        case "/usage":
        case "/cost": {
            if (usageLog.size === 0) {
                console.log(c.gray("no usage this session") + c.reset);
                break;
            }
            let reqs = 0, tin = 0, tout = 0;
            for (const [k, u] of usageLog) {
                console.log(`  ${c.cyan}${k.padEnd(40)}${c.reset} ${u.requests} req  ${u.tokensIn} in  ${u.tokensOut} out`);
                reqs += u.requests;
                tin += u.tokensIn;
                tout += u.tokensOut;
            }
            console.log(`  ${c.bold}${"total".padEnd(40)}${c.reset} ${reqs} req  ${tin} in  ${tout} out`);
            break;
        }
        case "/tasks": {
            const tasks = listTasks();
            if (tasks.length === 0) {
                console.log(c.gray("no background tasks — ask the agent to spawn one with the subtask tool") + c.reset);
                break;
            }
            for (const t of tasks) {
                const icon = t.status === "running" ? c.yellow + "●" : t.status === "done" ? c.green + "✓" : c.red + "✗";
                console.log(`  ${icon}${c.reset} ${c.cyan}${t.id}${c.reset} ${c.gray}${t.status} · ${t.toolCalls} tools${c.reset}`);
                console.log(`    ${c.dim}${truncate(t.task, 80)}${c.reset}`);
                if (t.result)
                    console.log(`    ${c.gray}${truncate(t.result, 100)}${c.reset}`);
                if (t.error)
                    console.log(`    ${c.red}${truncate(t.error, 100)}${c.reset}`);
            }
            break;
        }
        case "/subtask":
            if (arg) {
                const t = spawnSubtask(arg, state.pool, state.cfg, state.cwd, {
                    onToolStart: (name, a) => console.log(c.gray(`  [${getTask(arg)?.id ?? "sub"}] ${name}`) + c.reset),
                }, (done) => {
                    console.log(`\n${c.green}✓ subtask ${done.id} finished${c.reset} ${c.gray}${truncate(done.result ?? done.error ?? "", 80)}${c.reset}\n`);
                    rl.prompt();
                });
                console.log(c.gray(`spawned ${t.id}: ${truncate(arg, 70)}`) + c.reset);
            }
            else
                console.log(c.red("usage: /subtask <task>") + c.reset);
            break;
        case "/compact":
            await compactSession(state);
            break;
        case "/context": {
            const msgs = state.session.messages;
            const chars = msgs.reduce((n, m) => n + (m.content?.length ?? 0), 0);
            const tokens = Math.ceil(chars / 4);
            const max = 128_000;
            const pct = Math.min(100, Math.round((tokens / max) * 100));
            const filled = Math.round(pct / 5);
            const bar = c.green + "█".repeat(filled) + c.gray + "░".repeat(20 - filled) + c.reset;
            console.log(`\n  context ${bar} ${pct}%  (${tokens} / ${max} tokens, ${msgs.length} msgs)\n`);
            break;
        }
        case "/export": {
            const file = arg || `${state.session.id}.md`;
            const { writeFileSync } = await import("node:fs");
            const md = state.session.messages
                .map((m) => `## ${m.role}\n\n${m.content}\n`)
                .join("\n");
            writeFileSync(file, `# sneezecli session ${state.session.name ?? state.session.id}\n\n${md}`);
            console.log(c.green(`exported to ${file}`) + c.reset);
            break;
        }
        case "/clear-screen":
            console.clear();
            banner(state);
            break;
        case "/exit":
        case "/quit":
            rl.close();
            process.exit(0);
        default:
            console.log(c.red(`unknown command ${cmd}`) + c.reset + c.gray(" — /help for list") + c.reset);
    }
}
async function pickProvider() {
    const provs = visibleProviders();
    const picked = await pick("Provider", provs.map((p) => ({ label: p.name, hint: p.id, value: p.id })));
    return picked;
}
async function pickModel(state) {
    const prov = await pickProvider();
    if (!prov)
        return undefined;
    const models = CATALOG.filter((m) => m.provider === prov);
    if (models.length === 0) {
        console.log(c.red(`no models for ${prov}`) + c.reset);
        return undefined;
    }
    const picked = await pick(`${PROVIDERS[prov]?.name ?? prov} models`, models.map((m) => ({
        label: m.model,
        hint: `${m.rpm ? m.rpm + "rpm" : "∞"}${m.ctx ? ` · ${Math.round(m.ctx / 1000)}k ctx` : ""}${(m.tags ?? []).length ? ` · ${(m.tags ?? []).join(",")}` : ""}`,
        value: m,
    })));
    if (!picked)
        return undefined;
    return {
        provider: picked.provider,
        model: picked.model,
        tier: picked.tier ?? 3,
        rpm: picked.rpm,
    };
}
async function compactSession(state) {
    const msgs = state.session.messages;
    if (msgs.length < 4) {
        console.log(c.gray("nothing to compact") + c.reset);
        return;
    }
    console.log(c.gray("compacting…") + c.reset);
    // summarize everything except the last 2 messages into one user message
    const keep = msgs.slice(-2);
    const summary = msgs
        .slice(0, -2)
        .map((m) => `${m.role}: ${truncate((m.content ?? "").replace(/\s+/g, " "), 150)}`)
        .join("\n");
    state.session.messages = [
        { role: "user", content: `[earlier conversation summary]\n${summary}\n\n[continue from here]` },
        ...keep,
    ];
    saveSession(state.session);
    console.log(c.green(`✓ compacted ${msgs.length} → ${state.session.messages.length} messages`) + c.reset);
}
function printHelp() {
    const rows = [
        ["/help", "this help"],
        ["/new /clear", "fresh session"],
        ["/resume", "pick a saved session"],
        ["/sessions", "list saved sessions"],
        ["/rename <n>", "name current session"],
        ["/delete-session", "remove a saved session"],
        ["/model", "pick primary model (picker)"],
        ["/catalog [prov]", "browse catalog, add model"],
        ["/pool", "show model pool"],
        ["/providers", "list providers"],
        ["/usage", "token/request usage"],
        ["/context", "context window bar"],
        ["/compact", "summarize older messages"],
        ["/subtask <t>", "spawn background subagent"],
        ["/tasks", "list background tasks"],
        ["/cwd <dir>", "change working dir"],
        ["/yolo", "toggle auto-approve"],
        ["/export [f]", "save transcript as markdown"],
        ["/clear-screen", "redraw"],
        ["/exit", "quit"],
    ];
    for (const [cmd, desc] of rows) {
        console.log(`  ${c.cyan}${cmd.padEnd(20)}${c.reset} ${c.gray}${desc}${c.reset}`);
    }
}
async function agentTurn(state, task, rl) {
    const yolo = state.cfg.yolo || process.env.SNEEZE_YOLO_SESSION === "1";
    state.abort = new AbortController();
    let aborted = false;
    state.abort.signal.addEventListener("abort", () => {
        aborted = true;
    });
    // esc key aborts
    const escHandler = {
        onKey: (key) => {
            if (key === "\x1b") {
                aborted = true;
                state.abort?.abort();
            }
        },
    };
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", escHandler.onKey);
    }
    const events = {
        onModel: (p, m) => {
            state.lastModel = `${p}/${m}`;
            process.stdout.write(c.gray(`\n[${p}/${m}]`) + c.reset + "\n");
        },
        onContent: (d) => process.stdout.write(d),
        onToolStart: (name, args) => process.stdout.write(c.cyan(`\n⚡ ${name} `) + c.gray + truncate(JSON.stringify(args), 90) + c.reset + "\n"),
        onToolEnd: (name, result) => {
            const first = result.split("\n")[0];
            process.stdout.write(c.gray(`  ↳ ${truncate(first, 100)}`) + c.reset + "\n");
        },
        confirm: yolo ? undefined : confirmPrompt,
        isAborted: () => aborted,
    };
    try {
        const result = await runAgent(task, state.pool, state.cfg, state.cwd, state.session.messages, events);
        state.session.messages = result.messages;
        saveSession(state.session);
        console.log("\n");
    }
    catch (err) {
        if (err instanceof AgentAborted || aborted) {
            console.log(c.yellow("\n✗ aborted") + c.reset);
        }
        else {
            console.log(c.red(`\n✗ ${err?.message ?? err}`) + c.reset);
        }
        saveSession(state.session);
    }
    finally {
        if (process.stdin.isTTY) {
            process.stdin.removeListener("data", escHandler.onKey);
            process.stdin.setRawMode(false);
        }
        state.abort = null;
    }
}
