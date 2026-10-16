import { MIGRATIONS } from "./migrations.js";
import type { CatalogData } from "./catalog.js";

/**
 * Minimal async database handle over PostgreSQL (ADR-005). SQL uses `?` placeholders (converted to $1..$n), so the same
 * statements run on PGlite (in-process Postgres: tests and zero-setup local runs) and on Neon via `pg` (production).
 */
export interface Db {
  all<T = any>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  /** `changes` = rows affected; `rows` = rows from RETURNING. */
  run(sql: string, ...params: unknown[]): Promise<{ changes: number; rows: any[] }>;
  /** Runs `fn` in one transaction on a single connection; use ONLY the handle passed to `fn` inside it. */
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface OpenOptions {
  /** Postgres connection string (Neon). Read from DATABASE_URL by the entry points; never logged. */
  url?: string;
  /** Directory for a file-backed PGlite database. Omit for in-memory. Ignored when `url` is set. */
  dir?: string;
}

const toPg = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

/** True for a unique-constraint violation (optionally on a named index or constraint). */
export function isUniqueViolation(e: unknown, name?: string): boolean {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err?.code !== "23505") return false;
  return !name || err.constraint === name || String(err.message ?? "").includes(name);
}

interface Runner { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; affectedRows?: number; rowCount?: number | null }> }

function wrap(r: Runner, tx: (fn: (tx: Db) => Promise<any>) => Promise<any>, close: () => Promise<void>): Db {
  const exec = async (sql: string, params: unknown[]) => {
    const res = await r.query(toPg(sql), params as unknown[]);
    return { rows: res.rows, changes: Number(res.affectedRows ?? res.rowCount ?? 0) };
  };
  return {
    all: async (sql, ...p) => (await exec(sql, p)).rows,
    get: async (sql, ...p) => (await exec(sql, p)).rows[0],
    run: (sql, ...p) => exec(sql, p),
    tx, close,
  };
}

export async function openDb(opts: OpenOptions | string = {}): Promise<Db> {
  const o: OpenOptions = typeof opts === "string" ? (opts === ":memory:" ? {} : { dir: opts }) : opts;
  let db: Db;
  if (o.url) {
    const { default: pg } = await import("pg");
    pg.types.setTypeParser(20, (v: string) => Number(v));                 // BIGINT / COUNT(*) as numbers
    const pool = new pg.Pool({ connectionString: o.url, max: 5, idleTimeoutMillis: 10_000 });
    pool.on("error", () => { /* an idle client dropped (Neon scales to zero); the pool replaces it */ });
    db = wrap(pool as unknown as Runner,
      async (fn) => {
        const c = await pool.connect();
        const inner = wrap(c as unknown as Runner, () => { throw new Error("nested transactions are not supported"); }, async () => {});
        try { await c.query("BEGIN"); const out = await fn(inner); await c.query("COMMIT"); return out; }
        catch (e) { try { await c.query("ROLLBACK"); } catch { /* connection already gone */ } throw e; }
        finally { c.release(); }
      },
      () => pool.end());
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const lite = o.dir ? new PGlite(o.dir) : new PGlite();
    await lite.waitReady;
    db = wrap(lite as unknown as Runner,
      (fn) => lite.transaction((t) => fn(wrap(t as unknown as Runner, () => { throw new Error("nested transactions are not supported"); }, async () => {}))),
      () => lite.close());
  }
  await migrate(db);
  return db;
}

