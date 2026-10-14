/**
 * Live driver: runs harness tasks with real Claude workers (the `claude` CLI in headless mode).
 * Usage: node .e2e/live.mjs <repo> <stateFile>   (bundled with esbuild; see package.json "harness:live")
 * Workers run in git worktrees on task branches; the PreToolUse hook blocks restricted actions.
 * Nothing here merges, pushes or deploys.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { StateStore } from "./store.js";
import { Orchestrator } from "./orchestrator.js";
import { worktreeWorker, claudeCliAgent, type AgentRunner } from "./dispatch.js";
import { makeRunnerVerifier } from "./runner.js";
import { installWorkerPolicy } from "./workerpolicy.js";

const repo = resolve(process.argv[2] ?? ".");
const stateFile = resolve(process.argv[3] ?? join(repo, "harness/state/phase2.json"));
const bin = process.env.CLAUDE_BIN ?? "claude";

const store = StateStore.open(stateFile);
const check = (id: string, command: string) => ({ id, description: command, command, expectExit: 0 });

if (!store.snapshot().tasks["T-p2-ratelimit"]) {
  store.addTask({
    id: "T-p2-ratelimit", title: "Rate limiter module", role: "backend", requirementIds: ["BR-hardening"],
    objective: "Implement apps/api/src/ratelimit.ts exporting createRateLimiter({limit, windowMs, maxKeys?, now?}) returning {check(key), sweep(), size()}, so that every test in apps/api/test/ratelimit.test.ts passes. Read that test file first; it is the spec and you must not edit it. Fixed window per key, deny does not extend the window, retryAfterSec is whole seconds rounded up (min 1), fail closed for new keys when maxKeys live keys are tracked (evict expired keys first). No dependencies.",
    scope: { write: ["apps/api/src/ratelimit.ts"], read: ["apps/api/**", "packages/**", "tsconfig.json"] },
    requiredChecks: [check("tests", "npx vitest run apps/api/test/ratelimit.test.ts"), check("types", "npx tsc -p tsconfig.json --noEmit")],
    budget: { maxRetries: 1, maxMinutes: 10 },
  } as never);
}

const settings = JSON.stringify({ hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `node ${join(repo, "harness/hooks/pretooluse.mjs")}` }] }] } });
const plain = process.env.CLAUDE_PLAIN === "1";   // some environments allow only `claude -p "<prompt>"`; scope and tamper checks still run from git
const inner = claudeCliAgent({ bin, plain, extraArgs: ["--permission-mode", "acceptEdits", "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash(npx vitest:*),Bash(npx tsc:*)", "--settings", settings] });
const agent: AgentRunner = (task, cwd, prompt) => { process.env.HARNESS_TASK_ID = task.id; process.env.HARNESS_STATE = stateFile; return inner(task, cwd, prompt); };
const roleFile = (role: string) => { const p = join(repo, "harness/roles", `${role}.md`); return existsSync(p) ? readFileSync(p, "utf8") : ""; };

const orch = new Orchestrator(store, worktreeWorker({ repo, agent, roleInstructions: (t) => roleFile(t.role), prepare: (t, cwd) => { installWorkerPolicy(repo, cwd, t); } }), makeRunnerVerifier({ repo }), { maxConcurrent: 1 }, undefined, { maxDispatches: 6, maxWallMs: 25 * 60_000 });
const outcome = await orch.run();
const s = store.snapshot();
console.log(JSON.stringify({ outcome, tasks: Object.fromEntries(Object.entries(s.tasks).map(([k, t]) => [k, { status: t.status, attempts: (t as { attempts?: number }).attempts, lastFailure: t.lastFailure?.summary }])) }, null, 2));
