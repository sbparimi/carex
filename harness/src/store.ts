import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  Evidence, State, Task, TaskStatus, WorkerResult, Approval, RestrictedAction,
} from "./schemas.js";
import { findGraphProblem } from "./dag.js";

/** Legal status transitions. `done` is intentionally NOT reachable via transition(); see markDone(). */
const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  pending: ["ready", "blocked"],
  ready: ["in_progress", "blocked"],
  in_progress: ["needs_review", "failed", "blocked"],
  needs_review: ["in_progress", "failed", "blocked"],
  failed: ["ready", "escalated"],
  blocked: ["ready", "escalated"],
  escalated: ["ready"],
  done: [],
};

export class HarnessError extends Error {}

const now = () => new Date().toISOString();

export class StateStore {
  private constructor(private path: string, private state: State) {}

  static open(path: string): StateStore {
    if (!existsSync(path)) {
      const empty: State = { version: 1, tasks: {}, evidence: {}, results: {}, approvals: {}, log: [] };
      const s = new StateStore(path, empty);
      s.save();
      return s;
    }
    const parsed = State.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) throw new HarnessError(`corrupt state file: ${parsed.error.message}`);
    const problem = findGraphProblem(parsed.data.tasks);
    if (problem) throw new HarnessError(`corrupt state file: ${problem}`);
    return new StateStore(path, parsed.data);
  }

  snapshot(): State { return structuredClone(this.state); }
  task(id: string): Task {
    const t = this.state.tasks[id];
    if (!t) throw new HarnessError(`unknown task ${id}`);
    return t;
  }

  /** Atomic checkpoint: validate, write temp file, rename. A crash never leaves a half-written file. */
  private save(): void {
    State.parse(this.state);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.path);
  }

  private log(event: string, taskId?: string, detail?: string) {
    this.state.log.push({ at: now(), event, ...(taskId ? { taskId } : {}), ...(detail ? { detail } : {}) });
  }

  addTask(input: unknown): Task {
    const task = Task.parse({ ...(input as object), status: "pending", retries: 0, evidenceIds: [], updatedAt: now() });
    if (this.state.tasks[task.id]) throw new HarnessError(`task ${task.id} already exists`);
    const next = { ...this.state.tasks, [task.id]: task };
    const problem = findGraphProblem(next);
    if (problem) throw new HarnessError(problem);
    this.state.tasks = next;
    this.log("task_added", task.id);
    this.save();
    return task;
  }

  transition(taskId: string, to: TaskStatus): void {
    const t = this.task(taskId);
    if (to === "done") throw new HarnessError("done can only be set through markDone(), which checks evidence");
    if (!ALLOWED[t.status].includes(to)) throw new HarnessError(`illegal transition ${t.status} -> ${to} for ${taskId}`);
    if (to === "ready") {
      const open = t.dependsOn.filter((d) => this.state.tasks[d]!.status !== "done");
      if (open.length) throw new HarnessError(`${taskId} cannot be ready; unfinished dependencies: ${open.join(", ")}`);
    }
    if (t.status === "failed" && to === "ready") {
      if (t.retries >= t.budget.maxRetries) throw new HarnessError(`${taskId} exhausted its retry budget (${t.budget.maxRetries}); escalate instead`);
      t.retries += 1;
    }
    t.status = to;
    t.updatedAt = now();
    this.log("transition", taskId, to);
    this.save();
  }

  /** Worker output is advisory. It can move a task to review or failed, never to done. */
  submitResult(raw: unknown): void {
    const result = WorkerResult.parse(raw);
    const t = this.task(result.taskId);
    if (t.status !== "in_progress") throw new HarnessError(`${t.id} is ${t.status}; results are only accepted while in_progress`);
    this.state.results[t.id] = result;
    const to: TaskStatus = result.status === "completed" || result.status === "needs_review" ? "needs_review"
      : result.status === "blocked" ? "blocked" : "failed";
    t.status = to;
    t.updatedAt = now();
    this.log("result_submitted", t.id, `${result.status} -> ${to}`);
    this.save();
  }

  /** Only the runner may call this. Evidence from any other source is rejected. */
  recordEvidence(raw: unknown): Evidence {
    const ev = Evidence.parse(raw);
    const t = this.task(ev.taskId);
    if (!t.requiredChecks.some((c) => c.id === ev.checkId)) throw new HarnessError(`${ev.checkId} is not a required check of ${t.id}`);
    this.state.evidence[ev.id] = ev;
    t.evidenceIds.push(ev.id);
    this.log("evidence_recorded", t.id, `${ev.checkId} exit=${ev.exitCode}`);
    this.save();
    return ev;
  }

  /** A task is done only if every required check has runner evidence with the expected exit code. */
  markDone(taskId: string): void {
    const t = this.task(taskId);
    if (t.status !== "needs_review") throw new HarnessError(`${taskId} must be in needs_review to be marked done (is ${t.status})`);
    const missing = t.requiredChecks.filter((c) => {
      const latest = t.evidenceIds.map((id) => this.state.evidence[id]!).filter((e) => e.checkId === c.id).at(-1);
      return !latest || latest.exitCode !== c.expectExit;
    });
    if (missing.length) throw new HarnessError(`${taskId} lacks passing evidence for: ${missing.map((c) => c.id).join(", ")}`);
    t.status = "done";
    t.updatedAt = now();
    this.log("done", taskId);
    this.save();
  }

  /** Restricted actions fail closed: allowed only if a granted approval exists for that action (and task, if given). */
  requestApproval(action: RestrictedAction, description: string, taskId?: string): Approval {
    const a = Approval.parse({
      id: `A-${Object.keys(this.state.approvals).length + 1}`, action, description,
      ...(taskId ? { taskId } : {}), status: "requested", requestedAt: now(),
    });
    this.state.approvals[a.id] = a;
    this.log("approval_requested", taskId, action);
    this.save();
    return a;
  }

  decideApproval(id: string, decision: "granted" | "denied", decidedBy: string): void {
    const a = this.state.approvals[id];
    if (!a) throw new HarnessError(`unknown approval ${id}`);
    a.status = decision; a.decidedBy = decidedBy; a.decidedAt = now();
    this.log("approval_decided", a.taskId, `${id} ${decision}`);
    this.save();
  }

  isAllowed(action: RestrictedAction, taskId?: string): boolean {
    return Object.values(this.state.approvals).some(
      (a) => a.action === action && a.status === "granted" && (!a.taskId || a.taskId === taskId),
    );
  }
}
