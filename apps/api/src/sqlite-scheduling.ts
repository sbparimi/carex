import { createHash, randomBytes } from "node:crypto";

/** Patient-facing booking reference, e.g. CX-7K3M-9PQ2. Crockford base32 (no I, L, O, U), 40 random bits. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function bookingReference(): string {
  const b = randomBytes(8); let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[b[i]! & 31];
  return `CX-${out.slice(0, 4)}-${out.slice(4)}`;
}
import type { Slot } from "@carex/contracts";
import { inTransaction, type Db } from "./db.js";
import { BookingNotFoundError, ChangeWindowClosedError, IdempotencyConflictError, SlotTakenError, type BookingRecord, type ManagedBooking, type ReserveInput, type SchedulingSource } from "./scheduling.js";
import { localParts, zonedTimeToUtc } from "./zoned.js";

type Query = { tenantId: string; clinicId: string; serviceId: string; providerId: string };
type Range = { start: number; end: number };
interface ApptRow { id: string; tenant_id: string; provider_id: string; starts_at: string; ends_at: string; idempotency_key: string; request_hash: string; status: "confirmed" | "cancelled" }
interface ManageRow { id: string; tenant_id: string; clinic_id: string; visit_type_id: string; provider_id: string; starts_at: string; ends_at: string; status: "confirmed" | "cancelled" }

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

function slotIdFor(tenantId: string, providerId: string, startMs: number): string {
  const d = new Date(startMs);
  return `${tenantId}:${providerId}:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/** CareX-native scheduling engine on SQLite (ADR-002). Every query is bound-parameter and tenant-scoped. */
