import type { StateStore } from "./store.js";
import { HarnessError } from "./store.js";
import { promoteReady, recoverInterrupted, selectDispatchable, type Limits } from "./scheduler.js";
import type { Evidence, Task, WorkerResult } from "./schemas.js";

/** A worker receives its task contract and returns a result. It never touches harness state. */
export type Worker = (task: Task) => Promise<WorkerResult>;
/** Runs the task's required checks and returns runner-authored evidence (real runner arrives in Milestone 5). */
export type Verifier = (task: Task) => Promise<Evidence[]>;

export type RunOutcome =
  | { kind: "complete" }
  | { kind: "stalled"; blocked: string[]; failed: string[]; escalated: string[] }
  | { kind: "max_ticks" };

export class Orchestrator {
  constructor(
    private store: StateStore,
    private worker: Worker,
    private verify: Verifier,
    private limits: Limits = { maxConcurrent: 2 },
  ) {}

  /** One scheduling round. Returns the ids dispatched. */
  async tick(): Promise<string[]> {
    promoteReady(this.store);
    const batch = selectDispatchable(this.store, this.limits);
    for (const t of batch) this.store.transition(t.id, "in_progress");
    await Promise.all(batch.map((t) => this.execute(t)));
    return batch.map((t) => t.id);
  }

  private async execute(t: Task): Promise<void> {
    try {
      const result = await this.worker(t);
      if (result.taskId !== t.id) throw new HarnessError(`worker answered for ${result.taskId}, expected ${t.id}`);
      this.store.submitResult(result);
    } catch (e) {
      // A crashing or malformed worker is a failed attempt, not a stopped harness.
      this.store.submitResult({
        taskId: t.id, status: "failed", summary: `worker error: ${(e as Error).message}`,
        changedFiles: [], testsExecuted: [], criteriaSatisfied: [], criteriaUnsatisfied: [], risks: [],
      });
    }
    if (this.store.task(t.id).status === "needs_review") await this.verifyAndClose(t.id);
    this.requeueIfFailed(t.id);
  }

  private async verifyAndClose(id: string): Promise<void> {
    const task = this.store.task(id);
    for (const ev of await this.verify(task)) this.store.recordEvidence(ev);
    try { this.store.markDone(id); }
    catch { this.store.transition(id, "failed"); } // missing or failing evidence: the claim is rejected
  }

  private requeueIfFailed(id: string): void {
    const t = this.store.task(id);
    if (t.status !== "failed") return;
    this.store.transition(id, t.retries >= t.budget.maxRetries ? "escalated" : "ready");
  }

  /** Run until everything is done, nothing can progress, or the tick cap is hit (guards against infinite loops). */
  async run(maxTicks = 100): Promise<RunOutcome> {
    recoverInterrupted(this.store);
    for (let i = 0; i < maxTicks; i++) {
      const tasks = Object.values(this.store.snapshot().tasks);
      if (tasks.length > 0 && tasks.every((t) => t.status === "done")) return { kind: "complete" };
      const dispatched = await this.tick();
      if (dispatched.length === 0) {
        const after = Object.values(this.store.snapshot().tasks);
        if (after.every((t) => t.status === "done")) return { kind: "complete" };
        const ids = (s: string) => after.filter((t) => t.status === s).map((t) => t.id);
        return { kind: "stalled", blocked: ids("blocked").concat(ids("pending")), failed: ids("failed"), escalated: ids("escalated") };
      }
    }
    return { kind: "max_ticks" };
  }
}
