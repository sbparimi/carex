import { createHash } from "node:crypto";
import { BookingRequest, type BookingOutcome, type ManagedAppointment, type RescheduleOutcome, type Slot } from "@carex/contracts";
import type { CatalogPort } from "./catalog.js";
import { BookingNotFoundError, ChangeWindowClosedError, SchedulingTimeoutError, SchedulingUnavailableError, SlotTakenError, type ManagedBooking, type SchedulingSource } from "./scheduling.js";

export class DomainError extends Error {
  constructor(public code: "not_found" | "invalid_request" | "idempotency_conflict" | "payload_too_large" | "change_window_closed" | "scheduling_unavailable", message: string) { super(message); }
}

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

/**
 * Booking integrity rules (PRD FR-008, BR-006..BR-009, §12):
 *  - eligibility chain re-checked server-side, scoped to the tenant
 *  - one booking per Idempotency-Key, including concurrent duplicates
 *  - "confirmed" only when the scheduling source resolves; timeouts become "pending" and are reconciled, never assumed
 */
export class BookingService {
  private inflight = new Map<string, { fingerprint: string; promise: Promise<BookingOutcome> }>();
  private settled = new Map<string, { fingerprint: string; outcome: BookingOutcome; req: BookingRequest }>();

  private notice: number; private now: () => Date;
  /** `changeNoticeMinutes` must match the scheduling engine's own rule; it only drives what the UI is told (the engine enforces it). */
  constructor(private catalog: CatalogPort, private source: SchedulingSource, opts: { now?: () => Date; changeNoticeMinutes?: number } = {}) {
    this.notice = opts.changeNoticeMinutes ?? 120; this.now = opts.now ?? (() => new Date());
  }

  // ---- managing an existing booking (view, cancel, reschedule). Authorisation (the manage token) is checked by the caller.
  async managed(tenantId: string, bookingId: string): Promise<ManagedAppointment | undefined> {
    const b = await this.source.getBooking(tenantId, bookingId);
    return b && this.toManaged(tenantId, b);
  }

  async cancel(tenantId: string, bookingId: string): Promise<ManagedAppointment> {
    try { return this.requireManaged(tenantId, await this.source.cancel(tenantId, bookingId)); }
    catch (e) { throw this.mapManageError(e); }
  }

  async reschedule(tenantId: string, bookingId: string, slotId: string): Promise<RescheduleOutcome> {
    try { return { status: "rescheduled", appointment: this.requireManaged(tenantId, await this.source.reschedule(tenantId, bookingId, slotId)) }; }
    catch (e) {
      if (e instanceof SlotTakenError) {
        const b = await this.source.getBooking(tenantId, bookingId).catch(() => undefined);
        const alternatives = b ? await this.source.listSlots({ tenantId, clinicId: b.clinicId, serviceId: b.serviceId, providerId: b.providerId }).catch(() => []) : [];
        return { status: "slot_unavailable", message: "That time is no longer available. Your current appointment is unchanged; please pick another time.", alternatives: alternatives.slice(0, 5) };
      }
      throw this.mapManageError(e);
    }
  }

  private toManaged(tenantId: string, b: ManagedBooking): ManagedAppointment | undefined {
    const d = this.catalog.describe(tenantId, b.clinicId, b.serviceId, b.providerId);
    if (!d) return undefined;
    const canChange = b.status === "confirmed" && Date.parse(b.startsAt) - this.now().getTime() >= this.notice * 60_000;
    return { bookingId: b.bookingId, status: b.status, summary: { ...d, startsAt: b.startsAt, endsAt: b.endsAt, timeZone: d.clinic.timeZone }, canChange, changeNoticeMinutes: this.notice };
  }
  private requireManaged(tenantId: string, b: ManagedBooking): ManagedAppointment {
    const m = this.toManaged(tenantId, b);
    if (!m) throw new DomainError("not_found", "not found");
    return m;
  }
  private mapManageError(e: unknown): unknown {
    if (e instanceof BookingNotFoundError) return new DomainError("not_found", "not found");
    if (e instanceof ChangeWindowClosedError) return new DomainError("change_window_closed", `Appointments can only be changed at least ${this.notice} minutes before they start. Please contact the clinic.`);
    if (e instanceof SchedulingUnavailableError || e instanceof SchedulingTimeoutError) return new DomainError("scheduling_unavailable", "Scheduling is temporarily unavailable. Nothing was changed.");
    return e;
  }

  async slots(tenantId: string, clinicId: string, serviceId: string, providerId: string): Promise<Slot[]> {
    if (!this.catalog.eligible(tenantId, clinicId, serviceId, providerId)) return [];
    return this.source.listSlots({ tenantId, clinicId, serviceId, providerId });
  }

