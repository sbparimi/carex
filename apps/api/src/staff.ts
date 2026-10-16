import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Id, StateCode } from "@carex/contracts";
import { hashPassword, normalizeEmail, passwordProblem, verifyPassword } from "./accounts.js";
import type { Db } from "./db.js";
import { isUniqueViolation } from "./db.js";
import { IntakeError, type DbIntake } from "./intake.js";
import { BookingNotFoundError, SlotTakenError, type SchedulingSource } from "./scheduling.js";
import { localParts } from "./zoned.js";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const ABSOLUTE_MS = 12 * 3_600_000;
const TOUCH_MS = 60_000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;

export type Role = "front_desk" | "provider" | "admin";
export const ROLES: Role[] = ["front_desk", "provider", "admin"];
export interface StaffPrincipal { id: string; name: string; email: string; role: Role; providerId: string | null }
export class StaffError extends Error { constructor(public code: "invalid_input" | "invalid_credentials" | "locked" | "forbidden" | "not_found" | "conflict", message: string, public fields?: Record<string, string>) { super(message); } }

/** Staff accounts for one tenant: front desk, providers (see only their own day) and administrators. Created by an operator or tenant admin key, never self-registered. */
export class StaffAccounts {
  constructor(private db: Db, private now: () => Date = () => new Date()) {}

