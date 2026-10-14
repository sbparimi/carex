import { randomBytes } from "node:crypto";
import type { BrandConfig } from "@carex/contracts";
import type { Db } from "./db.js";

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
export class DbAdmin {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  private async requireTenant(t: string) { if (!(await this.db.get("SELECT 1 AS ok FROM tenants WHERE id = ?", t))) throw new AdminNotFoundError(); }
  private async requireClinic(t: string, c: string) { if (!(await this.db.get("SELECT 1 AS ok FROM clinics WHERE tenant_id = ? AND id = ?", t, c))) throw new AdminNotFoundError(); }
  private async requireProvider(t: string, p: string) { if (!(await this.db.get("SELECT 1 AS ok FROM providers WHERE tenant_id = ? AND id = ?", t, p))) throw new AdminNotFoundError(); }

  // ---- brand and analytics
  async updateBrand(tenantId: string, patch: BrandPatch): Promise<BrandConfig> {
    await this.requireTenant(tenantId);
    const sets: string[] = []; const args: (string | null)[] = [];
    if (patch.displayName !== undefined) { sets.push("display_name = ?"); args.push(text(patch.displayName, "displayName", 80)); }
    if (patch.primaryColor !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(patch.primaryColor)) bad("primaryColor must be #rrggbb"); sets.push("primary_color = ?"); args.push(patch.primaryColor); }
    if (patch.logoUrl !== undefined) { if (patch.logoUrl !== null && !/^https:\/\/[^\s]{1,500}$/.test(patch.logoUrl)) bad("logoUrl must be an https URL"); sets.push("logo_url = ?"); args.push(patch.logoUrl); }
    if (patch.supportEmail !== undefined) { if (patch.supportEmail !== null && !/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(patch.supportEmail)) bad("supportEmail is invalid"); sets.push("support_email = ?"); args.push(patch.supportEmail); }
    if (patch.supportPhone !== undefined) { if (patch.supportPhone !== null && !/^[0-9+()\-. ]{5,30}$/.test(patch.supportPhone)) bad("supportPhone is invalid"); sets.push("support_phone = ?"); args.push(patch.supportPhone); }
    if (sets.length) await this.db.run(`UPDATE tenants SET ${sets.join(", ")} WHERE id = ?`, ...args, tenantId);
    const r = (await this.db.get<{ display_name: string; primary_color: string; logo_url: string | null; support_email: string | null; support_phone: string | null }>("SELECT display_name, primary_color, logo_url, support_email, support_phone FROM tenants WHERE id = ?", tenantId))!;
    const brand: BrandConfig = { displayName: r.display_name, primaryColor: r.primary_color };
    if (r.logo_url !== null) brand.logoUrl = r.logo_url;
    if (r.support_email !== null) brand.supportEmail = r.support_email;
    if (r.support_phone !== null) brand.supportPhone = r.support_phone;
    return brand;
  }

  async setAnalytics(tenantId: string, enabled: boolean): Promise<void> {
    await this.requireTenant(tenantId);
    await this.db.run("UPDATE tenants SET analytics_enabled = ? WHERE id = ?", enabled ? 1 : 0, tenantId);
  }

  // ---- clinics
  async listClinics(tenantId: string): Promise<AdminClinic[]> {
    await this.requireTenant(tenantId);
    const rows = await this.db.all<
      { id: string; name: string; city: string; address: string; state_code: string; time_zone: string; status: "active" | "inactive"; bookable: number }>("SELECT id, name, city, address, state_code, time_zone, status, bookable FROM clinics WHERE tenant_id = ? ORDER BY name, id", tenantId);
    return rows.map((r) => ({ id: r.id, name: r.name, city: r.city, address: r.address, stateCode: r.state_code, timeZone: r.time_zone, status: r.status, bookable: r.bookable === 1 }));
  }

  /** New clinics start inactive and not bookable: nothing becomes visible to patients until an admin activates it. */
  async createClinic(tenantId: string, c: NewClinic): Promise<AdminClinic> {
    await this.requireTenant(tenantId);
    const name = text(c.name, "name"), city = text(c.city, "city"), address = text(c.address, "address", 200);
    if (typeof c.stateCode !== "string" || !/^[A-Z]{2}$/.test(c.stateCode)) bad("stateCode must be two capital letters");
    const tz = validTz(c.timeZone);
    const id = `cl-${randomBytes(5).toString("hex")}`;
    await this.db.run("INSERT INTO clinics (id, tenant_id, name, city, address, state_code, time_zone, status, bookable) VALUES (?,?,?,?,?,?,?,'inactive',0)", id, tenantId, name, city, address, c.stateCode, tz);
    return { id, name, city, address, stateCode: c.stateCode, timeZone: tz, status: "inactive", bookable: false };
  }

  async updateClinic(tenantId: string, clinicId: string, p: ClinicPatch): Promise<AdminClinic & { affectedFutureAppointments: number }> {
    await this.requireClinic(tenantId, clinicId);
    const sets: string[] = []; const args: (string | number)[] = [];
    if (p.name !== undefined) { sets.push("name = ?"); args.push(text(p.name, "name")); }
    if (p.city !== undefined) { sets.push("city = ?"); args.push(text(p.city, "city")); }
    if (p.address !== undefined) { sets.push("address = ?"); args.push(text(p.address, "address", 200)); }
    if (p.timeZone !== undefined) { sets.push("time_zone = ?"); args.push(validTz(p.timeZone)); }
    if (p.status !== undefined) { if (p.status !== "active" && p.status !== "inactive") bad("status must be active or inactive"); sets.push("status = ?"); args.push(p.status); }
    if (p.bookable !== undefined) { if (typeof p.bookable !== "boolean") bad("bookable must be true or false"); sets.push("bookable = ?"); args.push(p.bookable ? 1 : 0); }
    if (sets.length) await this.db.run(`UPDATE clinics SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ?`, ...args, tenantId, clinicId);
    const clinic = (await this.listClinics(tenantId)).find((c) => c.id === clinicId)!;
    const n = (await this.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM appointments WHERE tenant_id = ? AND clinic_id = ? AND status = 'confirmed' AND starts_at > ?", tenantId, clinicId, this.now().toISOString()))!;
    return { ...clinic, affectedFutureAppointments: n.n };
  }

  // ---- visit types per clinic
  async setClinicVisitType(tenantId: string, clinicId: string, visitTypeId: string, active: boolean): Promise<void> {
    await this.requireClinic(tenantId, clinicId);
    if (!(await this.db.get("SELECT 1 AS ok FROM visit_types WHERE tenant_id = ? AND id = ?", tenantId, visitTypeId))) throw new AdminNotFoundError();
    await this.db.run("INSERT INTO clinic_visit_types (tenant_id, clinic_id, visit_type_id, active) VALUES (?,?,?,?) ON CONFLICT(clinic_id, visit_type_id) DO UPDATE SET active = excluded.active", tenantId, clinicId, visitTypeId, active ? 1 : 0);
  }

  // ---- availability and time off
  async getAvailability(tenantId: string, providerId: string, clinicId: string): Promise<Rule[]> {
    await this.requireProvider(tenantId, providerId); await this.requireClinic(tenantId, clinicId);
    const rows = await this.db.all<{ weekday: number; start_minute: number; end_minute: number }>("SELECT weekday, start_minute, end_minute FROM availability_rules WHERE tenant_id = ? AND provider_id = ? AND clinic_id = ? ORDER BY weekday, start_minute", tenantId, providerId, clinicId);
    return rows.map((r) => ({ weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute }));
  }

  /** Replaces the whole weekly schedule in one transaction; invalid input changes nothing. */
  async setAvailability(tenantId: string, providerId: string, clinicId: string, rules: Rule[]): Promise<void> {
    await this.requireProvider(tenantId, providerId); await this.requireClinic(tenantId, clinicId);
    if (!Array.isArray(rules) || rules.length > 70) bad("rules must be a list of at most 70 entries");
    for (const r of rules) {
      if (![r?.weekday, r?.startMinute, r?.endMinute].every(Number.isInteger)) bad("rule fields must be integers");
      if (r.weekday < 0 || r.weekday > 6) bad("weekday must be 0-6");
      if (r.startMinute < 0 || r.endMinute > 1440 || r.endMinute <= r.startMinute) bad("a rule must end after it starts, within one day");
    }
    const sorted = [...rules].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
    for (let i = 1; i < sorted.length; i++) if (sorted[i]!.weekday === sorted[i - 1]!.weekday && sorted[i]!.startMinute < sorted[i - 1]!.endMinute) bad("rules overlap");
    await this.db.tx(async (tx) => {
      await tx.run("DELETE FROM availability_rules WHERE tenant_id = ? AND provider_id = ? AND clinic_id = ?", tenantId, providerId, clinicId);
      for (const r of sorted) await tx.run("INSERT INTO availability_rules (tenant_id, provider_id, clinic_id, weekday, start_minute, end_minute) VALUES (?,?,?,?,?,?)", tenantId, providerId, clinicId, r.weekday, r.startMinute, r.endMinute);
    });
  }

  async addTimeOff(tenantId: string, providerId: string, startsAt: string, endsAt: string): Promise<number> {
    await this.requireProvider(tenantId, providerId);
    const s = Date.parse(startsAt), e = Date.parse(endsAt);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) bad("time off must end after it starts");
    const r = await this.db.run("INSERT INTO time_off (tenant_id, provider_id, starts_at, ends_at) VALUES (?,?,?,?) RETURNING id", tenantId, providerId, new Date(s).toISOString(), new Date(e).toISOString());
    return Number(r.rows[0].id);
  }

  async removeTimeOff(tenantId: string, id: number): Promise<void> {
    const r = await this.db.run("DELETE FROM time_off WHERE tenant_id = ? AND id = ?", tenantId, id);
    if (r.changes === 0) throw new AdminNotFoundError();
  }
}
