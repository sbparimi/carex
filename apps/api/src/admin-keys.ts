import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "./db.js";

const FORMAT = /^cxa_[A-Za-z0-9_-]{43}$/;
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

/** Per-tenant admin API keys (ADR-004). The plaintext is returned once at creation; only a SHA-256 hash is stored. Keys are 256-bit random, so an unsalted hash is sufficient. */
export class AdminKeys {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  create(tenantId: string, label: string): string {
    const l = label.trim();
    if (!l || l.length > 80) throw new Error("label required (max 80 characters)");
    if (!this.db.prepare("SELECT 1 AS ok FROM tenants WHERE id = ?").get(tenantId)) throw new Error("unknown tenant");
    const key = `cxa_${randomBytes(32).toString("base64url")}`;
    this.db.prepare("INSERT INTO admin_keys (tenant_id, key_hash, label, created_at) VALUES (?,?,?,?)").run(tenantId, hash(key), l, this.now().toISOString());
    return key;
  }

  /** The tenant id the key belongs to, or undefined for anything malformed, unknown or revoked. */
  verify(key: unknown): string | undefined {
    if (typeof key !== "string" || !FORMAT.test(key)) return undefined;
    const row = this.db.prepare("SELECT tenant_id, key_hash FROM admin_keys WHERE key_hash = ? AND revoked_at IS NULL").get(hash(key)) as { tenant_id: string; key_hash: string } | undefined;
    if (!row) return undefined;
    const a = Buffer.from(row.key_hash), b = Buffer.from(hash(key));
    return a.length === b.length && timingSafeEqual(a, b) ? row.tenant_id : undefined;
  }

  revokeByLabel(tenantId: string, label: string): number {
    return Number(this.db.prepare("UPDATE admin_keys SET revoked_at = ? WHERE tenant_id = ? AND label = ? AND revoked_at IS NULL").run(this.now().toISOString(), tenantId, label).changes);
  }
}