  async create(tenantId: string, i: { email: string; name: string; role: string; providerId?: string; password: string }): Promise<StaffPrincipal> {
    const fields: Record<string, string> = {};
    const email = typeof i.email === "string" ? normalizeEmail(i.email) : "";
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email)) fields.email = "Enter a valid email address";
    const name = typeof i.name === "string" ? i.name.trim() : "";
    if (!name || name.length > 120) fields.name = "Enter a name";
    if (!ROLES.includes(i.role as Role)) fields.role = "Role must be front_desk, provider or admin";
    const pw = passwordProblem(i.password, email); if (pw) fields.password = pw;
    let providerId: string | null = null;
    if (i.role === "provider") {
      if (!i.providerId || !(await this.db.get("SELECT 1 AS ok FROM providers WHERE tenant_id = ? AND id = ?", tenantId, i.providerId))) fields.providerId = "Choose the provider this login belongs to";
      else providerId = i.providerId;
    }
    if (Object.keys(fields).length) throw new StaffError("invalid_input", "Please check the highlighted fields", fields);
    const id = `st_${randomUUID()}`;
    try {
      await this.db.run("INSERT INTO staff_users (id, tenant_id, email, password_hash, name, role, provider_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        id, tenantId, email, await hashPassword(i.password), name, i.role, providerId, this.now().toISOString());
    } catch (e) { if (isUniqueViolation(e)) throw new StaffError("conflict", "A staff login with that email already exists"); throw e; }
    return { id, name, email, role: i.role as Role, providerId };
  }

  async list(tenantId: string): Promise<(StaffPrincipal & { active: boolean })[]> {
    const rows = await this.db.all<{ id: string; email: string; name: string; role: Role; provider_id: string | null; active: number }>("SELECT id, email, name, role, provider_id, active FROM staff_users WHERE tenant_id = ? ORDER BY name, id", tenantId);
    return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, providerId: r.provider_id, active: r.active === 1 }));
  }

  /** Deactivating signs the person out everywhere immediately. */
  async setActive(tenantId: string, id: string, active: boolean): Promise<void> {
    const r = await this.db.run("UPDATE staff_users SET active = ? WHERE tenant_id = ? AND id = ?", active ? 1 : 0, tenantId, id);
    if (r.changes === 0) throw new StaffError("not_found", "Not found");
    if (!active) await this.db.run("DELETE FROM staff_sessions WHERE staff_id = ?", id);
  }

  async setPassword(tenantId: string, id: string, password: string): Promise<void> {
    const pw = passwordProblem(password); if (pw) throw new StaffError("invalid_input", pw, { password: pw });
    const r = await this.db.run("UPDATE staff_users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE tenant_id = ? AND id = ?", await hashPassword(password), tenantId, id);
    if (r.changes === 0) throw new StaffError("not_found", "Not found");
    await this.db.run("DELETE FROM staff_sessions WHERE staff_id = ?", id);
  }

  async login(tenantId: string, emailRaw: string, password: string): Promise<{ staff: StaffPrincipal; token: string }> {
    const email = typeof emailRaw === "string" ? normalizeEmail(emailRaw) : "";
    const bad = () => new StaffError("invalid_credentials", "Invalid email or password");
    const u = typeof password === "string" && password.length <= 128
      ? await this.db.get<{ id: string; password_hash: string; name: string; role: Role; provider_id: string | null; active: number; failed_logins: number; locked_until: string | null }>(
        "SELECT id, password_hash, name, role, provider_id, active, failed_logins, locked_until FROM staff_users WHERE tenant_id = ? AND email = ?", tenantId, email) : undefined;
    if (!u) { await verifyPassword(String(password).slice(0, 128), await DUMMY); throw bad(); }
    if (u.locked_until && Date.parse(u.locked_until) > this.now().getTime()) throw new StaffError("locked", "Too many failed attempts. Try again in a few minutes.");
    if (!(await verifyPassword(password, u.password_hash)) || u.active !== 1) {
      const n = u.failed_logins + 1;
      await this.db.run("UPDATE staff_users SET failed_logins = ?, locked_until = ? WHERE id = ?", n >= MAX_FAILED ? 0 : n, n >= MAX_FAILED ? new Date(this.now().getTime() + LOCK_MS).toISOString() : null, u.id);
      throw bad();
    }
    await this.db.run("UPDATE staff_users SET failed_logins = 0, locked_until = NULL WHERE id = ?", u.id);
    const token = randomBytes(32).toString("base64url"); const t = this.now();
    await this.db.run("INSERT INTO staff_sessions (token_hash, staff_id, tenant_id, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)", sha(token), u.id, tenantId, t.toISOString(), new Date(t.getTime() + ABSOLUTE_MS).toISOString(), t.toISOString());
    return { staff: { id: u.id, name: u.name, email, role: u.role, providerId: u.provider_id }, token };
  }

  async logout(tenantId: string, token: string | undefined): Promise<void> { if (token) await this.db.run("DELETE FROM staff_sessions WHERE token_hash = ? AND tenant_id = ?", sha(token), tenantId); }

  async authenticate(tenantId: string, token: string | undefined): Promise<StaffPrincipal | undefined> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const s = await this.db.get<{ staff_id: string; expires_at: string; last_seen_at: string; idle: number; email: string; name: string; role: Role; provider_id: string | null; active: number }>(
      `SELECT s.staff_id, s.expires_at, s.last_seen_at, t.session_idle_minutes AS idle, u.email, u.name, u.role, u.provider_id, u.active
         FROM staff_sessions s JOIN tenants t ON t.id = s.tenant_id JOIN staff_users u ON u.id = s.staff_id WHERE s.token_hash = ? AND s.tenant_id = ?`, sha(token), tenantId);
    if (!s) return undefined;
    const now = this.now().getTime();
    if (s.active !== 1 || Date.parse(s.expires_at) <= now || now - Date.parse(s.last_seen_at) > s.idle * 60_000) { await this.db.run("DELETE FROM staff_sessions WHERE token_hash = ?", sha(token)); return undefined; }
    if (now - Date.parse(s.last_seen_at) > TOUCH_MS) await this.db.run("UPDATE staff_sessions SET last_seen_at = ? WHERE token_hash = ?", new Date(now).toISOString(), sha(token));
    return { id: s.staff_id, name: s.name, email: s.email, role: s.role, providerId: s.provider_id };
  }
}
const DUMMY = hashPassword("carex-dummy-staff-password-for-timing");

// ------------------------------------------------------------------------------------------------------------------------------------

