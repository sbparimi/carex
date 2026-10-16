import { createHash } from "node:crypto";
import type { Db } from "./db.js";

export type Actor = { type: "user" | "staff" | "admin" | "system" | "anonymous"; id?: string };
export interface AuditEntry { tenantId: string; actor: Actor; action: string; targetType?: string; targetId?: string; ip?: string; detail?: Record<string, unknown> }

/**
 * Append-only record of who did what to which record (HIPAA-style access trail). Never stores passwords, tokens, codes, free-text
 * clinical content or raw IP addresses (a salted-free short hash lets an investigator correlate requests without keeping the address).
 */
export class Audit {
  constructor(private db: Db, private now: () => Date = () => new Date(), private log?: (e: unknown) => void) {}

  async record(e: AuditEntry): Promise<void> {
    try {
      await this.db.run(
        "INSERT INTO audit_log (tenant_id, at, actor_type, actor_id, action, target_type, target_id, ip_hash, detail) VALUES (?,?,?,?,?,?,?,?,?)",
        e.tenantId, this.now().toISOString(), e.actor.type, e.actor.id ?? null, e.action, e.targetType ?? null, e.targetId ?? null,
        e.ip ? createHash("sha256").update(e.ip).digest("hex").slice(0, 16) : null, e.detail ? JSON.stringify(e.detail).slice(0, 1000) : null);
    } catch (err) {
      // An audit failure must be visible to operators; it must not leak into the patient's response.
      this.log?.({ event: "audit_write_failed", action: e.action, error: err instanceof Error ? err.message : "unknown" });
    }
  }

  async list(tenantId: string, f: { limit?: number; before?: number; actorId?: string; targetId?: string; action?: string } = {}) {
    const where = ["tenant_id = ?"]; const p: unknown[] = [tenantId];
    if (f.before) { where.push("id < ?"); p.push(f.before); }
    if (f.actorId) { where.push("actor_id = ?"); p.push(f.actorId); }
    if (f.targetId) { where.push("target_id = ?"); p.push(f.targetId); }
    if (f.action) { where.push("action = ?"); p.push(f.action); }
    return this.db.all<{ id: number; at: string; actor_type: string; actor_id: string | null; action: string; target_type: string | null; target_id: string | null; detail: string | null }>(
      `SELECT id, at, actor_type, actor_id, action, target_type, target_id, detail FROM audit_log WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`, ...p, Math.min(f.limit ?? 100, 500));
  }
}
