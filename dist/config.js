import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
const CONFIG_DIR = `${homedir()}/.config/sneezecli`;
const SESSIONS_DIR = `${CONFIG_DIR}/sessions`;
const CONFIG_PATH = `${CONFIG_DIR}/config.json`;
export function configPath() {
    return process.env.SNEEZE_CONFIG ?? CONFIG_PATH;
}
export function sessionsDir() {
    return SESSIONS_DIR;
}
export function loadConfig() {
    const p = configPath();
    if (!existsSync(p))
        return { models: [] };
    return JSON.parse(readFileSync(p, "utf8"));
}
export function saveConfig(cfg) {
    const p = configPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}
export function defaultConfig() {
    return {
        models: [],
        maxTokens: 4096,
        maxContextMessages: 40,
        yolo: false,
        systemPrompt: "You are sneezecli, a capable coding agent working in the user's repository. " +
            "Use the provided tools to read, explore, edit, and run code. " +
            "Prefer precise edit_file operations over rewriting whole files. " +
            "When done, summarize what you changed.",
    };
}
export function saveSession(s) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    writeFileSync(`${SESSIONS_DIR}/${s.id}.json`, JSON.stringify(s, null, 2) + "\n");
}
export function loadSession(id) {
    const p = `${SESSIONS_DIR}/${id}.json`;
    if (!existsSync(p))
        return undefined;
    return JSON.parse(readFileSync(p, "utf8"));
}
export function listSessions() {
    if (!existsSync(SESSIONS_DIR))
        return [];
    return readdirSorted(SESSIONS_DIR)
        .map((f) => JSON.parse(readFileSync(`${SESSIONS_DIR}/${f}`, "utf8")))
        .sort((a, b) => b.created.localeCompare(a.created));
}
function readdirSorted(dir) {
    const { readdirSync } = require("node:fs");
    return readdirSync(dir).filter((f) => f.endsWith(".json"));
}
export function newSessionId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return (`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
        `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`);
}