export class SqliteScheduling implements SchedulingSource {
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
    return this.derive(q);
  }

  async reserve(input: ReserveInput): Promise<BookingRecord> {
    const hash = requestHash(input);
    return inTransaction(this.db, () => {
      const existing = this.findByKey(input.tenantId, input.idempotencyKey);
      if (existing) {
        if (existing.request_hash !== hash) throw new IdempotencyConflictError("Idempotency-Key was reused for a different request");
        return toRecord(existing);
      }
      const slot = this.derive(input).find((s) => s.id === input.slotId);
      if (!slot) throw new SlotTakenError("Slot is not available");
      const id = bookingReference();
      const p = input.patient;
      try {
        this.db.prepare(
          `INSERT INTO appointments (id, tenant_id, clinic_id, visit_type_id, provider_id, starts_at, ends_at, status, idempotency_key, request_hash,
             patient_first_name, patient_last_name, patient_email, patient_phone, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(id, input.tenantId, input.clinicId, input.serviceId, input.providerId, slot.startsAt, slot.endsAt, "confirmed",
          input.idempotencyKey, hash, p.firstName, p.lastName, p.email ?? null, p.phone ?? null, this.now().toISOString());
      } catch (e) {
        if (/UNIQUE constraint failed: appointments\.provider_id/.test(String((e as Error).message))) throw new SlotTakenError("Slot is not available");
        throw e;
      }
      return { bookingId: id, tenantId: input.tenantId, slotId: input.slotId, idempotencyKey: input.idempotencyKey, startsAt: slot.startsAt, endsAt: slot.endsAt, status: "confirmed" };
    });
  }

  async lookupByKey(tenantId: string, idempotencyKey: string): Promise<BookingRecord | undefined> {
    const row = this.findByKey(tenantId, idempotencyKey);
    return row ? toRecord(row) : undefined;
  }

  async getBooking(tenantId: string, bookingId: string): Promise<ManagedBooking | undefined> {
    const row = this.findManaged(tenantId, bookingId);
    return row ? toManaged(row) : undefined;
  }

  async cancel(tenantId: string, bookingId: string): Promise<ManagedBooking> {
    return inTransaction(this.db, () => {
      const row = this.findManaged(tenantId, bookingId);
      if (!row) throw new BookingNotFoundError("Booking not found");
      if (row.status === "cancelled") return toManaged(row);
      this.assertChangeAllowed(row);
      const ts = this.now().toISOString();
      this.db.prepare("UPDATE appointments SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .run(ts, ts, bookingId, tenantId);
      return toManaged({ ...row, status: "cancelled" });
    });
  }

  async reschedule(tenantId: string, bookingId: string, newSlotId: string): Promise<ManagedBooking> {
    return inTransaction(this.db, () => {
      const row = this.findManaged(tenantId, bookingId);
      if (!row || row.status !== "confirmed") throw new BookingNotFoundError("Booking not found");
      this.assertChangeAllowed(row);
      const slot = this.derive({ tenantId, clinicId: row.clinic_id, serviceId: row.visit_type_id, providerId: row.provider_id }, row.id).find((s) => s.id === newSlotId);
      if (!slot) throw new SlotTakenError("Slot is not available");
      if (slot.startsAt === row.starts_at) return toManaged(row);
      try {
        this.db.prepare("UPDATE appointments SET starts_at = ?, ends_at = ?, updated_at = ?, reschedule_count = reschedule_count + 1 WHERE id = ? AND tenant_id = ?")
          .run(slot.startsAt, slot.endsAt, this.now().toISOString(), bookingId, tenantId);
      } catch (e) {
        if (/UNIQUE constraint failed: appointments\.provider_id/.test(String((e as Error).message))) throw new SlotTakenError("Slot is not available");
        throw e;
      }
      return toManaged({ ...row, starts_at: slot.startsAt, ends_at: slot.endsAt });
    });
  }

  private assertChangeAllowed(row: ManageRow): void {
    if (Date.parse(row.starts_at) - this.now().getTime() < this.minChangeNoticeMinutes * MINUTE_MS) throw new ChangeWindowClosedError("Too close to the appointment time to change it online");
  }

  private findManaged(tenantId: string, bookingId: string): ManageRow | undefined {
    return this.db.prepare(
      "SELECT id, tenant_id, clinic_id, visit_type_id, provider_id, starts_at, ends_at, status FROM appointments WHERE tenant_id = ? AND id = ?",
    ).get(tenantId, bookingId) as ManageRow | undefined;
  }

  private findByKey(tenantId: string, key: string): ApptRow | undefined {
    return this.db.prepare(
      "SELECT id, tenant_id, provider_id, starts_at, ends_at, idempotency_key, request_hash, status FROM appointments WHERE tenant_id = ? AND idempotency_key = ?",
    ).get(tenantId, key) as ApptRow | undefined;
  }

  /** The slots currently offered for (tenant, clinic, service, provider). */
  private derive(q: Query, excludeBookingId?: string): Slot[] {
    const { db } = this;
    const clinic = db.prepare("SELECT time_zone FROM clinics WHERE id = ? AND tenant_id = ? AND status = 'active' AND bookable = 1").get(q.clinicId, q.tenantId) as { time_zone: string } | undefined;
    const visit = db.prepare("SELECT duration_min FROM visit_types WHERE id = ? AND tenant_id = ? AND status = 'active'").get(q.serviceId, q.tenantId) as { duration_min: number } | undefined;
    if (!clinic || !visit) return [];
    const provider = db.prepare("SELECT 1 AS ok FROM providers WHERE id = ? AND tenant_id = ? AND status = 'active'").get(q.providerId, q.tenantId);
    const offered = db.prepare("SELECT 1 AS ok FROM clinic_visit_types WHERE tenant_id = ? AND clinic_id = ? AND visit_type_id = ? AND active = 1").get(q.tenantId, q.clinicId, q.serviceId);
    const eligible = db.prepare("SELECT 1 AS ok FROM provider_eligibility WHERE tenant_id = ? AND clinic_id = ? AND visit_type_id = ? AND provider_id = ? AND active = 1").get(q.tenantId, q.clinicId, q.serviceId, q.providerId);
    if (!provider || !offered || !eligible) return [];

    const rules = db.prepare("SELECT weekday, start_minute, end_minute FROM availability_rules WHERE tenant_id = ? AND provider_id = ? AND clinic_id = ?")
      .all(q.tenantId, q.providerId, q.clinicId) as { weekday: number; start_minute: number; end_minute: number }[];
    if (rules.length === 0) return [];

    const nowMs = this.now().getTime();
    const earliest = nowMs + this.minLeadMinutes * MINUTE_MS;
    const latest = nowMs + this.horizonDays * DAY_MS;
    const durMs = visit.duration_min * MINUTE_MS;

    const busy: Range[] = [];
    for (const r of db.prepare("SELECT starts_at, ends_at FROM appointments WHERE tenant_id = ? AND provider_id = ? AND status = 'confirmed' AND id <> ?").all(q.tenantId, q.providerId, excludeBookingId ?? "") as { starts_at: string; ends_at: string }[]) {
      busy.push({ start: Date.parse(r.starts_at), end: Date.parse(r.ends_at) });
    }
    for (const r of db.prepare("SELECT starts_at, ends_at FROM time_off WHERE tenant_id = ? AND provider_id = ?").all(q.tenantId, q.providerId) as { starts_at: string; ends_at: string }[]) {
      busy.push({ start: Date.parse(r.starts_at), end: Date.parse(r.ends_at) });
    }

    const today = localParts(new Date(nowMs), clinic.time_zone);
    const byStart = new Map<number, Slot>();
    for (let i = 0; i <= this.horizonDays + 1; i++) {
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
          if (busy.some((b) => s < b.end && e > b.start)) continue;
          byStart.set(s, {
            id: slotIdFor(q.tenantId, q.providerId, s), providerId: q.providerId, clinicId: q.clinicId, serviceId: q.serviceId,
            startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString(), timeZone: clinic.time_zone,
          });
        }
      }
    }
    return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  }
}

function toRecord(r: ApptRow): BookingRecord {
  return { bookingId: r.id, tenantId: r.tenant_id, slotId: slotIdFor(r.tenant_id, r.provider_id, Date.parse(r.starts_at)), idempotencyKey: r.idempotency_key, startsAt: r.starts_at, endsAt: r.ends_at, status: r.status };
}

function toManaged(r: ManageRow): ManagedBooking {
  return { bookingId: r.id, tenantId: r.tenant_id, clinicId: r.clinic_id, serviceId: r.visit_type_id, providerId: r.provider_id, startsAt: r.starts_at, endsAt: r.ends_at, status: r.status };
}

function requestHash(i: ReserveInput): string {
  const p = i.patient;
  const canon = JSON.stringify([i.tenantId, i.clinicId, i.serviceId, i.providerId, i.slotId, p.firstName, p.lastName, p.email ?? null, p.phone ?? null]);
  return createHash("sha256").update(canon).digest("hex");
}