export async function migrate(db: Db): Promise<void> {
  await db.run("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = (await db.get<{ v: number }>("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations"))!.v;
  for (let v = Number(done); v < MIGRATIONS.length; v++) {
    await db.tx(async (tx) => {
      await tx.run("SELECT pg_advisory_xact_lock(727001)");              // two app instances starting together must not both migrate
      const again = (await tx.get<{ v: number }>("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations"))!.v;
      if (Number(again) > v) return;
      for (const stmt of MIGRATIONS[v]!.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await tx.run(stmt);
      await tx.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", v + 1, new Date().toISOString());
    });
  }
}

const b = (v: boolean) => (v ? 1 : 0);

/** Loads catalog data (the synthetic seed, or an admin import) into the database. */
export async function seedDb(db: Db, d: CatalogData): Promise<void> {
  await db.tx(async (t) => {
    for (const x of d.tenants) await t.run("INSERT INTO tenants (id, slug, status, display_name, primary_color, logo_url, support_email, support_phone, analytics_enabled) VALUES (?,?,?,?,?,?,?,?,?)", x.id, x.slug, x.status, x.brand.displayName, x.brand.primaryColor, x.brand.logoUrl ?? null, x.brand.supportEmail ?? null, x.brand.supportPhone ?? null, b(x.analyticsEnabled));
    for (const c of d.clinics) await t.run("INSERT INTO clinics (id, tenant_id, name, city, address, state_code, time_zone, status, bookable) VALUES (?,?,?,?,?,?,?,?,?)", c.id, c.tenantId, c.name, c.city, c.address, c.stateCode, c.timeZone, c.status, b(c.bookable));
    for (const s of d.services) await t.run("INSERT INTO visit_types (id, tenant_id, canonical_type, label, description, duration_min, status) VALUES (?,?,?,?,?,?,?)", s.id, s.tenantId, s.canonicalType, s.label, s.description, s.durationMin ?? 30, s.status);
    for (const x of d.clinicServices) await t.run("INSERT INTO clinic_visit_types (tenant_id, clinic_id, visit_type_id, active) VALUES (?,?,?,?)", x.tenantId, x.clinicId, x.serviceId, b(x.active));
    for (const p of d.providers) await t.run("INSERT INTO providers (id, tenant_id, display_name, status) VALUES (?,?,?,?)", p.id, p.tenantId, p.displayName, p.status);
    for (const e of d.eligibility) await t.run("INSERT INTO provider_eligibility (tenant_id, clinic_id, visit_type_id, provider_id, active) VALUES (?,?,?,?,?)", e.tenantId, e.clinicId, e.serviceId, e.providerId, b(e.active));
    for (const a of d.availability ?? []) await t.run("INSERT INTO availability_rules (tenant_id, provider_id, clinic_id, weekday, start_minute, end_minute) VALUES (?,?,?,?,?,?)", a.tenantId, a.providerId, a.clinicId, a.weekday, a.startMinute, a.endMinute);
    for (const o of d.timeOff ?? []) await t.run("INSERT INTO time_off (tenant_id, provider_id, starts_at, ends_at) VALUES (?,?,?,?)", o.tenantId, o.providerId, o.startsAt, o.endsAt);
    for (const e of d.employers ?? []) await t.run("INSERT INTO employers (id, tenant_id, name) VALUES (?,?,?)", e.id, e.tenantId, e.name);
    for (const i of d.insurers ?? []) await t.run("INSERT INTO insurers (id, tenant_id, name) VALUES (?,?,?)", i.id, i.tenantId, i.name);
    for (const r of d.rules ?? []) await t.run(
      `UPDATE visit_types SET min_lead_minutes = ?, horizon_days = ?, buffer_before_min = ?, buffer_after_min = ?, min_age = ?, max_age = ?, new_patients = ?, modality = ?, requires_referral = ?, resource_kind = ?
        WHERE tenant_id = ? AND id = ?`, r.minLeadMinutes ?? null, r.horizonDays ?? null, r.bufferBeforeMin ?? 0, r.bufferAfterMin ?? 0, r.minAge ?? null, r.maxAge ?? null, r.newPatients ?? "any", r.modality ?? "in_person", b(r.requiresReferral ?? false), r.resourceKind ?? null, r.tenantId, r.serviceId);
    for (const r of d.resources ?? []) await t.run("INSERT INTO clinic_resources (id, tenant_id, clinic_id, kind, name) VALUES (?,?,?,?,?)", r.id, r.tenantId, r.clinicId, r.kind, r.name);
    for (const c of d.closures ?? []) await t.run("INSERT INTO clinic_closures (tenant_id, clinic_id, starts_at, ends_at, reason) VALUES (?,?,?,?,?)", c.tenantId, c.clinicId, c.startsAt, c.endsAt, c.reason ?? "");
    for (const p of d.profiles ?? []) await t.run("UPDATE providers SET specialty = ?, languages = ?, licensed_states = ?, accepting_new = ?, bio = ? WHERE tenant_id = ? AND id = ?",
      p.specialty ?? "", JSON.stringify(p.languages ?? []), JSON.stringify(p.licensedStates ?? []), b(p.acceptingNew ?? true), p.bio ?? "", p.tenantId, p.providerId);
    for (const s of d.tenantSettings ?? []) await t.run("UPDATE tenants SET intake_required = ?, video_join_base_url = ?, consent_version = ? WHERE id = ?", b(s.intakeRequired ?? true), s.videoJoinBaseUrl ?? null, s.consentVersion ?? "v1", s.tenantId);
    for (const r of d.employerRules ?? []) {
      await t.run("UPDATE employers SET verification = ?, email_domain = ? WHERE tenant_id = ? AND id = ?", r.verification, r.emailDomain?.toLowerCase() ?? null, r.tenantId, r.employerId);
      for (const e of r.roster ?? []) await t.run("INSERT INTO employer_roster (tenant_id, employer_id, email) VALUES (?,?,?)", r.tenantId, r.employerId, e.toLowerCase());
    }
    for (const n of d.networks ?? []) await t.run("INSERT INTO insurer_networks (tenant_id, insurer_id, clinic_id) VALUES (?,?,?)", n.tenantId, n.insurerId, n.clinicId);
    for (const c of d.coverage ?? []) await t.run("INSERT INTO coverage_rules (tenant_id, visit_type_id, employer_id, insurer_id, covered, copay_cents) VALUES (?,?,?,?,?,?)", c.tenantId, c.serviceId, c.employerId ?? null, c.insurerId ?? null, b(c.covered ?? true), c.copayCents ?? 0);
  });
}

let sharedTestDb: Promise<Db> | undefined;
/**
 * TEST ONLY. One in-memory PGlite per process, emptied on every call (TRUNCATE) instead of booting a fresh Postgres per test.
 * `close()` on the returned handle is a no-op so tests can keep their usual teardown.
 */
export async function openTestDb(): Promise<Db> {
  sharedTestDb ??= openDb({});
  const db = await sharedTestDb;
  const tables = (await db.all<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'")).map((t) => t.tablename);
  await db.run(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
  return { ...db, close: async () => {} };
}
