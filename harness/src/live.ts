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

const spec = (file: string, extra = "") => check("tests", `npx vitest run ${file}${extra}`);
const scoped = (src: string) => check("types", `node harness/tools/tsc-scope.mjs ${src}`);
const common = { role: "backend", budget: { maxRetries: 1, maxMinutes: 12 }, requirementIds: ["ADR-002"] };
const READ = ["apps/api/**", "packages/**", "tsconfig.json", "docs/product/**"];
const CATALOG: Record<string, object> = {
  "T-p2-ratelimit": { ...common, title: "Rate limiter module", requirementIds: ["BR-hardening"],
    objective: "Implement apps/api/src/ratelimit.ts exporting createRateLimiter({limit, windowMs, maxKeys?, now?}) returning {check(key), sweep(), size()}, so that every test in apps/api/test/ratelimit.test.ts passes. Read that test file first; it is the spec and you must not edit it. Fixed window per key, deny does not extend the window, retryAfterSec is whole seconds rounded up (min 1), fail closed for new keys when maxKeys live keys are tracked (evict expired keys first). No dependencies.",
    scope: { write: ["apps/api/src/ratelimit.ts"], read: READ }, requiredChecks: [spec("apps/api/test/ratelimit.test.ts"), scoped("apps/api/src/ratelimit.ts")] },
  "T-p2-zoned": { ...common, title: "Time-zone helpers",
    objective: "Implement apps/api/src/zoned.ts exporting zonedTimeToUtc(year, month, day, minuteOfDay, timeZone): Date | undefined and localParts(instant, timeZone): {year, month, day, weekday, minuteOfDay}, so every test in apps/api/test/zoned.test.ts passes. Use only Intl.DateTimeFormat (no dependencies). Nonexistent local times (spring-forward gap) return undefined; ambiguous local times (fall-back) use the first occurrence; an unknown time zone throws. The spec file is the contract: read it first and do not edit it.",
    scope: { write: ["apps/api/src/zoned.ts"], read: READ }, requiredChecks: [spec("apps/api/test/zoned.test.ts"), scoped("apps/api/src/zoned.ts")] },
  "T-p2-catalog": { ...common, title: "SQLite catalog",
    objective: "Implement apps/api/src/sqlite-catalog.ts exporting class SqliteCatalog implementing CatalogPort (see apps/api/src/catalog.ts; the in-memory Catalog there is the behavioural reference) on top of the node:sqlite database from apps/api/src/db.ts and the schema in apps/api/src/migrations.ts. Constructor takes a Db. Every query must filter by tenant_id and use bound parameters (never string-concatenate input into SQL). Make every test in apps/api/test/sqlite-catalog.test.ts pass; read it first and do not edit it. Do not change db.ts, migrations.ts or catalog.ts.",
    scope: { write: ["apps/api/src/sqlite-catalog.ts"], read: READ }, requiredChecks: [spec("apps/api/test/sqlite-catalog.test.ts"), scoped("apps/api/src/sqlite-catalog.ts")] },
  "T-p2-sched": { ...common, title: "SQLite scheduling engine", highRisk: false,
    objective: "Implement apps/api/src/sqlite-scheduling.ts exporting class SqliteScheduling implementing SchedulingSource (apps/api/src/scheduling.ts) on node:sqlite (apps/api/src/db.ts, migrations.ts: read the schema comments). Constructor (db: Db, opts?: {now?: () => Date; horizonDays?: number (default 14); minLeadMinutes?: number (default 60)}). Slots come from availability_rules (local time in the clinic's time_zone; convert with zonedTimeToUtc/localParts from apps/api/src/zoned.ts) in steps of the visit type's duration_min, minus confirmed appointments and time_off that overlap, ordered by start; slot id format `<tenantId>:<providerId>:<yyyymmddThhmm>` in UTC. reserve() must run in inTransaction (db.ts), re-derive the offered slots, throw SlotTakenError if the slot is not offered or the unique index is violated, honour idempotency (same tenant+key+same request returns the existing booking; same key with a different request throws IdempotencyConflictError), and store a request_hash. All queries bound-parameter and tenant-scoped. Make every test in apps/api/test/sqlite-scheduling.test.ts pass; read it first and do not edit it.",
    scope: { write: ["apps/api/src/sqlite-scheduling.ts"], read: READ }, requiredChecks: [spec("apps/api/test/sqlite-scheduling.test.ts"), scoped("apps/api/src/sqlite-scheduling.ts")] },
};
const wanted = (process.argv[4] ?? "T-p2-ratelimit").split(",");
for (const id of wanted) {
  if (!CATALOG[id]) throw new Error(`unknown task ${id}`);
  if (!store.snapshot().tasks[id]) store.addTask({ id, ...CATALOG[id] } as never);
}

const settings = JSON.stringify({ hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `node ${join(repo, "harness/hooks/pretooluse.mjs")}` }] }] } });
const plain = process.env.CLAUDE_PLAIN === "1";   // some environments allow only `claude -p "<prompt>"`; scope and tamper checks still run from git
const inner = claudeCliAgent({ bin, plain, extraArgs: ["--permission-mode", "acceptEdits", "--allowedTools", "Read,Write,Edit,Glob,Grep,Bash(npx vitest:*),Bash(npx tsc:*)", "--settings", settings] });
const agent: AgentRunner = (task, cwd, prompt) => { process.env.HARNESS_TASK_ID = task.id; process.env.HARNESS_STATE = stateFile; return inner(task, cwd, prompt); };
const roleFile = (role: string) => { const p = join(repo, "harness/roles", `${role}.md`); return existsSync(p) ? readFileSync(p, "utf8") : ""; };

const orch = new Orchestrator(store, worktreeWorker({ repo, agent, roleInstructions: (t) => roleFile(t.role), prepare: (t, cwd) => { installWorkerPolicy(repo, cwd, t); } }), makeRunnerVerifier({ repo }), { maxConcurrent: 2 }, undefined, { maxDispatches: 6, maxWallMs: 25 * 60_000 });
const outcome = await orch.run();
const s = store.snapshot();
console.log(JSON.stringify({ outcome, tasks: Object.fromEntries(Object.entries(s.tasks).map(([k, t]) => [k, { status: t.status, attempts: (t as { attempts?: number }).attempts, lastFailure: t.lastFailure?.summary }])) }, null, 2));
