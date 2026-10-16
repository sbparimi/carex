import { createHash, randomBytes } from "node:crypto";

/** Patient-facing booking reference, e.g. CX-7K3M-9PQ2. Crockford base32 (no I, L, O, U), 40 random bits. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function bookingReference(): string {
  const b = randomBytes(8); let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[b[i]! & 31];
  return `CX-${out.slice(0, 4)}-${out.slice(4)}`;
}
import type { Slot } from "@carex/contracts";
import { isUniqueViolation, type Db } from "./db.js";
import { BookingNotFoundError, ChangeWindowClosedError, IdempotencyConflictError, SlotTakenError, type BookingRecord, type ManagedBooking, type ReserveInput, type SchedulingSource } from "./scheduling.js";
import { enqueue, enqueueReminders, skipPendingReminders } from "./notify.js";
import { markBooked, notifyOpening } from "./waitlist.js";
import { localParts, zonedTimeToUtc } from "./zoned.js";

type Query = { tenantId: string; clinicId: string; serviceId: string; providerId: string; userId?: string; patientId?: string };
type ApptStatus = "confirmed" | "cancelled" | "arrived" | "completed" | "no_show";
interface Candidate { slot: Slot; resourceId: string | null }
interface VisitRules { duration_min: number; min_lead_minutes: number | null; horizon_days: number | null; buffer_before_min: number; buffer_after_min: number; min_age: number | null; max_age: number | null; new_patients: "any" | "new_only" | "established_only"; resource_kind: string | null }
type Range = { start: number; end: number };
interface ApptRow { id: string; tenant_id: string; provider_id: string; starts_at: string; ends_at: string; idempotency_key: string; request_hash: string; status: ApptStatus }
interface ManageRow { modality?: "in_person" | "telehealth"; join_url?: string | null; copay_cents?: number; patient_first_name?: string; patient_last_name?: string; reason?: string | null; user_id?: string | null; id: string; tenant_id: string; clinic_id: string; visit_type_id: string; provider_id: string; starts_at: string; ends_at: string; status: ApptStatus }

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

function slotIdFor(tenantId: string, providerId: string, startMs: number): string {
  const d = new Date(startMs);
  return `${tenantId}:${providerId}:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/** CareX-native scheduling engine on PostgreSQL (ADR-002, ADR-005). Every query is bound-parameter and tenant-scoped. */
export class DbScheduling implements SchedulingSource {
  private readonly now: () => Date;
  private readonly horizonDays: number;
  private readonly minLeadMinutes: number;
  private readonly minChangeNoticeMinutes: number;

  constructor(private readonly db: Db, opts: { now?: () => Date; horizonDays?: number; minLeadMinutes?: number; minChangeNoticeMinutes?: number } = {}) {
    this.now = opts.now ?? (() => new Date());
    this.horizonDays = opts.horizonDays ?? 14;
    this.minLeadMinutes = opts.minLeadMinutes ?? 60;
    this.minChangeNoticeMinutes = opts.minChangeNoticeMinutes ?? 120;
  }

  async listSlots(q: Query): Promise<Slot[]> {
    return (await this.candidates(this.db, q)).map((c) => c.slot);
  }

  async reserve(input: ReserveInput): Promise<BookingRecord> {
    const hash = requestHash(input);
    try { return await this.reserveOnce(input, hash); }
    catch (e) {
      // Two requests with the same key raced past the check: the loser re-reads and replays the winner's result.
      if (isUniqueViolation(e, "appointments_idem")) {
        const row = await this.findByKey(this.db, input.tenantId, input.idempotencyKey);
        if (row && row.request_hash === hash) return toRecord(row);
        if (row) throw new IdempotencyConflictError("Idempotency-Key was reused for a different request");
      }
      throw e;
    }
  }

