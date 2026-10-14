import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore } from "../src/store.js";
import { Orchestrator, type Verifier, type Worker } from "../src/orchestrator.js";
import { recoverInterrupted, selectDispatchable, promoteReady } from "../src/scheduler.js";
import { globsMayOverlap } from "../src/scope.js";
import type { Evidence, Task } from "../src/schemas.js";

const check = { id: "unit", description: "u", command: "npm test", expectExit: 0 };
const mk = (id: string, write: string[], extra: object = {}) => ({
  id, title: id, objective: "o", role: "backend", scope: { write }, requiredChecks: [check], ...extra,
});
const ev = (t: Task, exitCode = 0, n = Math.random()): Evidence => ({
  id: `E-${t.id}-${n}`, taskId: t.id, checkId: "unit", command: "npm test", exitCode,
  startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  outputSha256: "b".repeat(64), outputExcerpt: "", recordedBy: "runner",
});
const ok = (t: Task) => ({
  taskId: t.id, status: "completed" as const, summary: "s", changedFiles: [], testsExecuted: [],
  criteriaSatisfied: [], criteriaUnsatisfied: [], risks: [],
});
const passing: Verifier = async (t) => [ev(t, 0)];

let file: string;
let s: StateStore;
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), "orch-")), "tasks.json"); s = StateStore.open(file); });

describe("scope overlap", () => {
  it("is conservative about prefixes", () => {
    expect(globsMayOverlap("apps/api/**", "apps/api/src/x.ts")).toBe(true);
    expect(globsMayOverlap("apps/web/**", "apps/api/**")).toBe(false);
    expect(globsMayOverlap("**", "apps/api/**")).toBe(true);
  });
});

describe("scheduler", () => {
  it("never dispatches a task whose prerequisites are unresolved", async () => {
    s.addTask(mk("T-a", ["a/**"])); s.addTask(mk("T-b", ["b/**"], { dependsOn: ["T-a"] }));
    const started: string[] = [];
    const worker: Worker = async (t) => { started.push(t.id); return ok(t); };
    const o = new Orchestrator(s, worker, passing, { maxConcurrent: 5 });
    await o.tick();
    expect(started).toEqual(["T-a"]);           // T-b waited, even with spare capacity
    await o.tick();
    expect(started).toEqual(["T-a", "T-b"]);
  });
  it("respects the concurrency cap", () => {
    for (const x of ["a", "b", "c"]) s.addTask(mk(`T-${x}`, [`${x}/**`]));
    promoteReady(s);
    expect(selectDispatchable(s, { maxConcurrent: 2 })).toHaveLength(2);
  });
  it("does not run two tasks with overlapping write scope at once", () => {
    s.addTask(mk("T-a", ["apps/api/**"])); s.addTask(mk("T-b", ["apps/api/src/**"])); s.addTask(mk("T-c", ["apps/web/**"]));
    promoteReady(s);
    const ids = selectDispatchable(s, { maxConcurrent: 5 }).map((t) => t.id);
    expect(ids).toEqual(["T-a", "T-c"]);
  });
  it("runs independent tasks in parallel", async () => {
    s.addTask(mk("T-a", ["a/**"])); s.addTask(mk("T-b", ["b/**"]));
    let live = 0, peak = 0;
    const worker: Worker = async (t) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 20)); live--; return ok(t); };
    const out = await new Orchestrator(s, worker, passing, { maxConcurrent: 2 }).run();
    expect(out.kind).toBe("complete");
    expect(peak).toBe(2);
  });
});

