import type { Task } from "./schemas.js";

/** Returns the first dependency problem found, or null if the graph is valid. */
export function findGraphProblem(tasks: Record<string, Task>): string | null {
  for (const t of Object.values(tasks)) {
    for (const d of t.dependsOn) {
      if (!tasks[d]) return `${t.id} depends on unknown task ${d}`;
      if (d === t.id) return `${t.id} depends on itself`;
    }
  }
  const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
  const visit = (id: string, path: string[]): string | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return `dependency cycle: ${[...path, id].join(" -> ")}`;
    state.set(id, 1);
    for (const d of tasks[id]!.dependsOn) {
      const p = visit(d, [...path, id]);
      if (p) return p;
    }
    state.set(id, 2);
    return null;
  };
  for (const id of Object.keys(tasks)) {
    const p = visit(id, []);
    if (p) return p;
  }
  return null;
}