  private reserveOnce(input: ReserveInput, hash: string): Promise<BookingRecord> {
    return this.db.tx(async (tx) => {
      const existing = await this.findByKey(tx, input.tenantId, input.idempotencyKey);
      if (existing) {
        if (existing.request_hash !== hash) throw new IdempotencyConflictError("Idempotency-Key was reused for a different request");
        return toRecord(existing);
      }
      // Serialise writers per provider so overlapping (not just identical) slots can never both commit.
      await tx.get("SELECT pg_advisory_xact_lock(hashtext(?))", `${input.tenantId}:${input.providerId}`);
      const cand = (await this.candidates(tx, { ...input, ...(input.intake ? { patientId: input.intake.patientId } : {}), requireUser: true })).find((c) => c.slot.id === input.slotId);
      if (!cand) throw new SlotTakenError("Slot is not available");
      const slot = cand.slot;
      const id = bookingReference();
      const p = input.patient; const it = input.intake;
      try {
        await tx.run(
          `INSERT INTO appointments (id, tenant_id, clinic_id, visit_type_id, provider_id, starts_at, ends_at, status, idempotency_key, request_hash,
             patient_first_name, patient_last_name, patient_email, patient_phone, created_at, user_id, resource_id,
             patient_id, reason, modality, patient_state, interpreter_language, accommodations, referral_ref, copay_cents, join_url)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, input.tenantId, input.clinicId, input.serviceId, input.providerId, slot.startsAt, slot.endsAt, "confirmed",
          input.idempotencyKey, hash, p.firstName, p.lastName, p.email ?? null, p.phone ?? null, this.now().toISOString(), input.userId ?? null, cand.resourceId,
          it?.patientId ?? null, it?.reason ?? null, it?.modality ?? "in_person", it?.patientState ?? null, it?.interpreterLanguage ?? null, it?.accommodations ?? null, it?.referralRef ?? null, it?.copayCents ?? 0,
          it && it.modality === "telehealth" && it.videoJoinBase ? `${it.videoJoinBase.replace(/\/+$/, "")}/${id}` : null);
        if (it?.consentVersion && input.userId) {
          await tx.run("INSERT INTO consent_records (tenant_id, user_id, patient_id, kind, version, accepted_at, appointment_id) VALUES (?,?,?,?,?,?,?)",
            input.tenantId, input.userId, it.patientId, "treatment", it.consentVersion, this.now().toISOString(), id);
        }
      } catch (e) {
        if (isUniqueViolation(e, "appointments_slot") || isUniqueViolation(e, "appointments_resource_slot")) throw new SlotTakenError("Slot is not available");
        throw e;
      }
      if (input.userId) {
        const now = this.now();
        await enqueue(tx, now, { tenantId: input.tenantId, kind: "confirmation", appointmentId: id, userId: input.userId, dedupe: `confirmation:${id}` });
        await enqueueReminders(tx, now, { tenantId: input.tenantId, appointmentId: id, userId: input.userId, startsAt: slot.startsAt });
        await markBooked(tx, input.tenantId, input.userId, input.clinicId, input.serviceId);
      }
      return { bookingId: id, tenantId: input.tenantId, slotId: input.slotId, idempotencyKey: input.idempotencyKey, startsAt: slot.startsAt, endsAt: slot.endsAt, status: "confirmed" };
    });
  }

  async lookupByKey(tenantId: string, idempotencyKey: string): Promise<BookingRecord | undefined> {
    const row = await this.findByKey(this.db, tenantId, idempotencyKey);
    return row ? toRecord(row) : undefined;
  }

  async getBooking(tenantId: string, bookingId: string): Promise<ManagedBooking | undefined> {
    const row = await this.findManaged(this.db, tenantId, bookingId);
    return row ? toManaged(row) : undefined;
  }

  /** The bookings of one account, soonest first. Never returns another user's rows. */
  async listForUser(tenantId: string, userId: string): Promise<ManagedBooking[]> {
    const rows = await this.db.all<ManageRow>(
      "SELECT id, tenant_id, clinic_id, visit_type_id, provider_id, starts_at, ends_at, status, user_id, modality, join_url, copay_cents, patient_first_name, patient_last_name, reason FROM appointments WHERE tenant_id = ? AND user_id = ? ORDER BY starts_at, id",
      tenantId, userId);
    return rows.map(toManaged);
  }

  async cancel(tenantId: string, bookingId: string, opts: { reason?: string; by?: "patient" | "staff" } = {}): Promise<ManagedBooking> {
    return this.db.tx(async (tx) => {
      const row = await this.findManaged(tx, tenantId, bookingId, true);
      if (!row) throw new BookingNotFoundError("Booking not found");
      if (row.status === "cancelled") return toManaged(row);
      if (opts.by !== "staff") this.assertChangeAllowed(row);
      const nowD = this.now(); const ts = nowD.toISOString();
      const pol = await tx.get<{ late_cancel_hours: number }>("SELECT late_cancel_hours FROM tenants WHERE id = ?", tenantId);
      const late = Date.parse(row.starts_at) - nowD.getTime() < (pol?.late_cancel_hours ?? 24) * 3_600_000 ? 1 : 0;
      await tx.run("UPDATE appointments SET status = 'cancelled', cancelled_at = ?, updated_at = ?, cancel_reason = ?, cancelled_by = ?, late_cancel = ? WHERE id = ? AND tenant_id = ?",
        ts, ts, (opts.reason ?? "").slice(0, 200) || null, opts.by ?? "patient", late, bookingId, tenantId);
      await skipPendingReminders(tx, bookingId);
      if (row.user_id) await enqueue(tx, nowD, { tenantId, kind: "cancellation", appointmentId: bookingId, userId: row.user_id, dedupe: `cancellation:${bookingId}` });
      await notifyOpening(tx, nowD, { tenantId, clinicId: row.clinic_id, serviceId: row.visit_type_id, providerId: row.provider_id, startsAt: row.starts_at });
      return toManaged({ ...row, status: "cancelled" });
    });
  }

  async reschedule(tenantId: string, bookingId: string, newSlotId: string): Promise<ManagedBooking> {
    return this.db.tx(async (tx) => {
      const row = await this.findManaged(tx, tenantId, bookingId, true);
      if (!row || row.status !== "confirmed") throw new BookingNotFoundError("Booking not found");
      this.assertChangeAllowed(row);
      await tx.get("SELECT pg_advisory_xact_lock(hashtext(?))", `${tenantId}:${row.provider_id}`);
      const cand = (await this.candidates(tx, { tenantId, clinicId: row.clinic_id, serviceId: row.visit_type_id, providerId: row.provider_id, ...(row.user_id ? { userId: row.user_id } : {}), requireUser: false }, row.id)).find((c) => c.slot.id === newSlotId);
      if (!cand) throw new SlotTakenError("Slot is not available");
      const slot = cand.slot;
      if (slot.startsAt === row.starts_at) return toManaged(row);
      try {
        await tx.run("UPDATE appointments SET starts_at = ?, ends_at = ?, resource_id = ?, updated_at = ?, reschedule_count = reschedule_count + 1 WHERE id = ? AND tenant_id = ?",
          slot.startsAt, slot.endsAt, cand.resourceId, this.now().toISOString(), bookingId, tenantId);
      } catch (e) {
        if (isUniqueViolation(e, "appointments_slot") || isUniqueViolation(e, "appointments_resource_slot")) throw new SlotTakenError("Slot is not available");
        throw e;
      }
      const nowD = this.now();
      await skipPendingReminders(tx, bookingId);
      if (row.user_id) {
        await enqueue(tx, nowD, { tenantId, kind: "rescheduled", appointmentId: bookingId, userId: row.user_id, dedupe: `rescheduled:${bookingId}:${slot.startsAt}` });
        await enqueueReminders(tx, nowD, { tenantId, appointmentId: bookingId, userId: row.user_id, startsAt: slot.startsAt });
      }
      await notifyOpening(tx, nowD, { tenantId, clinicId: row.clinic_id, serviceId: row.visit_type_id, providerId: row.provider_id, startsAt: row.starts_at });
      return toManaged({ ...row, starts_at: slot.startsAt, ends_at: slot.endsAt });
    });
  }

  private assertChangeAllowed(row: ManageRow): void {
    if (Date.parse(row.starts_at) - this.now().getTime() < this.minChangeNoticeMinutes * MINUTE_MS) throw new ChangeWindowClosedError("Too close to the appointment time to change it online");
  }

  private findManaged(db: Db, tenantId: string, bookingId: string, lock = false): Promise<ManageRow | undefined> {
    return db.get<ManageRow>(
      `SELECT id, tenant_id, clinic_id, visit_type_id, provider_id, starts_at, ends_at, status, user_id, modality, join_url, copay_cents, patient_first_name, patient_last_name, reason FROM appointments WHERE tenant_id = ? AND id = ?${lock ? " FOR UPDATE" : ""}`,
      tenantId, bookingId);
  }

  private findByKey(db: Db, tenantId: string, key: string): Promise<ApptRow | undefined> {
    return db.get<ApptRow>(
      "SELECT id, tenant_id, provider_id, starts_at, ends_at, idempotency_key, request_hash, status FROM appointments WHERE tenant_id = ? AND idempotency_key = ?",
      tenantId, key);
  }

  /**
   * The bookable candidates for (tenant, clinic, service, provider), each with the room/resource it would hold.
   * Rules: per-visit lead and horizon, working hours minus time off, clinic closures, other appointments and
   * visit buffers, resource availability, and (when a signed-in user is known) age and new/established limits.
   */
  private async candidates(db: Db, q: Query & { requireUser?: boolean }, excludeBookingId?: string): Promise<Candidate[]> {
    const clinic = await db.get<{ time_zone: string }>("SELECT time_zone FROM clinics WHERE id = ? AND tenant_id = ? AND status = 'active' AND bookable = 1", q.clinicId, q.tenantId);
    const visit = await db.get<VisitRules>(
      `SELECT duration_min, min_lead_minutes, horizon_days, buffer_before_min, buffer_after_min, min_age, max_age, new_patients, resource_kind
         FROM visit_types WHERE id = ? AND tenant_id = ? AND status = 'active'`, q.serviceId, q.tenantId);
    if (!clinic || !visit) return [];
    const provider = await db.get("SELECT 1 AS ok FROM providers WHERE id = ? AND tenant_id = ? AND status = 'active'", q.providerId, q.tenantId);
    const offered = await db.get("SELECT 1 AS ok FROM clinic_visit_types WHERE tenant_id = ? AND clinic_id = ? AND visit_type_id = ? AND active = 1", q.tenantId, q.clinicId, q.serviceId);
    const eligible = await db.get("SELECT 1 AS ok FROM provider_eligibility WHERE tenant_id = ? AND clinic_id = ? AND visit_type_id = ? AND provider_id = ? AND active = 1", q.tenantId, q.clinicId, q.serviceId, q.providerId);
    if (!provider || !offered || !eligible) return [];
    if (!(await this.patientMayBook(db, q, visit))) return [];

    const rules = await db.all<{ weekday: number; start_minute: number; end_minute: number }>("SELECT weekday, start_minute, end_minute FROM availability_rules WHERE tenant_id = ? AND provider_id = ? AND clinic_id = ?",
      q.tenantId, q.providerId, q.clinicId);
    if (rules.length === 0) return [];

    const horizon = visit.horizon_days ?? this.horizonDays;
    const nowMs = this.now().getTime();
    const earliest = nowMs + (visit.min_lead_minutes ?? this.minLeadMinutes) * MINUTE_MS;
    const latest = nowMs + horizon * DAY_MS;
    const durMs = visit.duration_min * MINUTE_MS;
    const before = visit.buffer_before_min * MINUTE_MS;
    const after = visit.buffer_after_min * MINUTE_MS;

    // Provider obstacles: [start, end] raw interval plus the buffered interval a neighbour needs around it.
    const obstacles: { raw: Range; padded: Range }[] = [];
    for (const r of await db.all<{ starts_at: string; ends_at: string; bb: number; ba: number }>(
      `SELECT a.starts_at, a.ends_at, v.buffer_before_min AS bb, v.buffer_after_min AS ba FROM appointments a JOIN visit_types v ON v.id = a.visit_type_id
        WHERE a.tenant_id = ? AND a.provider_id = ? AND a.status <> 'cancelled' AND a.id <> ?`, q.tenantId, q.providerId, excludeBookingId ?? "")) {
      const raw = { start: Date.parse(r.starts_at), end: Date.parse(r.ends_at) };
      obstacles.push({ raw, padded: { start: raw.start - r.bb * MINUTE_MS, end: raw.end + r.ba * MINUTE_MS } });
    }
    const blocks: Range[] = [];
    for (const r of await db.all<{ starts_at: string; ends_at: string }>("SELECT starts_at, ends_at FROM time_off WHERE tenant_id = ? AND provider_id = ?", q.tenantId, q.providerId)) blocks.push({ start: Date.parse(r.starts_at), end: Date.parse(r.ends_at) });
    for (const r of await db.all<{ starts_at: string; ends_at: string }>("SELECT starts_at, ends_at FROM clinic_closures WHERE tenant_id = ? AND clinic_id = ?", q.tenantId, q.clinicId)) blocks.push({ start: Date.parse(r.starts_at), end: Date.parse(r.ends_at) });

    // Resources of the required kind, each with its own busy list.
    const resources: { id: string; busy: Range[] }[] = [];
    if (visit.resource_kind) {
      for (const r of await db.all<{ id: string }>("SELECT id FROM clinic_resources WHERE tenant_id = ? AND clinic_id = ? AND kind = ? AND active = 1 ORDER BY id", q.tenantId, q.clinicId, visit.resource_kind)) {
        const busy = (await db.all<{ starts_at: string; ends_at: string }>("SELECT starts_at, ends_at FROM appointments WHERE tenant_id = ? AND resource_id = ? AND status <> 'cancelled' AND id <> ?", q.tenantId, r.id, excludeBookingId ?? ""))
          .map((b) => ({ start: Date.parse(b.starts_at), end: Date.parse(b.ends_at) }));
        resources.push({ id: r.id, busy });
      }
      if (resources.length === 0) return [];
    }

    const today = localParts(new Date(nowMs), clinic.time_zone);
    const byStart = new Map<number, Candidate>();
    for (let i = 0; i <= horizon + 1; i++) {
      const day = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
      const weekday = day.getUTCDay();
      for (const rule of rules) {
        if (rule.weekday !== weekday) continue;
        for (let m = rule.start_minute; m + visit.duration_min <= rule.end_minute; m += visit.duration_min) {
          const start = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), m, clinic.time_zone);
          if (!start) continue;
          const s = start.getTime();
          const e = s + durMs;
          if (s < earliest || s >= latest || byStart.has(s)) continue;
          if (blocks.some((b) => s < b.end && e > b.start)) continue;
          const padded = { start: s - before, end: e + after };
          if (obstacles.some((o) => (s < o.padded.end && e > o.padded.start) || (padded.start < o.raw.end && padded.end > o.raw.start))) continue;
          let resourceId: string | null = null;
          if (visit.resource_kind) {
            const free = resources.find((r) => !r.busy.some((b) => s < b.end && e > b.start));
            if (!free) continue;
            resourceId = free.id;
          }
          byStart.set(s, { resourceId, slot: {
            id: slotIdFor(q.tenantId, q.providerId, s), providerId: q.providerId, clinicId: q.clinicId, serviceId: q.serviceId,
            startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString(), timeZone: clinic.time_zone,
          } });
        }
      }
    }
    return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  }

  /** Age and new/established limits. With no signed-in user the listing is shown unfiltered, but a booking (requireUser) is refused. */
  private async patientMayBook(db: Db, q: Query & { requireUser?: boolean }, v: VisitRules): Promise<boolean> {
    const restricted = v.min_age !== null || v.max_age !== null || v.new_patients !== "any";
    if (!restricted) return true;
    if (!q.userId) return !q.requireUser;
    const u = q.patientId
      ? await db.get<{ date_of_birth: string }>("SELECT date_of_birth FROM patients WHERE id = ? AND tenant_id = ? AND user_id = ?", q.patientId, q.tenantId, q.userId)
      : await db.get<{ date_of_birth: string }>("SELECT date_of_birth FROM users WHERE id = ? AND tenant_id = ?", q.userId, q.tenantId);
    if (!u) return false;
    if (v.min_age !== null || v.max_age !== null) {
      const age = ageOn(u.date_of_birth, this.now());
      if (v.min_age !== null && age < v.min_age) return false;
      if (v.max_age !== null && age > v.max_age) return false;
    }
    if (v.new_patients !== "any") {
      const seen = q.patientId
        ? await db.get("SELECT 1 AS ok FROM appointments WHERE tenant_id = ? AND patient_id = ? AND status IN ('arrived','completed') LIMIT 1", q.tenantId, q.patientId)
        : await db.get("SELECT 1 AS ok FROM appointments WHERE tenant_id = ? AND user_id = ? AND status IN ('arrived','completed') LIMIT 1", q.tenantId, q.userId);
      if (v.new_patients === "new_only" && seen) return false;
      if (v.new_patients === "established_only" && !seen) return false;
    }
    return true;
  }
}

/** Whole years between an ISO date of birth and `now`. */
export function ageOn(dob: string, now: Date): number {
  const [y, m, d] = dob.slice(0, 10).split("-").map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age--;
  return age;
}

function toRecord(r: ApptRow): BookingRecord {
  return { bookingId: r.id, tenantId: r.tenant_id, slotId: slotIdFor(r.tenant_id, r.provider_id, Date.parse(r.starts_at)), idempotencyKey: r.idempotency_key, startsAt: r.starts_at, endsAt: r.ends_at, status: r.status };
}

function toManaged(r: ManageRow): ManagedBooking {
  return { bookingId: r.id, tenantId: r.tenant_id, clinicId: r.clinic_id, serviceId: r.visit_type_id, providerId: r.provider_id, startsAt: r.starts_at, endsAt: r.ends_at, status: r.status, ...(r.user_id ? { userId: r.user_id } : {}),
    ...(r.modality ? { modality: r.modality } : {}), ...(r.join_url ? { joinUrl: r.join_url } : {}), ...(r.copay_cents ? { copayCents: r.copay_cents } : {}),
    ...(r.patient_first_name ? { patientName: `${r.patient_first_name} ${r.patient_last_name ?? ""}`.trim() } : {}), ...(r.reason ? { reason: r.reason } : {}) };
}

function requestHash(i: ReserveInput): string {
  const p = i.patient;
  const canon = JSON.stringify([i.tenantId, i.userId ?? null, i.clinicId, i.serviceId, i.providerId, i.slotId, p.firstName, p.lastName, p.email ?? null, p.phone ?? null, i.intake ? [i.intake.patientId, i.intake.reason, i.intake.modality, i.intake.patientState, i.intake.referralRef] : null]);
  return createHash("sha256").update(canon).digest("hex");
}
