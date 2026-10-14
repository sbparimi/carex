import type { Patient, Slot } from "@carex/contracts";

export class SlotTakenError extends Error {}
export class SchedulingTimeoutError extends Error {}
export class SchedulingUnavailableError extends Error {}

export interface ReserveInput {
  tenantId: string; clinicId: string; serviceId: string; providerId: string; slotId: string;
  idempotencyKey: string; patient: Patient;
}
export interface BookingRecord { bookingId: string; tenantId: string; slotId: string; idempotencyKey: string; startsAt: string; endsAt: string }

/** The system of record. The booking service never reports success unless `reserve` resolves. */
export interface SchedulingSource {
  listSlots(q: { tenantId: string; clinicId: string; serviceId: string; providerId: string }): Promise<Slot[]>;
  /** Atomic: either the slot is reserved for this key or an error is thrown. Same key twice => same booking. */
  reserve(input: ReserveInput): Promise<BookingRecord>;
  lookupByKey(tenantId: string, idempotencyKey: string): Promise<BookingRecord | undefined>;
}

/** Slot ids embed their start time: `<tenant>:<provider>:<yyyymmddThhmm>` (UTC). */
function slotWindow(slotId: string): { startsAt: string; endsAt: string } {
  const iso = slotId.split(":").pop()!;
  const startsAt = `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6, 8)}T${iso.slice(9, 11)}:${iso.slice(11, 13)}:00.000Z`;
  return { startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString() };
}

export type Fault = "unavailable" | "timeout_before_commit" | "timeout_after_commit";

/** In-memory stand-in for a real scheduling/EHR integration (an open PRD decision). Supports fault injection for tests. */
export class MockScheduling implements SchedulingSource {
  private booked = new Map<string, BookingRecord>();       // slotId -> booking
  private byKey = new Map<string, BookingRecord>();        // tenant:key -> booking
  private faults: Fault[] = [];
  private seq = 0;
  constructor(private clock: () => Date = () => new Date(), private latencyMs = 0) {}

  injectFault(f: Fault) { this.faults.push(f); }
  get bookingCount() { return this.byKey.size; }

  async listSlots(q: { tenantId: string; clinicId: string; serviceId: string; providerId: string }): Promise<Slot[]> {
    await this.delay();
    const base = new Date(this.clock()); base.setUTCHours(0, 0, 0, 0);
    const out: Slot[] = [];
    for (let d = 1; d <= 3; d++) for (const [h, m] of [[17, 0], [17, 30], [18, 0]] as const) {
      const start = new Date(base.getTime() + d * 86_400_000 + (h * 60 + m) * 60_000);
      const id = `${q.tenantId}:${q.providerId}:${start.toISOString().slice(0, 16).replace(/[-:]/g, "")}`;
      if (this.booked.has(id)) continue;
      out.push({ id, providerId: q.providerId, clinicId: q.clinicId, serviceId: q.serviceId, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(), timeZone: "UTC" });
    }
    return out;
  }

  async reserve(i: ReserveInput): Promise<BookingRecord> {
    await this.delay();
    const fault = this.faults.shift();
    if (fault === "unavailable") throw new SchedulingUnavailableError("scheduling source unavailable");
    if (fault === "timeout_before_commit") throw new SchedulingTimeoutError("timed out before commit");
    const existing = this.byKey.get(`${i.tenantId}:${i.idempotencyKey}`);
    if (existing) return existing;                                   // duplicate submit: same booking, never a second one
    if (!i.slotId.startsWith(`${i.tenantId}:`)) throw new SlotTakenError("slot not found for tenant");
    if (this.booked.has(i.slotId)) throw new SlotTakenError("slot already booked");
    const rec: BookingRecord = { bookingId: `bk-${++this.seq}`, tenantId: i.tenantId, slotId: i.slotId, idempotencyKey: i.idempotencyKey, ...slotWindow(i.slotId) };
    this.booked.set(i.slotId, rec); this.byKey.set(`${i.tenantId}:${i.idempotencyKey}`, rec);
    if (fault === "timeout_after_commit") throw new SchedulingTimeoutError("timed out after commit (outcome unknown to caller)");
    return rec;
  }

  async lookupByKey(tenantId: string, key: string) { await this.delay(); return this.byKey.get(`${tenantId}:${key}`); }
  private delay() { return this.latencyMs ? new Promise((r) => setTimeout(r, this.latencyMs)) : Promise.resolve(); }
}
