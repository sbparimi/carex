import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations.js";
import type { CatalogData } from "./catalog.js";

export type Db = DatabaseSync;

/** Opens (and migrates) the CareX database. Use ":memory:" in tests. */
export function openDb(path = ":memory:"): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN IMMEDIATE");
    try { db.exec(MIGRATIONS[v]!); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  }
}

/** Runs `fn` in one write transaction (BEGIN IMMEDIATE takes the write lock up front, so check-then-insert cannot race). */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const out = fn(); db.exec("COMMIT"); return out; }
  catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
}

const b = (v: boolean) => (v ? 1 : 0);

/** Loads catalog data (the synthetic seed, or an admin import) into the database. */
export function seedDb(db: Db, d: CatalogData): void {
  inTransaction(db, () => {
    const tenant = db.prepare("INSERT INTO tenants (id, slug, status, display_name, primary_color, logo_url, support_email, support_phone, analytics_enabled) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const t of d.tenants) tenant.run(t.id, t.slug, t.status, t.brand.displayName, t.brand.primaryColor, t.brand.logoUrl ?? null, t.brand.supportEmail ?? null, t.brand.supportPhone ?? null, b(t.analyticsEnabled));
    const clinic = db.prepare("INSERT INTO clinics (id, tenant_id, name, city, address, state_code, time_zone, status, bookable) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const c of d.clinics) clinic.run(c.id, c.tenantId, c.name, c.city, c.address, c.stateCode, c.timeZone, c.status, b(c.bookable));
    const vt = db.prepare("INSERT INTO visit_types (id, tenant_id, canonical_type, label, description, duration_min, status) VALUES (?,?,?,?,?,?,?)");
    for (const s of d.services) vt.run(s.id, s.tenantId, s.canonicalType, s.label, s.description, s.durationMin ?? 30, s.status);
    const cvt = db.prepare("INSERT INTO clinic_visit_types (tenant_id, clinic_id, visit_type_id, active) VALUES (?,?,?,?)");
    for (const x of d.clinicServices) cvt.run(x.tenantId, x.clinicId, x.serviceId, b(x.active));
    const pr = db.prepare("INSERT INTO providers (id, tenant_id, display_name, status) VALUES (?,?,?,?)");
    for (const p of d.providers) pr.run(p.id, p.tenantId, p.displayName, p.status);
    const el = db.prepare("INSERT INTO provider_eligibility (tenant_id, clinic_id, visit_type_id, provider_id, active) VALUES (?,?,?,?,?)");
    for (const e of d.eligibility) el.run(e.tenantId, e.clinicId, e.serviceId, e.providerId, b(e.active));
    const av = db.prepare("INSERT INTO availability_rules (tenant_id, provider_id, clinic_id, weekday, start_minute, end_minute) VALUES (?,?,?,?,?,?)");
    for (const a of d.availability ?? []) av.run(a.tenantId, a.providerId, a.clinicId, a.weekday, a.startMinute, a.endMinute);
    const to = db.prepare("INSERT INTO time_off (tenant_id, provider_id, starts_at, ends_at) VALUES (?,?,?,?)");
    for (const t of d.timeOff ?? []) to.run(t.tenantId, t.providerId, t.startsAt, t.endsAt);
  });
}
