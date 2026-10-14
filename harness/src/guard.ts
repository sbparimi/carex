import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { checkCommand } from "./policy.mjs";
import type { StateStore } from "./store.js";
import type { RestrictedAction } from "./schemas.js";

export { checkCommand };

export interface GuardDecision { allowed: boolean; action?: RestrictedAction; approvalId?: string; reason: string }

/** Gate a command a worker wants to run. Restricted + not approved => denied and an approval is requested (once). */
export function guardCommand(store: StateStore, command: string, taskId?: string): GuardDecision {
  const v = checkCommand(command);
  if (!v.restricted) return { allowed: true, reason: "not restricted" };
  const action = v.restricted as RestrictedAction;
  if (store.isAllowed(action, taskId)) return { allowed: true, action, reason: `approved: ${v.reason}` };
  const open = Object.values(store.snapshot().approvals).find(
    (a) => a.status === "requested" && a.action === action && a.taskId === taskId && a.description.endsWith(command),
  );
  const a = open ?? store.requestApproval(action, `${v.reason}: ${command}`, taskId);
  return { allowed: false, action, approvalId: a.id, reason: `denied (${v.reason}); approval ${a.id} requested` };
}

/** Requests written by the Claude Code hook (a separate process) are imported by the orchestrator, never granted by it. */
export function ingestApprovalRequests(store: StateStore, jsonlPath: string): number {
  if (!existsSync(jsonlPath)) return 0;
  let n = 0;
  for (const line of readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean)) {
    try {
      const r = JSON.parse(line) as { action: RestrictedAction; command: string; reason: string; taskId?: string };
      const exists = Object.values(store.snapshot().approvals).some((a) => a.action === r.action && a.description.endsWith(r.command));
      if (!exists) { store.requestApproval(r.action, `${r.reason}: ${r.command}`, r.taskId); n++; }
    } catch { /* ignore malformed line */ }
  }
  return n;
}

export function appendRequest(path: string, req: object): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(req) + "\n");
}
