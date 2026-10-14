import type { StateStore } from "./store.js";
import { scopesConflict } from "./scope.js";
import type { Task } from "./schemas.js";

export interface Limits { maxConcurrent: number }

/** pending -> ready for every task whose dependencies are all done. Returns the ids promoted. */
export function promoteReady(store: StateStore): string[] {
  const promoted: string[] = [];
  const { tasks } = store.snapshot();
  for (const id of Object.keys(tasks).sort()) {
    const t = tasks[id]!;
    if (t.status === "pending" && t.dependsOn.every((d) => tasks[d]!.status === "done")) {
      store.transition(id, "ready");
      promoted.push(id);
    }
  }
  return promoted;
}

/**
 * Ready tasks that may start now: bounded by the concurrency cap, and never
 * overlapping the write scope of a running or already-selected task.
 */
export function selectDispatchable(store: StateStore, limits: Limits): Task[] {
  const { tasks } = store.snapshot();
  const all = Object.values(tasks);
  const running = all.filter((t) => t.status === "in_progress");
  const chosen: Task[] = [];
  const busy = (t: Task) => [...running, ...chosen].some((o) => scopesConflict(t.scope.write, o.scope.write));
  for (const t of all.filter((x) => x.status === "ready").sort((a, b) => a.id.localeCompare(b.id))) {
    if (running.length + chosen.length >= limits.maxConcurrent) break;
    if (!busy(t)) chosen.push(t);
  }
  return chosen;
}

/** After a crash, tasks left in_progress have unknown outcomes. They are failed (spending one retry) and re-queued or escalated. */
export function recoverInterrupted(store: StateStore): string[] {
  const recovered: string[] = [];
  for (const t of Object.values(store.snapshot().tasks)) {
    if (t.status !== "in_progress") continue;
    store.transition(t.id, "failed");
    store.transition(t.id, t.retries >= t.budget.maxRetries ? "escalated" : "ready");
    recovered.push(t.id);
  }
  return recovered;
}
