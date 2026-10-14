import { createHash, randomUUID } from "node:crypto";
import type { Slot } from "@carex/contracts";
import { inTransaction, type Db } from "./db.js";
import { IdempotencyConflictError, SlotTakenError, type BookingRecord, type ReserveInput, type SchedulingSource } from "./scheduling.js";
import { localParts, zonedTimeToUtc } from "./zoned.js";

type Query = { tenantId: string; clinicId: string; serviceId: string; providerId: string };
type Range = { start: number; end: number };
interface ApptRow { id: string; tenant_id: string; provider_id: string; starts_at: string; ends_at: string; idempotency_key: string; request_hash: string }

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

  constructor(private readonly db: Db, opts: { now?: () => Date; horizonDays?: number; minLeadMinutes?: number } = {}) {
    this.now = opts.now ?? (() => new Date());
    this.horizonDays = opts.horizonDays ?? 14;
    this.minLeadMinutes = opts.minLeadMinutes ?? 60;
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
      const id = randomUUID();
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
      return { bookingId: id, tenantId: input.tenantId, slotId: input.slotId, idempotencyKey: input.idempotencyKey, startsAt: slot.startsAt, endsAt: slot.endsAt };
    });
  }

  async lookupByKey(tenantId: string, idempotencyKey: string): Promise<BookingRecord | undefined> {
    const row = this.findByKey(tenantId, idempotencyKey);
    return row ? toRecord(row) : undefined;
  }

  private findByKey(tenantId: string, key: string): ApptRow | undefined {
    return this.db.prepare(
      "SELECT id, tenant_id, provider_id, starts_at, ends_at, idempotency_key, request_hash FROM appointments WHERE tenant_id = ? AND idempotency_key = ?",
    ).get(tenantId, key) as ApptRow | undefined;
  }

  /** The slots currently offered for (tenant, clinic, service, provider). */
  private derive(q: Query): Slot[] {
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
    for (const r of db.prepare("SELECT starts_at, ends_at FROM appointments WHERE tenant_id = ? AND provider_id = ? AND status = 'confirmed'").all(q.tenantId, q.providerId) as { starts_at: string; ends_at: string }[]) {
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
  return { bookingId: r.id, tenantId: r.tenant_id, slotId: slotIdFor(r.tenant_id, r.provider_id, Date.parse(r.starts_at)), idempotencyKey: r.idempotency_key, startsAt: r.starts_at, endsAt: r.ends_at };
}

function requestHash(i: ReserveInput): string {
  const p = i.patient;
  const canon = JSON.stringify([i.tenantId, i.clinicId, i.serviceId, i.providerId, i.slotId, p.firstName, p.lastName, p.email ?? null, p.phone ?? null]);
  return createHash("sha256").update(canon).digest("hex");
}