describe("claims are checked, not trusted", () => {
  it("rejects a 'completed' claim when verification fails, retries, then escalates", async () => {
    s.addTask(mk("T-a", ["a/**"], { budget: { maxRetries: 1, maxMinutes: 5 } }));
    let calls = 0;
    const worker: Worker = async (t) => { calls++; return ok(t); };
    const failing: Verifier = async (t) => [ev(t, 1)];
    const out = await new Orchestrator(s, worker, failing).run();
    expect(calls).toBe(2);                       // initial attempt + 1 retry, then stop
    expect(out).toMatchObject({ kind: "stalled", escalated: ["T-a"] });
    expect(s.task("T-a").status).toBe("escalated");
  });
  it("a verifier that returns no evidence cannot produce done", async () => {
    s.addTask(mk("T-a", ["a/**"], { budget: { maxRetries: 0, maxMinutes: 5 } }));
    const out = await new Orchestrator(s, async (t) => ok(t), async () => []).run();
    expect(out.kind).toBe("stalled");
    expect(s.task("T-a").status).toBe("escalated");
  });
  it("a crashing worker is a failed attempt and the loop continues", async () => {
    s.addTask(mk("T-a", ["a/**"])); s.addTask(mk("T-b", ["b/**"]));
    const worker: Worker = async (t) => { if (t.id === "T-a") throw new Error("boom"); return ok(t); };
    const o = new Orchestrator(s, worker, passing);
    const out = await o.run();
    expect(s.task("T-b").status).toBe("done");   // independent work continued
    expect(out).toMatchObject({ kind: "stalled", escalated: ["T-a"] });
  });
  it("a worker answering for the wrong task is rejected", async () => {
    s.addTask(mk("T-a", ["a/**"], { budget: { maxRetries: 0, maxMinutes: 5 } }));
    const worker: Worker = async () => ({ ...ok({ id: "T-zzz" } as Task) });
    await new Orchestrator(s, worker, passing).run();
    expect(s.task("T-a").status).toBe("escalated");
  });
});

describe("failure isolation and loop guards", () => {
  it("keeps dependents of an escalated task from running", async () => {
    s.addTask(mk("T-a", ["a/**"], { budget: { maxRetries: 0, maxMinutes: 5 } }));
    s.addTask(mk("T-b", ["b/**"], { dependsOn: ["T-a"] }));
    const out = await new Orchestrator(s, async (t) => ok(t), async (t) => [ev(t, 1)]).run();
    expect(out).toMatchObject({ kind: "stalled", escalated: ["T-a"], blocked: ["T-b"] });
    expect(s.task("T-b").status).toBe("pending");
  });
  it("stops at the tick cap instead of looping forever", async () => {
    s.addTask(mk("T-a", ["a/**"], { budget: { maxRetries: 1000, maxMinutes: 5 } }));
    const out = await new Orchestrator(s, async (t) => ok(t), async (t) => [ev(t, 1)]).run(5);
    expect(out.kind).toBe("max_ticks");
  });
});

describe("kill and resume", () => {
  it("recovers a task left in_progress by a crash without redoing finished work", async () => {
    s.addTask(mk("T-a", ["a/**"])); s.addTask(mk("T-b", ["b/**"], { dependsOn: ["T-a"] }));
    await new Orchestrator(s, async (t) => ok(t), async (t) => (t.id === "T-a" ? [ev(t, 0)] : [])).tick(); // T-a done
    s.transition("T-b", "ready"); s.transition("T-b", "in_progress");                                     // ...crash mid-T-b
    const reopened = StateStore.open(file);                                                               // new process
    expect(reopened.task("T-a").status).toBe("done");
    expect(recoverInterrupted(reopened)).toEqual(["T-b"]);
    expect(reopened.task("T-b").status).toBe("ready");
    expect(reopened.task("T-b").retries).toBe(1);                                                         // bounded: spends a retry
    const ran: string[] = [];
    const out = await new Orchestrator(reopened, async (t) => { ran.push(t.id); return ok(t); }, passing).run();
    expect(out.kind).toBe("complete");
    expect(ran).toEqual(["T-b"]);                                                                         // T-a not re-run
  });
  it("escalates an interrupted task whose retry budget is already spent", () => {
    s.addTask(mk("T-a", ["a/**"], { budget: { maxRetries: 0, maxMinutes: 5 } }));
    s.transition("T-a", "ready"); s.transition("T-a", "in_progress");
    recoverInterrupted(StateStore.open(file));
    expect(StateStore.open(file).task("T-a").status).toBe("escalated");
  });
});
