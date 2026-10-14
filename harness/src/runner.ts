import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { Evidence, Task } from "./schemas.js";
import type { Verifier } from "./orchestrator.js";
import { checkCommand } from "./policy.mjs";
import { detectTampering } from "./tamper.js";
import { worktreePath } from "./worktree.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const MAX_CAPTURE = 200_000;

/** Execute one required check in `cwd` and return runner-authored evidence of what actually happened. */
export function runCheck(task: Task, check: Task["requiredChecks"][number], cwd: string, timeoutMs: number): Promise<Evidence> {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const finish = (exitCode: number, out: string) =>
      resolve({
        id: `E-${randomUUID()}`, taskId: task.id, checkId: check.id, command: check.command, exitCode,
        startedAt, finishedAt: new Date().toISOString(), outputSha256: sha(out),
        outputExcerpt: out.length > 4000 ? out.slice(-4000) : out, recordedBy: "runner",
      });
    const verdict = checkCommand(check.command);
    if (verdict.restricted) return finish(126, `refused to run restricted command (${verdict.restricted}): ${check.command}`);
    const child = spawn("bash", ["-c", check.command], { cwd, env: { ...process.env, CI: "1" } });
    let out = "";
    const add = (d: Buffer) => { if (out.length < MAX_CAPTURE) out += d.toString(); };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(124, out + `\n[harness] timed out after ${timeoutMs}ms`); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); finish(127, `${out}\n[harness] spawn error: ${e.message}`); });
    child.on("close", (code) => { clearTimeout(timer); finish(code ?? 1, out); });
  });
}

/**
 * Verifier backed by real execution. Tampering is checked first; if found, every check gets
 * failing evidence so the task cannot reach done.
 */
export function makeRunnerVerifier(opts: { repo: string; baseRef?: string; timeoutMs?: number }): Verifier {
  return async (task) => {
    // Base = the main checkout's HEAD (the commit every task worktree branched from), resolved per call.
    const baseRef = opts.baseRef ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: opts.repo, encoding: "utf8" }).trim();
    const cwd = worktreePath(opts.repo, task.id);
    const tamper = detectTampering(cwd, baseRef);
    if (tamper.length) {
      const msg = tamper.map((t) => `${t.file}: ${t.reason}`).join("\n");
      return task.requiredChecks.map((c) => ({
        id: `E-${randomUUID()}`, taskId: task.id, checkId: c.id, command: "harness tamper-check", exitCode: 1,
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        outputSha256: sha(msg), outputExcerpt: `test tampering detected:\n${msg}`, recordedBy: "runner" as const,
      }));
    }
    const evidence: Evidence[] = [];
    for (const c of task.requiredChecks) evidence.push(await runCheck(task, c, cwd, opts.timeoutMs ?? task.budget.maxMinutes * 60_000));
    return evidence;
  };
}
