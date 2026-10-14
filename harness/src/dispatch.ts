import { spawn } from "node:child_process";
import type { Task, WorkerResult } from "./schemas.js";
import { WorkerResult as WorkerResultSchema } from "./schemas.js";
import type { Worker } from "./orchestrator.js";
import { changedPaths, checkScope, commitAll, createWorktree } from "./worktree.js";

/** The agent does the work inside `cwd` and returns its (untrusted) result. */
export type AgentRunner = (task: Task, cwd: string, prompt: string) => Promise<unknown>;

/** The strict worker contract from the master directive, rendered as a prompt. */
export function buildWorkerPrompt(task: Task, roleInstructions = ""): string {
  return [
    `You are the ${task.role} specialist. Task ${task.id}: ${task.title}`,
    `Objective: ${task.objective}`,
    roleInstructions && `Role guidance:\n${roleInstructions}`,
    `Requirements: ${task.requirementIds.join(", ") || "(none listed)"}`,
    `You may write ONLY files matching: ${task.scope.write.join(", ") || "(nothing)"}`,
    `You may read: ${task.scope.read.join(", ") || "anything in the repository"}`,
    `Never touch harness/state, docs/prd, .env files, CI workflows, or .git. Never push, merge, deploy, or read credentials.`,
    task.lastFailure && `PREVIOUS ATTEMPT FAILED VERIFICATION (${task.lastFailure.category}).\n${task.lastFailure.summary}\nReproduce with: ${task.lastFailure.reproduce}\nOutput (tail):\n${task.lastFailure.excerpt}\nMake the smallest fix. Do not weaken, skip or delete tests, and do not change acceptance criteria.`,
    `Required checks (run by the harness, not by you):\n${task.requiredChecks.map((c) => `- ${c.id}: ${c.command}`).join("\n")}`,
    `Budget: ${task.budget.maxMinutes} minutes. Do not delegate to other agents.`,
    `Do not edit or delete tests to make them pass. If blocked, say so.`,
    `Finish by printing ONLY a JSON object: {"taskId","status":"completed|blocked|failed|needs_review","summary","changedFiles","testsExecuted":[{"command","result"}],"criteriaSatisfied","criteriaUnsatisfied","risks","nextTask"?}. Claims of success are verified independently.`,
  ].filter(Boolean).join("\n\n");
}

const failed = (taskId: string, summary: string, risks: string[] = []): WorkerResult => ({
  taskId, status: "failed", summary, changedFiles: [], testsExecuted: [],
  criteriaSatisfied: [], criteriaUnsatisfied: [], risks,
});

/**
 * Worker that runs an agent in an isolated git worktree, then judges the outcome from git, not from the agent:
 * - changed files come from `git status`, not the agent's report
 * - any change outside the task's write scope, or to a protected path, fails the task
 * - in-scope work is committed to the task branch (never merged here: merging needs approval)
 */
export function worktreeWorker(opts: { repo: string; baseRef?: string; agent: AgentRunner; roleInstructions?: (t: Task) => string }): Worker {
  return async (task) => {
    const cwd = createWorktree(opts.repo, task.id, opts.baseRef ?? "HEAD");
    const raw = await opts.agent(task, cwd, buildWorkerPrompt(task, opts.roleInstructions?.(task)));
    const parsed = WorkerResultSchema.safeParse(raw);
    if (!parsed.success) return failed(task.id, `agent returned an invalid result: ${parsed.error.issues[0]?.message ?? "unknown"}`);

    const actual = changedPaths(cwd);
    const scope = checkScope(actual, task.scope.write);
    if (!scope.ok) {
      return failed(task.id, "scope violation; changes rejected", [
        ...scope.protectedHits.map((p) => `touched protected path: ${p}`),
        ...scope.outOfScope.map((p) => `outside write scope: ${p}`),
      ]);
    }
    const risks = [...parsed.data.risks];
    const claimed = [...parsed.data.changedFiles].sort().join("|");
    if (claimed !== actual.join("|")) risks.push("agent's reported changedFiles differ from git; git's list was used");
    const sha = commitAll(cwd, `${task.id}: ${task.title}`);
    return { ...parsed.data, taskId: task.id, changedFiles: actual, risks: sha ? [...risks, `committed ${sha.slice(0, 10)} on task branch`] : risks };
  };
}

/**
 * Adapter for the Claude Code CLI in headless mode. NOT yet exercised against the real CLI
 * (needs an authenticated install and spends usage); the tests use fake agents.
 * Workers cannot spawn workers: the Agent tool is disallowed.
 */
export function claudeCliAgent(opts: { bin?: string; extraArgs?: string[] } = {}): AgentRunner {
  return (task, cwd, prompt) =>
    new Promise((resolve, reject) => {
      const child = spawn(opts.bin ?? "claude", ["-p", prompt, "--output-format", "text", "--disallowedTools", "Agent", ...(opts.extraArgs ?? [])], { cwd });
      let out = "", err = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`timed out after ${task.budget.maxMinutes} minutes`)); }, task.budget.maxMinutes * 60_000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
        const start = out.indexOf("{"), end = out.lastIndexOf("}");
        try { resolve(JSON.parse(out.slice(start, end + 1))); } catch { reject(new Error("no JSON result in agent output")); }
      });
    });
}
