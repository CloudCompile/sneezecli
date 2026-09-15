import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { dirname, join, resolve, basename, extname } from "node:path";
import { execSync, spawn, exec } from "node:child_process";
const MAX_OUTPUT = 20_000;
function truncate(s) {
    if (s.length <= MAX_OUTPUT)
        return s;
    return s.slice(0, MAX_OUTPUT) + `\n... (truncated, ${s.length - MAX_OUTPUT} more chars)`;
}
function abs(ctx, p) {
    return resolve(ctx.cwd, p);
}
export const TOOLS = [
    {
        def: {
            type: "function",
            function: {
                name: "read_file",
                description: "Read a text file. Optionally read a line range. Returns contents with line numbers.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "File path (relative to cwd or absolute)" },
                        offset: { type: "number", description: "1-based start line" },
                        limit: { type: "number", description: "Number of lines to read" },
                    },
                    required: ["path"],
                },
            },
        },
        run: async (args, ctx) => {
            const p = abs(ctx, args.path);
            if (!existsSync(p))
                return `ERROR: ${p} does not exist`;
            const text = readFileSync(p, "utf8");
            // Treat CRLF as one newline and do not expose the synthetic empty line
            // produced by a trailing newline. This keeps displayed line numbers
            // consistent with `wc -l` and benchmark fixtures.
            const lines = text.replace(/\r\n/g, "\n").split("\n");
            if (lines.length > 1 && lines.at(-1) === "")
                lines.pop();
            const start = Math.max(1, args.offset ?? 1);
            const end = Math.min(lines.length, start + (args.limit ?? 2000) - 1);
            const out = lines
                .slice(start - 1, end)
                .map((l, i) => `${String(start + i).padStart(5)}| ${l}`)
                .join("\n");
            return truncate(out + (end < lines.length ? `\n... (${lines.length - end} more lines)` : ""));
        },
    },
    {
        def: {
            type: "function",
            function: {
                name: "write_file",
                description: "Write text to a file, creating directories as needed. Overwrites entirely.",
                parameters: {
                    type: "object",
                    properties: { path: { type: "string" }, content: { type: "string" } },
                    required: ["path", "content"],
                },
            },
        },
        dangerous: true,
        run: async (args, ctx) => {
            const p = abs(ctx, args.path);
            mkdirSync(dirname(p), { recursive: true });
            writeFileSync(p, args.content);
            return `wrote ${p} (${args.content.length} bytes)`;
        },
    },
    {
        def: {
            type: "function",
            function: {
                name: "edit_file",
                description: "Replace an exact substring in a file. old_string must match exactly and appear exactly once.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        old_string: { type: "string" },
                        new_string: { type: "string" },
                    },
                    required: ["path", "old_string", "new_string"],
                },
            },
        },
        dangerous: true,
        run: async (args, ctx) => {
            const p = abs(ctx, args.path);
            if (!existsSync(p))
                return `ERROR: ${p} does not exist`;
            const src = readFileSync(p, "utf8");
            const count = src.split(args.old_string).length - 1;
            if (count === 0)
                return `ERROR: old_string not found in ${basename(p)}`;
            if (count > 1)
                return `ERROR: old_string appears ${count} times, must be unique`;
            writeFileSync(p, src.replace(args.old_string, args.new_string));
            return `edited ${basename(p)}`;
        },
    },
    {
        def: {
            type: "function",
            function: {
                name: "list_dir",
                description: "List directory contents (non-recursive).",
                parameters: {
                    type: "object",
                    properties: { path: { type: "string", description: "Directory path, default '.'" } },
                },
            },
        },
        run: async (args, ctx) => {
            const p = abs(ctx, args.path ?? ".");
            if (!existsSync(p))
                return `ERROR: ${p} does not exist`;
            const items = readdirSync(p);
            return (items
                .map((i) => {
                try {
                    const s = statSync(join(p, i));
                    return s.isDirectory() ? `${i}/` : i;
                }
                catch {
                    return i;
                }
            })
                .join("\n") || "(empty)");
        },
    },
    {
        def: {
            type: "function",
            function: {
                name: "glob",
                description: "Find files matching a glob pattern under cwd (e.g. 'src/**/*.ts').",
                parameters: {
                    type: "object",
                    properties: { pattern: { type: "string" } },
                    required: ["pattern"],
                },
            },
        },
        run: async (args, ctx) => {
            const out = execSync(`find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*'`, { cwd: ctx.cwd, encoding: "utf8", timeout: 10_000 });
            const files = out.split("\n").filter(Boolean);
            const re = new RegExp("^" +
                args.pattern
                    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                    .replace(/\*\*/g, "___GLOBSTAR___")
                    .replace(/\*/g, "[^/]*")
                    .replace(/___GLOBSTAR___/g, ".*") +
                "$");
            const matches = files.filter((f) => re.test(f.slice(2)));
            return truncate(matches.join("\n") || "no matches");
        },
    },
    {
        def: {
            type: "function",
            function: {
                name: "grep",
                description: "Search file contents with a regex. Returns matching lines with file:line.",
                parameters: {
                    type: "object",
                    properties: {
                        pattern: { type: "string", description: "Regex (POSIX extended)" },
                        path: { type: "string", description: "File or directory, default '.'" },
                        include: { type: "string", description: "Filename glob filter, e.g. '*.ts'" },
                    },
                    required: ["pattern"],
                },
            },
        },
        run: async (args, ctx) => {
            const p = abs(ctx, args.path ?? ".");
            const inc = args.include ? `--include='${args.include}'` : "";
            try {
                const out = execSync(`grep -rnE ${inc} '${args.pattern.replace(/'/g, "'\\''")}' ${JSON.stringify(p)} ` +
                    `--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist`, { cwd: ctx.cwd, encoding: "utf8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
                return truncate(out || "no matches");
            }
            catch (err) {
                if (err.status === 1)
                    return "no matches";
                return `ERROR: ${err.stderr ?? err.message}`;
            }
        },
    },
    {
        def: {
            type: "function",
            function: {
                name: "bash",
                description: "Run a shell command in cwd and return combined output. 60s timeout. Use for builds, tests, git.",
                parameters: {
                    type: "object",
                    properties: { command: { type: "string" } },
                    required: ["command"],
                },
            },
        },
        dangerous: true,
        run: async (args, ctx) => {
            return await new Promise((resolve) => {
                const child = exec(args.command, { cwd: ctx.cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 60_000, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
                    if (err && err.killed)
                        return resolve("ABORTED");
                    if (err) {
                        return resolve(truncate(`EXIT ${err.code ?? "?"}\n${stdout}${stderr}`));
                    }
                    resolve(truncate(stdout + stderr || "(no output)"));
                });
                if (ctx.signal) {
                    const onAbort = () => child.kill("SIGKILL");
                    ctx.signal.addEventListener("abort", onAbort, { once: true });
                    child.once("exit", () => ctx.signal?.removeEventListener("abort", onAbort));
                }
            });
        },
    },
    {
        def: {
            type: "function",
            function: {
                name: "bash_bg",
                description: "Start a long-running command (dev server, watcher) in the background.",
                parameters: {
                    type: "object",
                    properties: { command: { type: "string" } },
                    required: ["command"],
                },
            },
        },
        dangerous: true,
        run: async (args, ctx) => {
            const child = spawn(args.command, { cwd: ctx.cwd, shell: true, detached: true, stdio: "ignore" });
            child.unref();
            return `started bg pid ${child.pid}`;
        },
    },
    {
        def: {
            type: "function",
            function: {
                name: "delete_file",
                description: "Delete a file.",
                parameters: {
                    type: "object",
                    properties: { path: { type: "string" } },
                    required: ["path"],
                },
            },
        },
        dangerous: true,
        run: async (args, ctx) => {
            const p = abs(ctx, args.path);
            if (!existsSync(p))
                return `ERROR: ${p} does not exist`;
            rmSync(p);
            return `deleted ${p}`;
        },
    },
    {
        def: {
            type: "function",
            function: {
                name: "patch_file",
                description: "Apply multiple search/replace edits to a file in one call. Each edit: {old_string, new_string}.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        edits: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    old_string: { type: "string" },
                                    new_string: { type: "string" },
                                },
                                required: ["old_string", "new_string"],
                            },
                        },
                    },
                    required: ["path", "edits"],
                },
            },
        },
        dangerous: true,
        run: async (args, ctx) => {
            const p = abs(ctx, args.path);
            if (!existsSync(p))
                return `ERROR: ${p} does not exist`;
            let src = readFileSync(p, "utf8");
            for (const e of args.edits) {
                const count = src.split(e.old_string).length - 1;
                if (count === 0)
                    return `ERROR: not found: ${e.old_string.slice(0, 60)}...`;
                if (count > 1)
                    return `ERROR: ambiguous (${count}x): ${e.old_string.slice(0, 60)}...`;
                src = src.replace(e.old_string, e.new_string);
            }
            writeFileSync(p, src);
            return `applied ${args.edits.length} edits to ${basename(p)}`;
        },
    },
    {
        def: {
            type: "function",
            function: {
                name: "file_info",
                description: "Get file metadata: size, extension, line count.",
                parameters: {
                    type: "object",
                    properties: { path: { type: "string" } },
                    required: ["path"],
                },
            },
        },
        run: async (args, ctx) => {
            const p = abs(ctx, args.path);
            if (!existsSync(p))
                return `ERROR: ${p} does not exist`;
            const s = statSync(p);
            const lines = readFileSync(p, "utf8").split("\n").length;
            return `${p}\n  size: ${s.size} bytes\n  lines: ${lines}\n  ext: ${extname(p) || "(none)"}`;
        },
    },
];
export function toolDefs() {
    return TOOLS.map((t) => t.def);
}
export function isDangerous(name) {
    return TOOLS.find((t) => t.def.function.name === name)?.dangerous ?? false;
}
export async function runTool(name, args, ctx) {
    const tool = TOOLS.find((t) => t.def.function.name === name);
    if (!tool)
        return `ERROR: unknown tool ${name}`;
    try {
        return await tool.run(args, ctx);
    }
    catch (err) {
        return `ERROR: ${err?.message ?? String(err)}`;
    }
}