export interface DeskRow {
  id: string; startsAt: string; endsAt: string; timeZone: string; status: string; clinicId: string; clinicName: string; visitLabel: string; providerId: string; providerName: string;
  patientName: string; patientDob: string | null; phone: string | null; email: string | null; reason: string | null; modality: string; joinUrl: string | null; copayCents: number;
  accommodations: string | null; interpreterLanguage: string | null; referralRef: string | null; bookedBy: string; lateCancel: boolean; cancelReason: string | null; hasAccount: boolean;
}
interface DbRow {
  id: string; starts_at: string; ends_at: string; status: string; clinic_id: string; clinic_name: string; time_zone: string; visit_label: string; provider_id: string; provider_name: string;
  patient_first_name: string; patient_last_name: string; patient_dob: string | null; u_dob: string | null; patient_phone: string | null; patient_email: string | null; reason: string | null; modality: string; join_url: string | null;
  copay_cents: number; accommodations: string | null; interpreter_language: string | null; referral_ref: string | null; booked_by: string; late_cancel: number; cancel_reason: string | null; user_id: string | null; pt_dob: string | null;
}
const SELECT = `SELECT a.id, a.starts_at, a.ends_at, a.status, a.clinic_id, c.name AS clinic_name, c.time_zone, v.label AS visit_label, a.provider_id, p.display_name AS provider_name,
    a.patient_first_name, a.patient_last_name, a.patient_dob, u.date_of_birth AS u_dob, pt.date_of_birth AS pt_dob, a.patient_phone, a.patient_email, a.reason, a.modality, a.join_url, a.copay_cents,
    a.accommodations, a.interpreter_language, a.referral_ref, a.booked_by, a.late_cancel, a.cancel_reason, a.user_id
  FROM appointments a JOIN clinics c ON c.id = a.clinic_id JOIN visit_types v ON v.id = a.visit_type_id JOIN providers p ON p.id = a.provider_id
  LEFT JOIN users u ON u.id = a.user_id LEFT JOIN patients pt ON pt.id = a.patient_id`;
const toRow = (r: DbRow): DeskRow => ({
  id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, timeZone: r.time_zone, status: r.status, clinicId: r.clinic_id, clinicName: r.clinic_name, visitLabel: r.visit_label, providerId: r.provider_id, providerName: r.provider_name,
  patientName: `${r.patient_first_name} ${r.patient_last_name}`.trim(), patientDob: r.patient_dob ?? r.pt_dob ?? r.u_dob, phone: r.patient_phone, email: r.patient_email, reason: r.reason, modality: r.modality, joinUrl: r.join_url,
  copayCents: r.copay_cents, accommodations: r.accommodations, interpreterLanguage: r.interpreter_language, referralRef: r.referral_ref, bookedBy: r.booked_by, lateCancel: r.late_cancel === 1, cancelReason: r.cancel_reason, hasAccount: !!r.user_id,
});

const TRANSITIONS: Record<string, string[]> = {
  confirmed: ["arrived", "completed", "no_show"], arrived: ["completed", "confirmed"], completed: ["arrived"], no_show: ["confirmed"], cancelled: [],
};
const phoneOk = (s: unknown) => typeof s === "string" && /^[0-9+() .-]{7,20}$/.test(s.trim());
const emailOk = (s: unknown) => typeof s === "string" && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(s.trim()) && s.length <= 254;

/** What staff can see and do. Every method takes the signed-in staff member; a provider login is confined to its own appointments. */
export class StaffDesk {
  constructor(private db: Db, private source: SchedulingSource, private intake: DbIntake, private now: () => Date = () => new Date()) {}

  private scope(staff: StaffPrincipal): { sql: string; params: unknown[] } { return staff.role === "provider" ? { sql: " AND a.provider_id = ?", params: [staff.providerId] } : { sql: "", params: [] }; }

  async catalog(tenantId: string, staff: StaffPrincipal) {
    const clinics = await this.db.all<{ id: string; name: string; time_zone: string; state_code: string }>("SELECT id, name, time_zone, state_code FROM clinics WHERE tenant_id = ? AND status = 'active' ORDER BY name, id", tenantId);
    const links = await this.db.all<{ clinic_id: string; visit_type_id: string; label: string; duration_min: number; provider_id: string; display_name: string }>(
      `SELECT e.clinic_id, e.visit_type_id, v.label, v.duration_min, e.provider_id, p.display_name FROM provider_eligibility e
         JOIN clinic_visit_types cv ON cv.clinic_id = e.clinic_id AND cv.visit_type_id = e.visit_type_id AND cv.active = 1
         JOIN visit_types v ON v.id = e.visit_type_id AND v.status = 'active' JOIN providers p ON p.id = e.provider_id AND p.status = 'active'
        WHERE e.tenant_id = ? AND e.active = 1 ORDER BY v.label, p.display_name`, tenantId);
    return {
      staff,
      clinics: clinics.map((c) => ({
        id: c.id, name: c.name, timeZone: c.time_zone, stateCode: c.state_code,
        visitTypes: [...new Map(links.filter((l) => l.clinic_id === c.id).map((l) => [l.visit_type_id, { id: l.visit_type_id, label: l.label, durationMin: l.duration_min }])).values()],
        providers: [...new Map(links.filter((l) => l.clinic_id === c.id && (staff.role !== "provider" || l.provider_id === staff.providerId)).map((l) => [l.provider_id, { id: l.provider_id, displayName: l.display_name, visitTypeIds: [] as string[] }])).values()]
          .map((p) => ({ ...p, visitTypeIds: links.filter((l) => l.clinic_id === c.id && l.provider_id === p.id).map((l) => l.visit_type_id) })),
      })),
    };
  }

