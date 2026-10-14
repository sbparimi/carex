// Owner-approved spec for apps/api/src/admin-keys.ts (ADR-004): per-tenant admin API keys, stored only as hashes.
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, seedDb, type Db } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";
import { AdminKeys } from "../src/admin-keys.js";

let db: Db; let keys: AdminKeys;
beforeEach(() => { db = openDb(); seedDb(db, syntheticCatalog()); keys = new AdminKeys(db, () => new Date("2026-10-14T10:00:00Z")); });

describe("admin keys", () => {
  it("creates a key shown once, in the form cxa_<43 url-safe chars>, and never stores the plaintext", () => {
    const k = keys.create("tn-north", "ops laptop");
    expect(k).toMatch(/^cxa_[A-Za-z0-9_-]{43}$/);
    const rows = db.prepare("SELECT * FROM admin_keys").all() as { key_hash: string; label: string; tenant_id: string; created_at: string }[];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(k);
    expect(rows[0]).toMatchObject({ tenant_id: "tn-north", label: "ops laptop", created_at: "2026-10-14T10:00:00.000Z" });
    expect(rows[0]!.key_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("verifies a key to its own tenant only", () => {
    const k = keys.create("tn-north", "a");
    expect(keys.verify(k)).toBe("tn-north");
    expect(keys.verify(k + "x")).toBeUndefined();
    expect(keys.verify(k.slice(0, -1))).toBeUndefined();
  });
  it("rejects malformed, empty and non-string input without throwing", () => {
    for (const bad of [undefined, null, "", "cxa_", "Bearer abc", "x".repeat(1000), 7 as unknown as string]) expect(keys.verify(bad as string | undefined)).toBeUndefined();
  });
  it("gives each key a different value, and revoked keys stop working", () => {
    const a = keys.create("tn-north", "a"); const b = keys.create("tn-north", "b");
    expect(a).not.toBe(b);
    expect(keys.revokeByLabel("tn-north", "a")).toBe(1);
    expect(keys.verify(a)).toBeUndefined(); expect(keys.verify(b)).toBe("tn-north");
  });
  it("refuses to create a key for an unknown tenant or with an empty label", () => {
    expect(() => keys.create("tn-nope", "x")).toThrow();
    expect(() => keys.create("tn-north", "  ")).toThrow();
  });
});
