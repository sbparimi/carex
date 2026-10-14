import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore } from "../src/store.js";
import { Orchestrator, type Verifier, type Worker } from "../src/orchestrator.js";
import { renderReport } from "../src/report.js";
import type { Task } from "../src/schemas.js";

const check = { id: "unit", description: "u", command: "npm test", expectExit: 0 };
const mk = (id: string, write: string[], extra: object = {}) => ({
  id, title: id, objective: "o", role: "backend", scope: { write }, requiredChecks: [check],
  budget: { maxRetries: 4, maxMinutes: 5 }, ...extra,
});
const ok = (t: Task) => ({ taskId: t.id, status: "completed" as const, summary: "s", changedFiles: [], testsExecuted: [], criteriaSatisfied: [], criteriaUnsatisfied: [], risks: [] });
const evid = (t: Task, exitCode: number) => ({
  id: `E-${t.id}-${Math.random()}`, taskId: t.id, checkId: "unit", command: "npm test", exitCode,
  startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), outputSha256: "d".repeat(64), outputExcerpt: exitCode ? "AssertionError: expected 1 to be 2" : "ok", recordedBy: "runner" as const,
});

/** Scenario: a -> b, independent c; c fails verification once, so retries and diagnosis are exercised too. */
function scenario(calls: Record<string, number>) {
  const worker: Worker = async (t) => { calls[t.id] = (calls[t.id] ?? 0) + 1; return ok(t); };
  const verify: Verifier = async (t) => [evid(t, t.id === "T-c" && (calls["T-c"] ?? 0) === 1 ? 1 : 0)];
  const seed = (s: StateStore) => {
    s.addTask(mk("T-a", ["a/**"])); s.addTask(mk("T-b", ["b/**"], { dependsOn: ["T-a"] })); s.addTask(mk("T-c", ["c/**"]));
  };
  return { worker, verify, seed };
}
const fresh = () => join(mkdtempSync(join(tmpdir(), "res-")), "tasks.json");

describe("fault injection: crash at every checkpoint, then resume", () => {
  it("completes from a crash at every checkpoint, before or after it is written, without redoing finished work", async () => {
    const f0 = fresh(); const c0: Record<string, number> = {}; let n = 0;
    const s0 = StateStore.open(f0, { afterSave: (k) => { n = k; } }); const sc0 = scenario(c0); sc0.seed(s0);
    expect((await new Orchestrator(s0, sc0.worker, sc0.verify).run()).kind).toBe("complete");
    expect(n).toBeGreaterThan(15);

    for (const when of ["beforeSave", "afterSave"] as const) {
      for (let k = 1; k <= n; k++) {
        const f = fresh(); const calls: Record<string, number> = {};
        const crash = { [when]: (i: number) => { if (i === k) throw new Error("simulated crash"); } };
        let crashed = false;
        try {
          const s = StateStore.open(f, crash); const sc = scenario(calls); sc.seed(s);
          await new Orchestrator(s, sc.worker, sc.verify).run();
        } catch { crashed = true; }
        if (!crashed) continue;                                          // k beyond this run's checkpoints
        if (existsSync(f)) writeFileSync(`${f}.tmp`, "{ torn write");     // leftover from the dead process
        const reopened = existsSync(f) ? StateStore.open(f) : undefined;
        const doneBefore = reopened ? Object.values(reopened.snapshot().tasks).filter((t) => t.status === "done").map((t) => t.id) : [];
        const resumed = reopened ?? StateStore.open(f);
        const sc = scenario(calls); if (!reopened) sc.seed(resumed);
        const callsAtCrash = { ...calls };
        const out = await new Orchestrator(resumed, sc.worker, sc.verify).run();
        expect(out.kind, `${when} @${k}`).toBe("complete");
        for (const id of doneBefore) expect(calls[id], `${id} redone after ${when} @${k}`).toBe(callsAtCrash[id]);
        for (const [id, c] of Object.entries(calls)) expect(c, `${id} ran too often after ${when} @${k}`).toBeLessThanOrEqual(4);
        expect(Object.values(resumed.snapshot().tasks).every((t) => t.status === "done")).toBe(true);
      }
    }
  });
});

describe("report", () => {
  it("is generated from recorded state and quotes real failure output", async () => {
    const f = fresh(); const calls: Record<string, number> = {};
    const s = StateStore.open(f); const sc = scenario(calls); sc.seed(s);
    await new Orchestrator(s, sc.worker, sc.verify).run();
    const md = renderReport(s.snapshot());
    expect(md).toMatch(/3 total, 3 done/);
    expect(md).toContain("AssertionError: expected 1 to be 2");   // the real failed output, from the c retry
    expect(md).toMatch(/\| T-c \| backend \| done \| 1\/4 \|/);
  });
});