  /** One local day at one clinic (or all of a provider's clinics), soonest first. `date` is YYYY-MM-DD in the clinic's own time zone. */
  async schedule(tenantId: string, staff: StaffPrincipal, f: { date: string; clinicId?: string; providerId?: string }): Promise<DeskRow[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || Number.isNaN(Date.parse(f.date))) throw new StaffError("invalid_input", "date must be YYYY-MM-DD");
    const sc = this.scope(staff);
    const day = Date.parse(`${f.date}T00:00:00Z`);
    const rows = await this.db.all<DbRow>(`${SELECT} WHERE a.tenant_id = ? AND a.starts_at >= ? AND a.starts_at < ?${f.clinicId ? " AND a.clinic_id = ?" : ""}${f.providerId ? " AND a.provider_id = ?" : ""}${sc.sql} ORDER BY a.starts_at, a.id`,
      tenantId, new Date(day - 86_400_000).toISOString(), new Date(day + 2 * 86_400_000).toISOString(), ...(f.clinicId ? [f.clinicId] : []), ...(f.providerId ? [f.providerId] : []), ...sc.params);
    return rows.filter((r) => { const l = localParts(new Date(r.starts_at), r.time_zone); return `${l.year}-${String(l.month).padStart(2, "0")}-${String(l.day).padStart(2, "0")}` === f.date; }).map(toRow);
  }

  private async load(tenantId: string, staff: StaffPrincipal, id: string, lock = false, db: Db = this.db): Promise<DbRow> {
    const sc = this.scope(staff);
    const r = await db.get<DbRow>(`${SELECT} WHERE a.tenant_id = ? AND a.id = ?${sc.sql}${lock ? " FOR UPDATE OF a" : ""}`, tenantId, id, ...sc.params);
    if (!r) throw new StaffError("not_found", "Not found");
    return r;
  }

  async get(tenantId: string, staff: StaffPrincipal, id: string): Promise<DeskRow> { return toRow(await this.load(tenantId, staff, id)); }

  async setStatus(tenantId: string, staff: StaffPrincipal, id: string, status: string): Promise<DeskRow> {
    return this.db.tx(async (tx) => {
      const r = await this.load(tenantId, staff, id, true, tx);
      if (r.status === status) return toRow(r);
      if (!(TRANSITIONS[r.status] ?? []).includes(status)) throw new StaffError("conflict", `An appointment that is ${r.status.replace("_", " ")} can't be marked ${status.replace("_", " ")}`);
      if (status === "no_show" && Date.parse(r.starts_at) > this.now().getTime()) throw new StaffError("conflict", "An appointment can only be marked no-show after its start time");
      const ts = this.now().toISOString();
      await tx.run("UPDATE appointments SET status = ?, status_changed_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?", status, ts, ts, tenantId, id);
      return toRow({ ...r, status });
    });
  }

  async cancel(tenantId: string, staff: StaffPrincipal, id: string, reason: string): Promise<DeskRow> {
    const r = await this.load(tenantId, staff, id);
    if (r.status !== "confirmed" && r.status !== "cancelled") throw new StaffError("conflict", "Only an upcoming appointment can be cancelled");
    try { await this.source.cancel(tenantId, id, { reason: (reason ?? "").slice(0, 200), by: "staff" }); } catch (e) { if (e instanceof BookingNotFoundError) throw new StaffError("not_found", "Not found"); throw e; }
    return this.get(tenantId, staff, id);
  }

  async reschedule(tenantId: string, staff: StaffPrincipal, id: string, slotId: string): Promise<DeskRow> {
    await this.load(tenantId, staff, id);
    try { await this.source.reschedule(tenantId, id, slotId, { by: "staff" }); }
    catch (e) { if (e instanceof SlotTakenError) throw new StaffError("conflict", "That time is no longer available"); if (e instanceof BookingNotFoundError) throw new StaffError("not_found", "Not found"); throw e; }
    return this.get(tenantId, staff, id);
  }

  /** Open times for the booking form. Staff see the same engine as patients, without any patient-specific filter. */
  slots(tenantId: string, staff: StaffPrincipal, q: { clinicId: string; serviceId: string; providerId: string }) {
    if (staff.role === "provider" && q.providerId !== staff.providerId) throw new StaffError("forbidden", "Not allowed");
    return this.source.listSlots({ tenantId, ...q });
  }

  /** Book a phone or walk-in patient who has no account. Same safety rules as self-service; the staff member attests the screening was read and verbal consent given. */
  async book(tenantId: string, staff: StaffPrincipal, b: Record<string, any>): Promise<DeskRow> {
    if (staff.role === "provider") throw new StaffError("forbidden", "Providers can't book on behalf of patients");
    const ids = [b.clinicId, b.serviceId, b.providerId].map((x) => Id.safeParse(x));
    if (ids.some((x) => !x.success) || typeof b.slotId !== "string" || !/^[A-Za-z0-9:_-]{1,120}$/.test(b.slotId)) throw new StaffError("invalid_input", "Choose a clinic, visit type, provider and time");
    const pt = b.patient ?? {}; const fields: Record<string, string> = {};
    const first = String(pt.firstName ?? "").trim(), last = String(pt.lastName ?? "").trim();
    if (!first || first.length > 80) fields.firstName = "Enter a first name"; if (!last || last.length > 80) fields.lastName = "Enter a last name";
    const phone = pt.phone ? String(pt.phone).trim() : "", email = pt.email ? String(pt.email).trim().toLowerCase() : "";
    if (phone && !phoneOk(phone)) fields.phone = "Enter a valid phone number"; if (email && !emailOk(email)) fields.email = "Enter a valid email address";
    if (!phone && !email) fields.phone = "Enter a phone number or an email so we can reach the patient";
    const dob = pt.dateOfBirth ? String(pt.dateOfBirth) : "";
    if (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob)) || Date.parse(dob) > this.now().getTime())) fields.dateOfBirth = "Enter a valid date of birth";
    if (b.patientState !== undefined && b.patientState !== "" && !StateCode.safeParse(b.patientState).success) fields.patientState = "Enter a two-letter state code";
    if (Object.keys(fields).length) throw new StaffError("invalid_input", Object.values(fields)[0]!, fields);

    const req = {
      clinicId: ids[0]!.data as string, serviceId: ids[1]!.data as string, providerId: ids[2]!.data as string, slotId: b.slotId as string, confirmed: true as const,
      ...(typeof b.reason === "string" ? { reason: b.reason } : {}), ...(Array.isArray(b.redFlags) ? { redFlags: b.redFlags.map(String) } : {}),
      ...(b.modality === "in_person" || b.modality === "telehealth" ? { modality: b.modality } : {}), ...(b.patientState ? { patientState: String(b.patientState) } : {}),
      ...(b.interpreterLanguage ? { interpreterLanguage: String(b.interpreterLanguage) } : {}), ...(b.accommodations ? { accommodations: String(b.accommodations) } : {}),
      ...(b.referralRef ? { referralRef: String(b.referralRef) } : {}), consentAttested: b.consentAttested === true,
    };
    let decision;
    try { decision = await this.intake.prepareForStaff(tenantId, { firstName: first, lastName: last, ...(dob ? { dateOfBirth: dob } : {}) }, req as any); }
    catch (e) { if (e instanceof IntakeError) throw new StaffError(e.code === "emergency_redirect" ? "conflict" : "invalid_input", e.message, { [e.code]: e.message }); throw e; }
    try {
      const rec = await this.source.reserve({
        tenantId, clinicId: req.clinicId, serviceId: req.serviceId, providerId: req.providerId, slotId: req.slotId, idempotencyKey: `staff-${randomUUID()}`,
        patient: { firstName: first, lastName: last, ...(email ? { email } : {}), ...(phone ? { phone } : {}) }, intake: decision, bookedBy: "staff", staffId: staff.id,
        ...(dob ? { patientDob: dob } : {}), smsOk: b.smsOk === true,
      });
      return this.get(tenantId, staff, rec.bookingId);
    } catch (e) { if (e instanceof SlotTakenError) throw new StaffError("conflict", "That time is no longer available"); throw e; }
  }

  async range(tenantId: string, staff: StaffPrincipal, from: string, to: string): Promise<DeskRow[]> {
    if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))) || Date.parse(to) < Date.parse(from)) throw new StaffError("invalid_input", "from and to must be dates (YYYY-MM-DD)");
    if (Date.parse(to) - Date.parse(from) > 92 * 86_400_000) throw new StaffError("invalid_input", "Choose a range of at most 92 days");
    const sc = this.scope(staff);
    return (await this.db.all<DbRow>(`${SELECT} WHERE a.tenant_id = ? AND a.starts_at >= ? AND a.starts_at < ?${sc.sql} ORDER BY a.starts_at, a.id`,
      tenantId, new Date(Date.parse(from) - 86_400_000).toISOString(), new Date(Date.parse(to) + 2 * 86_400_000).toISOString(), ...sc.params)).filter((r) => {
      const l = localParts(new Date(r.starts_at), r.time_zone); const d = `${l.year}-${String(l.month).padStart(2, "0")}-${String(l.day).padStart(2, "0")}`; return d >= from && d <= to;
    }).map(toRow);
  }
}

