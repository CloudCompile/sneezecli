import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
const MAX_OUTPUT = 8_000;
const TIMEOUT_MS = Number(process.env.SNEEZE_VERIFY_TIMEOUT_MS ?? 60_000);
function run(command, args, cwd, signal) {
    const started = Date.now();
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve({ name: command, command: `${command} ${args.join(" ")}`, passed: false, output: "ABORTED", durationMs: 0 });
            return;
        }
        const child = execFile(command, args, { cwd, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT }, (error, stdout, stderr) => {
            const output = `${stdout}${stderr}`.slice(0, MAX_OUTPUT);
            resolve({
                name: command === "git" ? "git diff check" : command,
                command: `${command} ${args.join(" ")}`,
                passed: !error,
                output: output || undefined,
                durationMs: Date.now() - started,
            });
        });
        const abort = () => child.kill("SIGKILL");
        signal?.addEventListener("abort", abort, { once: true });
        child.once("exit", () => signal?.removeEventListener("abort", abort));
    });
}
export async function verifyWorkspace(cwd, signal) {
    const checks = [];
    if (existsSync(`${cwd}/.git`))
        checks.push(await run("git", ["diff", "--check"], cwd, signal));
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(`${cwd}/package.json`, "utf8"));
    }
    catch {
        pkg = undefined;
    }
    const scripts = pkg?.scripts ?? {};
    const script = ["test", "check", "build", "lint"].find((name) => typeof scripts[name] === "string");
    if (script)
        checks.push(await run("npm", ["run", script], cwd, signal));
    return { passed: checks.every((check) => check.passed), checks };
}
