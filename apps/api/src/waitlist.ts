import type { Db } from "./db.js";
import { enqueue } from "./notify.js";

export class WaitlistError extends Error { constructor(public code: string, message: string) { super(message); } }
export interface WaitlistEntry { id: number; patientId: string | null; clinicId: string; serviceId: string; providerId: string | null; status: string; createdAt: string }
const MAX_ACTIVE = 10;
const NOTIFY_PER_OPENING = 3;

export class DbWaitlist {
  constructor(private db: Db, private now: () => Date = () => new Date()) {}

  async join(tenantId: string, userId: string, i: { clinicId: string; serviceId: string; providerId?: string; patientId?: string }): Promise<WaitlistEntry> {
    const ok = await this.db.get("SELECT 1 AS ok FROM clinic_visit_types cv JOIN clinics c ON c.id = cv.clinic_id AND c.tenant_id = cv.tenant_id AND c.status = 'active' AND c.bookable = 1 WHERE cv.tenant_id = ? AND cv.clinic_id = ? AND cv.visit_type_id = ? AND cv.active = 1", tenantId, i.clinicId, i.serviceId);
    if (!ok) throw new WaitlistError("not_found", "That visit isn't available at this clinic.");
    if (i.providerId && !(await this.db.get("SELECT 1 AS ok FROM provider_eligibility WHERE tenant_id = ? AND clinic_id = ? AND visit_type_id = ? AND provider_id = ? AND active = 1", tenantId, i.clinicId, i.serviceId, i.providerId)))
      throw new WaitlistError("not_found", "That provider doesn't see this visit type here.");
    if (i.patientId && !(await this.db.get("SELECT 1 AS ok FROM patients WHERE tenant_id = ? AND user_id = ? AND id = ?", tenantId, userId, i.patientId))) throw new WaitlistError("not_found", "We couldn't find that person on your account.");
    const dup = await this.db.get<Row>(`SELECT ${COLS} FROM waitlist WHERE tenant_id = ? AND user_id = ? AND clinic_id = ? AND visit_type_id = ? AND COALESCE(provider_id,'') = ? AND COALESCE(patient_id,'') = ? AND status IN ('active','notified')`,
      tenantId, userId, i.clinicId, i.serviceId, i.providerId ?? "", i.patientId ?? "");
    if (dup) return toEntry(dup);
    const n = await this.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM waitlist WHERE tenant_id = ? AND user_id = ? AND status IN ('active','notified')", tenantId, userId);
    if ((n?.n ?? 0) >= MAX_ACTIVE) throw new WaitlistError("too_many", "You can wait for up to 10 openings at a time.");
    const r = await this.db.run("INSERT INTO waitlist (tenant_id, user_id, patient_id, clinic_id, visit_type_id, provider_id, created_at) VALUES (?,?,?,?,?,?,?) RETURNING id", tenantId, userId, i.patientId ?? null, i.clinicId, i.serviceId, i.providerId ?? null, this.now().toISOString());
    const row = await this.db.get<Row>(`SELECT ${COLS} FROM waitlist WHERE id = ?`, r.rows[0].id);
    return toEntry(row!);
  }

  async list(tenantId: string, userId: string): Promise<(WaitlistEntry & { clinicName: string; visitLabel: string; providerName: string | null })[]> {
    const rows = await this.db.all<Row & { clinic_name: string; visit_label: string; provider_name: string | null }>(
      `SELECT w.id, w.patient_id, w.clinic_id, w.visit_type_id, w.provider_id, w.status, w.created_at, c.name AS clinic_name, v.label AS visit_label, p.display_name AS provider_name
         FROM waitlist w JOIN clinics c ON c.id = w.clinic_id JOIN visit_types v ON v.id = w.visit_type_id LEFT JOIN providers p ON p.id = w.provider_id
        WHERE w.tenant_id = ? AND w.user_id = ? AND w.status IN ('active','notified') ORDER BY w.created_at, w.id`, tenantId, userId);
    return rows.map((r) => ({ ...toEntry(r), clinicName: r.clinic_name, visitLabel: r.visit_label, providerName: r.provider_name }));
  }

  async leave(tenantId: string, userId: string, id: number): Promise<boolean> {
    const r = await this.db.run("UPDATE waitlist SET status = 'cancelled' WHERE tenant_id = ? AND user_id = ? AND id = ? AND status IN ('active','notified')", tenantId, userId, id);
    return r.changes > 0;
  }
}

/** Called inside the cancel/reschedule transaction when a time frees up: tells the longest-waiting people, once per opening. */
export async function notifyOpening(tx: Db, now: Date, o: { tenantId: string; clinicId: string; serviceId: string; providerId: string; startsAt: string }): Promise<void> {
  if (Date.parse(o.startsAt) <= now.getTime() + 60 * 60_000) return;           // too close to be bookable anyway
  const waiting = await tx.all<{ id: number; user_id: string }>(
    `SELECT id, user_id FROM waitlist WHERE tenant_id = ? AND clinic_id = ? AND visit_type_id = ? AND status = 'active' AND (provider_id IS NULL OR provider_id = ?)
      ORDER BY created_at, id LIMIT ?`, o.tenantId, o.clinicId, o.serviceId, o.providerId, NOTIFY_PER_OPENING);
  for (const w of waiting) {
    await enqueue(tx, now, { tenantId: o.tenantId, kind: "waitlist_open", userId: w.user_id, waitlistId: w.id, dedupe: `wl:${w.id}:${o.startsAt}` });
    await tx.run("UPDATE waitlist SET status = 'notified', notified_at = ? WHERE id = ?", now.toISOString(), w.id);
  }
}

/** Booking the same clinic and visit type satisfies the person's waitlist entries. */
export async function markBooked(tx: Db, tenantId: string, userId: string, clinicId: string, serviceId: string): Promise<void> {
  await tx.run("UPDATE waitlist SET status = 'booked' WHERE tenant_id = ? AND user_id = ? AND clinic_id = ? AND visit_type_id = ? AND status IN ('active','notified')", tenantId, userId, clinicId, serviceId);
}

interface Row { id: number; patient_id: string | null; clinic_id: string; visit_type_id: string; provider_id: string | null; status: string; created_at: string }
const COLS = "id, patient_id, clinic_id, visit_type_id, provider_id, status, created_at";
const toEntry = (r: Row): WaitlistEntry => ({ id: Number(r.id), patientId: r.patient_id, clinicId: r.clinic_id, serviceId: r.visit_type_id, providerId: r.provider_id, status: r.status, createdAt: r.created_at });
