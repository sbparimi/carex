import type { StateStore } from "./store.js";
import { HarnessError } from "./store.js";
import { promoteReady, recoverInterrupted, selectDispatchable, type Limits } from "./scheduler.js";
import type { Evidence, Task, Verdict, WorkerResult } from "./schemas.js";
import { RETRYABLE, diagnose } from "./classify.js";

/** A worker receives its task contract and returns a result. It never touches harness state. */
export type Worker = (task: Task) => Promise<WorkerResult>;
/** Runs the task's required checks and returns runner-authored evidence (real runner arrives in Milestone 5). */
export type Verifier = (task: Task) => Promise<Evidence[]>;

/** Independent reviewer for high-risk tasks. Returns a verdict from a role other than the author's. */
export type Reviewer = (task: Task) => Promise<Verdict>;

export interface Budget {
  /** Hard cap on worker dispatches across the whole run. */
  maxDispatches?: number;
  /** Wall-clock deadline for the whole run, in ms. */
  maxWallMs?: number;
}

export type RunOutcome =
  | { kind: "complete" }
  | { kind: "stalled"; blocked: string[]; failed: string[]; escalated: string[] }
  | { kind: "max_ticks" }
  | { kind: "budget_exhausted"; reason: "dispatches" | "wall_clock" };

export class Orchestrator {
  constructor(
    private store: StateStore,
    private worker: Worker,
    private verify: Verifier,
    private limits: Limits = { maxConcurrent: 2 },
    private reviewer?: Reviewer,
    private budget: Budget = {},
  ) {}

  private dispatches = 0;
  get dispatchCount() { return this.dispatches; }

  /** One scheduling round. Returns the ids dispatched. */
  async tick(): Promise<string[]> {
    promoteReady(this.store);
    let batch = selectDispatchable(this.store, this.limits);
    if (this.budget.maxDispatches !== undefined) batch = batch.slice(0, Math.max(0, this.budget.maxDispatches - this.dispatches));
    this.dispatches += batch.length;
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
    const evidence = await this.verify(task);
    for (const ev of evidence) this.store.recordEvidence(ev);
    const failing = evidence.find((e) => {
      const c = task.requiredChecks.find((x) => x.id === e.checkId);
      return c && e.exitCode !== c.expectExit;
    });
    if (!failing && task.highRisk && this.reviewer) {
      try { this.store.submitVerdict(await this.reviewer(task)); }
      catch { /* an invalid or non-independent verdict simply leaves the task unreviewed */ }
    }
    try { this.store.markDone(id); }
    catch {
      // Missing or failing evidence, or no passing review: the completion claim is rejected.
      const ev = failing ?? evidence.at(-1);
      if (ev) this.store.recordFailure(id, diagnose(ev));
      else this.store.recordFailure(id, { category: "unknown", summary: "No evidence or review was produced for this task.", evidenceId: "none", reproduce: task.requiredChecks[0]!.command, excerpt: "" });
      this.store.transition(id, "failed");
    }
  }

  private requeueIfFailed(id: string): void {
    const t = this.store.task(id);
    if (t.status !== "failed") return;
    const retryable = !t.lastFailure || RETRYABLE.has(t.lastFailure.category);
    this.store.transition(id, retryable && t.retries < t.budget.maxRetries ? "ready" : "escalated");
  }

  /**
   * A crash can strand tasks between steps: result saved but verification unfinished (needs_review),
   * or failed but not yet re-queued. The worker's result is already durable, so re-verify instead of redoing the work.
   */
  private async recoverStranded(): Promise<void> {
    for (const t of Object.values(this.store.snapshot().tasks)) {
      if (t.status === "needs_review") { await this.verifyAndClose(t.id); this.requeueIfFailed(t.id); }
      else if (t.status === "failed") this.requeueIfFailed(t.id);
    }
  }

  /** Run until everything is done, nothing can progress, or the tick cap is hit (guards against infinite loops). */
  async run(maxTicks = 100): Promise<RunOutcome> {
    recoverInterrupted(this.store);
    await this.recoverStranded();
    const started = Date.now();
    for (let i = 0; i < maxTicks; i++) {
      if (this.budget.maxWallMs !== undefined && Date.now() - started > this.budget.maxWallMs) return { kind: "budget_exhausted", reason: "wall_clock" };
      const tasks = Object.values(this.store.snapshot().tasks);
      if (tasks.length > 0 && tasks.every((t) => t.status === "done")) return { kind: "complete" };
      const dispatched = await this.tick();
      if (dispatched.length === 0) {
        if (this.budget.maxDispatches !== undefined && this.dispatches >= this.budget.maxDispatches
            && Object.values(this.store.snapshot().tasks).some((t) => t.status === "ready")) return { kind: "budget_exhausted", reason: "dispatches" };
        const after = Object.values(this.store.snapshot().tasks);
        if (after.every((t) => t.status === "done")) return { kind: "complete" };
        const ids = (s: string) => after.filter((t) => t.status === s).map((t) => t.id);
        return { kind: "stalled", blocked: ids("blocked").concat(ids("pending")), failed: ids("failed"), escalated: ids("escalated") };
      }
    }
    return { kind: "max_ticks" };
  }
}