  async create(tenantId: string, raw: unknown, idempotencyKey: string): Promise<BookingOutcome> {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(idempotencyKey)) throw new DomainError("invalid_request", "Idempotency-Key header is required (8-64 URL-safe characters)");
    const parsed = BookingRequest.safeParse(raw);
    if (!parsed.success) throw new DomainError("invalid_request", "invalid booking request");
    const req = parsed.data;
    const k = `${tenantId}:${idempotencyKey}`;
    const fingerprint = hash(req);

    const done = this.settled.get(k);
    if (done) {
      if (done.fingerprint !== fingerprint) throw new DomainError("idempotency_conflict", "this Idempotency-Key was used with a different request");
      if (done.outcome.status !== "pending") return done.outcome;           // replay returns the same result
      const r = await this.reconcile(tenantId, idempotencyKey);             // pending: ask the source of truth first
      if (r && r.status !== "pending") return r;
      this.settled.delete(k);                                               // source has no booking for this key: a retry is safe (the source dedupes by key)
    }
    const running = this.inflight.get(k);
    if (running) {
      if (running.fingerprint !== fingerprint) throw new DomainError("idempotency_conflict", "this Idempotency-Key was used with a different request");
      return running.promise;                                                // concurrent duplicate: share one attempt
    }
    const promise = this.attempt(tenantId, req, idempotencyKey).then((outcome) => {
      // Only outcomes that may already exist at the source are remembered. Failures and lost races are re-attemptable.
      if (outcome.status === "confirmed" || outcome.status === "pending") this.settled.set(k, { fingerprint, outcome, req });
      return outcome;
    }).finally(() => this.inflight.delete(k));
    this.inflight.set(k, { fingerprint, promise });
    return promise;
  }

  /** Reconcile an unknown outcome with the source of truth by key. A source that cannot answer leaves it pending. */
  async reconcile(tenantId: string, idempotencyKey: string): Promise<BookingOutcome | undefined> {
    const prior = this.settled.get(`${tenantId}:${idempotencyKey}`);
    if (!prior) return undefined;
    if (prior.outcome.status !== "pending") return prior.outcome;
    const rec = await this.source.lookupByKey(tenantId, idempotencyKey).catch(() => undefined);
    if (!rec || rec.status !== "confirmed") return prior.outcome;             // unknown or since cancelled: claim nothing
    const e = this.catalog.eligible(tenantId, prior.req.clinicId, prior.req.serviceId, prior.req.providerId);
    if (!e) return prior.outcome;
    const outcome: BookingOutcome = { status: "confirmed", bookingId: rec.bookingId, summary: { ...e, startsAt: rec.startsAt, endsAt: rec.endsAt, timeZone: e.clinic.timeZone } };
    this.settled.set(`${tenantId}:${idempotencyKey}`, { ...prior, outcome });
    return outcome;
  }

  private async attempt(tenantId: string, req: BookingRequest, key: string): Promise<BookingOutcome> {
    const elig = this.catalog.eligible(tenantId, req.clinicId, req.serviceId, req.providerId);
    if (!elig) throw new DomainError("not_found", "selection is not available");   // same answer for "other tenant" and "does not exist"
    const offered = await this.source.listSlots({ tenantId, clinicId: req.clinicId, serviceId: req.serviceId, providerId: req.providerId });
    const slot = offered.find((s) => s.id === req.slotId);
    if (!slot) return this.unavailable(offered);
    try {
      const rec = await this.source.reserve({ tenantId, clinicId: req.clinicId, serviceId: req.serviceId, providerId: req.providerId, slotId: req.slotId, idempotencyKey: key, patient: req.patient });
      return { status: "confirmed", bookingId: rec.bookingId, summary: { ...elig, startsAt: slot.startsAt, endsAt: slot.endsAt, timeZone: elig.clinic.timeZone } };
    } catch (e) {
      if (e instanceof SlotTakenError) return this.unavailable(await this.source.listSlots({ tenantId, clinicId: req.clinicId, serviceId: req.serviceId, providerId: req.providerId }).catch(() => []));
      if (e instanceof SchedulingTimeoutError) return { status: "pending", correlationId: key, message: "We could not confirm whether your appointment was booked yet. Please do not rebook; we are checking." };
      return { status: "failed", code: "scheduling_unavailable", message: "Booking is temporarily unavailable. No appointment was created.", retryable: true };
    }
  }

  private unavailable(alternatives: Slot[]): BookingOutcome {
    return { status: "slot_unavailable", message: "That time is no longer available. Your other choices are kept; please pick another time.", alternatives: alternatives.slice(0, 5) };
  }
}
