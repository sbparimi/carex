import { randomBytes } from "node:crypto";
import type { BrandConfig } from "@carex/contracts";
import type { Db } from "./db.js";
import { inTransaction } from "./db.js";

export class AdminNotFoundError extends Error { constructor() { super("not found"); this.name = "AdminNotFoundError"; } }
export class AdminValidationError extends Error { constructor(message: string) { super(message); this.name = "AdminValidationError"; } }

export interface AdminClinic { id: string; name: string; city: string; address: string; stateCode: string; timeZone: string; status: "active" | "inactive"; bookable: boolean }
export interface Rule { weekday: number; startMinute: number; endMinute: number }
export interface BrandPatch { displayName?: string; primaryColor?: string; logoUrl?: string | null; supportEmail?: string | null; supportPhone?: string | null }
export interface NewClinic { name: string; city: string; address: string; stateCode: string; timeZone: string }
export interface ClinicPatch { name?: string; city?: string; address?: string; timeZone?: string; status?: "active" | "inactive"; bookable?: boolean }

const bad = (m: string): never => { throw new AdminValidationError(m); };
const text = (v: unknown, name: string, max = 120): string => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : bad(`${name} is required (max ${max} characters)`));
const validTz = (tz: unknown): string => {
  if (typeof tz !== "string" || !tz.includes("/")) return bad("timeZone must be an IANA name");
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { bad("timeZone must be an IANA name"); }
  return tz;
};

/** Tenant-scoped configuration changes (ADR-004). Every statement filters on tenant_id; a row of another tenant is indistinguishable from a missing one. */
export class SqliteAdmin {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  private requireTenant(t: string) { if (!this.db.prepare("SELECT 1 AS ok FROM tenants WHERE id = ?").get(t)) throw new AdminNotFoundError(); }
  private requireClinic(t: string, c: string) { if (!this.db.prepare("SELECT 1 AS ok FROM clinics WHERE tenant_id = ? AND id = ?").get(t, c)) throw new AdminNotFoundError(); }
  private requireProvider(t: string, p: string) { if (!this.db.prepare("SELECT 1 AS ok FROM providers WHERE tenant_id = ? AND id = ?").get(t, p)) throw new AdminNotFoundError(); }