/** Spreadsheet-safe CSV: values that start with = + - @ or a tab/CR are prefixed with an apostrophe so they can't run as formulas. */
export function toCsv(rows: DeskRow[]): string {
  const cell = (v: unknown) => { let s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["Reference", "Date", "Start", "End", "Time zone", "Clinic", "Visit", "Provider", "Patient", "Phone", "Email", "Status", "Format", "Copay", "Booked by", "Late cancel"];
  const when = (iso: string, tz: string) => { const l = localParts(new Date(iso), tz); const p = (n: number) => String(n).padStart(2, "0"); return { d: `${l.year}-${p(l.month)}-${p(l.day)}`, t: `${p(Math.floor(l.minuteOfDay / 60))}:${p(l.minuteOfDay % 60)}` }; };
  return [head, ...rows.map((r) => { const s = when(r.startsAt, r.timeZone), e = when(r.endsAt, r.timeZone); return [r.id, s.d, s.t, e.t, r.timeZone, r.clinicName, r.visitLabel, r.providerName, r.patientName, r.phone, r.email, r.status, r.modality, (r.copayCents / 100).toFixed(2), r.bookedBy, r.lateCancel ? "yes" : ""]; })]
    .map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** FHIR R4 Appointment bundle (minimal profile: no identifiers beyond display names and the CareX reference). */
export function toFhir(rows: DeskRow[], baseUrl: string) {
  const status = { confirmed: "booked", arrived: "arrived", completed: "fulfilled", no_show: "noshow", cancelled: "cancelled" } as const;
  return {
    resourceType: "Bundle", type: "searchset", total: rows.length,
    entry: rows.map((r) => ({
      fullUrl: `${baseUrl.replace(/\/$/, "")}/Appointment/${r.id}`,
      resource: {
        resourceType: "Appointment", id: r.id, identifier: [{ system: "urn:carex:appointment-reference", value: r.id }],
        status: status[r.status as keyof typeof status] ?? "booked", start: r.startsAt, end: r.endsAt,
        minutesDuration: Math.round((Date.parse(r.endsAt) - Date.parse(r.startsAt)) / 60_000),
        serviceType: [{ text: r.visitLabel }], appointmentType: { text: r.modality === "telehealth" ? "Video visit" : "In person" },
        ...(r.reason ? { reasonCode: [{ text: r.reason }] } : {}), ...(r.cancelReason ? { cancelationReason: { text: r.cancelReason } } : {}),
        participant: [
          { actor: { display: r.patientName, type: "Patient" }, status: "accepted" },
          { actor: { display: r.providerName, type: "Practitioner" }, status: "accepted" },
          { actor: { display: r.clinicName, type: "Location" }, status: "accepted" },
        ],
      },
    })),
  };
}