  // ---- brand and analytics
  updateBrand(tenantId: string, patch: BrandPatch): BrandConfig {
    this.requireTenant(tenantId);
    const sets: string[] = []; const args: (string | null)[] = [];
    if (patch.displayName !== undefined) { sets.push("display_name = ?"); args.push(text(patch.displayName, "displayName", 80)); }
    if (patch.primaryColor !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(patch.primaryColor)) bad("primaryColor must be #rrggbb"); sets.push("primary_color = ?"); args.push(patch.primaryColor); }
    if (patch.logoUrl !== undefined) { if (patch.logoUrl !== null && !/^https:\/\/[^\s]{1,500}$/.test(patch.logoUrl)) bad("logoUrl must be an https URL"); sets.push("logo_url = ?"); args.push(patch.logoUrl); }
    if (patch.supportEmail !== undefined) { if (patch.supportEmail !== null && !/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(patch.supportEmail)) bad("supportEmail is invalid"); sets.push("support_email = ?"); args.push(patch.supportEmail); }
    if (patch.supportPhone !== undefined) { if (patch.supportPhone !== null && !/^[0-9+()\-. ]{5,30}$/.test(patch.supportPhone)) bad("supportPhone is invalid"); sets.push("support_phone = ?"); args.push(patch.supportPhone); }
    if (sets.length) this.db.prepare(`UPDATE tenants SET ${sets.join(", ")} WHERE id = ?`).run(...args, tenantId);
    const r = this.db.prepare("SELECT display_name, primary_color, logo_url, support_email, support_phone FROM tenants WHERE id = ?").get(tenantId) as { display_name: string; primary_color: string; logo_url: string | null; support_email: string | null; support_phone: string | null };
    const brand: BrandConfig = { displayName: r.display_name, primaryColor: r.primary_color };
    if (r.logo_url !== null) brand.logoUrl = r.logo_url;
    if (r.support_email !== null) brand.supportEmail = r.support_email;
    if (r.support_phone !== null) brand.supportPhone = r.support_phone;
    return brand;
  }

  setAnalytics(tenantId: string, enabled: boolean): void {
    this.requireTenant(tenantId);
    this.db.prepare("UPDATE tenants SET analytics_enabled = ? WHERE id = ?").run(enabled ? 1 : 0, tenantId);
  }

  // ---- clinics
  listClinics(tenantId: string): AdminClinic[] {
    this.requireTenant(tenantId);
    const rows = this.db.prepare("SELECT id, name, city, address, state_code, time_zone, status, bookable FROM clinics WHERE tenant_id = ? ORDER BY name, id").all(tenantId) as unknown as
      { id: string; name: string; city: string; address: string; state_code: string; time_zone: string; status: "active" | "inactive"; bookable: number }[];
    return rows.map((r) => ({ id: r.id, name: r.name, city: r.city, address: r.address, stateCode: r.state_code, timeZone: r.time_zone, status: r.status, bookable: r.bookable === 1 }));
  }

  /** New clinics start inactive and not bookable: nothing becomes visible to patients until an admin activates it. */
  createClinic(tenantId: string, c: NewClinic): AdminClinic {
    this.requireTenant(tenantId);
    const name = text(c.name, "name"), city = text(c.city, "city"), address = text(c.address, "address", 200);
    if (typeof c.stateCode !== "string" || !/^[A-Z]{2}$/.test(c.stateCode)) bad("stateCode must be two capital letters");
    const tz = validTz(c.timeZone);
    const id = `cl-${randomBytes(5).toString("hex")}`;
    this.db.prepare("INSERT INTO clinics (id, tenant_id, name, city, address, state_code, time_zone, status, bookable) VALUES (?,?,?,?,?,?,?,'inactive',0)").run(id, tenantId, name, city, address, c.stateCode, tz);
    return { id, name, city, address, stateCode: c.stateCode, timeZone: tz, status: "inactive", bookable: false };
  }

  updateClinic(tenantId: string, clinicId: string, p: ClinicPatch): AdminClinic & { affectedFutureAppointments: number } {
    this.requireClinic(tenantId, clinicId);
    const sets: string[] = []; const args: (string | number)[] = [];
    if (p.name !== undefined) { sets.push("name = ?"); args.push(text(p.name, "name")); }
    if (p.city !== undefined) { sets.push("city = ?"); args.push(text(p.city, "city")); }
    if (p.address !== undefined) { sets.push("address = ?"); args.push(text(p.address, "address", 200)); }
    if (p.timeZone !== undefined) { sets.push("time_zone = ?"); args.push(validTz(p.timeZone)); }
    if (p.status !== undefined) { if (p.status !== "active" && p.status !== "inactive") bad("status must be active or inactive"); sets.push("status = ?"); args.push(p.status); }
    if (p.bookable !== undefined) { if (typeof p.bookable !== "boolean") bad("bookable must be true or false"); sets.push("bookable = ?"); args.push(p.bookable ? 1 : 0); }
    if (sets.length) this.db.prepare(`UPDATE clinics SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ?`).run(...args, tenantId, clinicId);
    const clinic = this.listClinics(tenantId).find((c) => c.id === clinicId)!;
    const n = this.db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND clinic_id = ? AND status = 'confirmed' AND starts_at > ?").get(tenantId, clinicId, this.now().toISOString()) as { n: number };
    return { ...clinic, affectedFutureAppointments: n.n };
  }

  // ---- visit types per clinic
  setClinicVisitType(tenantId: string, clinicId: string, visitTypeId: string, active: boolean): void {
    this.requireClinic(tenantId, clinicId);
    if (!this.db.prepare("SELECT 1 AS ok FROM visit_types WHERE tenant_id = ? AND id = ?").get(tenantId, visitTypeId)) throw new AdminNotFoundError();
    this.db.prepare("INSERT INTO clinic_visit_types (tenant_id, clinic_id, visit_type_id, active) VALUES (?,?,?,?) ON CONFLICT(clinic_id, visit_type_id) DO UPDATE SET active = excluded.active").run(tenantId, clinicId, visitTypeId, active ? 1 : 0);
  }

  // ---- availability and time off
  getAvailability(tenantId: string, providerId: string, clinicId: string): Rule[] {
    this.requireProvider(tenantId, providerId); this.requireClinic(tenantId, clinicId);
    const rows = this.db.prepare("SELECT weekday, start_minute, end_minute FROM availability_rules WHERE tenant_id = ? AND provider_id = ? AND clinic_id = ? ORDER BY weekday, start_minute").all(tenantId, providerId, clinicId) as { weekday: number; start_minute: number; end_minute: number }[];
    return rows.map((r) => ({ weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute }));
  }

  /** Replaces the whole weekly schedule in one transaction; invalid input changes nothing. */
  setAvailability(tenantId: string, providerId: string, clinicId: string, rules: Rule[]): void {
    this.requireProvider(tenantId, providerId); this.requireClinic(tenantId, clinicId);
    if (!Array.isArray(rules) || rules.length > 70) bad("rules must be a list of at most 70 entries");
    for (const r of rules) {
      if (![r?.weekday, r?.startMinute, r?.endMinute].every(Number.isInteger)) bad("rule fields must be integers");
      if (r.weekday < 0 || r.weekday > 6) bad("weekday must be 0-6");
      if (r.startMinute < 0 || r.endMinute > 1440 || r.endMinute <= r.startMinute) bad("a rule must end after it starts, within one day");
    }
    const sorted = [...rules].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
    for (let i = 1; i < sorted.length; i++) if (sorted[i]!.weekday === sorted[i - 1]!.weekday && sorted[i]!.startMinute < sorted[i - 1]!.endMinute) bad("rules overlap");
    inTransaction(this.db, () => {
      this.db.prepare("DELETE FROM availability_rules WHERE tenant_id = ? AND provider_id = ? AND clinic_id = ?").run(tenantId, providerId, clinicId);
      const ins = this.db.prepare("INSERT INTO availability_rules (tenant_id, provider_id, clinic_id, weekday, start_minute, end_minute) VALUES (?,?,?,?,?,?)");
      for (const r of sorted) ins.run(tenantId, providerId, clinicId, r.weekday, r.startMinute, r.endMinute);
    });
  }

  addTimeOff(tenantId: string, providerId: string, startsAt: string, endsAt: string): number {
    this.requireProvider(tenantId, providerId);
    const s = Date.parse(startsAt), e = Date.parse(endsAt);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) bad("time off must end after it starts");
    return Number(this.db.prepare("INSERT INTO time_off (tenant_id, provider_id, starts_at, ends_at) VALUES (?,?,?,?)").run(tenantId, providerId, new Date(s).toISOString(), new Date(e).toISOString()).lastInsertRowid);
  }

  removeTimeOff(tenantId: string, id: number): void {
    const r = this.db.prepare("DELETE FROM time_off WHERE tenant_id = ? AND id = ?").run(tenantId, id);
    if (Number(r.changes) === 0) throw new AdminNotFoundError();
  }
}
