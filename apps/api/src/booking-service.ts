import { createHash } from "node:crypto";
import { BookingRequest, type BookingOutcome, type ManagedAppointment, type RescheduleOutcome, type Slot } from "@carex/contracts";
import type { CatalogPort } from "./catalog.js";
import { IntakeError, type IntakeDecision, type IntakePort } from "./intake.js";
import { BookingNotFoundError, ChangeWindowClosedError, IdempotencyConflictError, SchedulingTimeoutError, SchedulingUnavailableError, SlotTakenError, type ManagedBooking, type SchedulingSource } from "./scheduling.js";

export class DomainError extends Error {
  constructor(public code: "not_found" | "invalid_request" | "idempotency_conflict" | "payload_too_large" | "change_window_closed" | "scheduling_unavailable", message: string) { super(message); }
}

/** The signed-in account a booking belongs to. Contact details come from here, never from the request body. */
export interface Principal { id: string; firstName: string; lastName: string; email: string; phone: string }

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

  private notice: number; private now: () => Date; private intake: IntakePort | undefined;
  /** `changeNoticeMinutes` must match the scheduling engine's own rule; it only drives what the UI is told (the engine enforces it). */
  constructor(private catalog: CatalogPort, private source: SchedulingSource, opts: { now?: () => Date; changeNoticeMinutes?: number; intake?: IntakePort } = {}) {
    this.intake = opts.intake;
    this.notice = opts.changeNoticeMinutes ?? 120; this.now = opts.now ?? (() => new Date());
  }

  // ---- an account's own bookings (view, cancel, reschedule). Ownership is enforced here: another user's booking is "not found".
  async list(tenantId: string, userId: string): Promise<ManagedAppointment[]> {
    const out: ManagedAppointment[] = [];
    for (const b of await this.source.listForUser(tenantId, userId)) { const m = await this.toManaged(tenantId, b); if (m) out.push(m); }
    return out;
  }

  async managed(tenantId: string, userId: string, bookingId: string): Promise<ManagedAppointment | undefined> {
    const b = await this.owned(tenantId, userId, bookingId);
    return b && this.toManaged(tenantId, b);
  }

  async cancel(tenantId: string, userId: string, bookingId: string, reason?: string): Promise<ManagedAppointment> {
    try {
      if (!(await this.owned(tenantId, userId, bookingId))) throw new BookingNotFoundError("Booking not found");
      const m = await this.requireManaged(tenantId, await this.source.cancel(tenantId, bookingId, { reason: reason ?? "", by: "patient" })); this.forget(tenantId, bookingId); return m;
    } catch (e) { throw this.mapManageError(e); }
  }

  async reschedule(tenantId: string, userId: string, bookingId: string, slotId: string): Promise<RescheduleOutcome> {
    try {
      if (!(await this.owned(tenantId, userId, bookingId))) throw new BookingNotFoundError("Booking not found");
      const appointment = await this.requireManaged(tenantId, await this.source.reschedule(tenantId, bookingId, slotId)); this.forget(tenantId, bookingId); return { status: "rescheduled", appointment };
    } catch (e) {
      if (e instanceof SlotTakenError) {
        const b = await this.source.getBooking(tenantId, bookingId).catch(() => undefined);
        const alternatives = b ? await this.source.listSlots({ tenantId, clinicId: b.clinicId, serviceId: b.serviceId, providerId: b.providerId }).catch(() => []) : [];
        return { status: "slot_unavailable", message: "That time is no longer available. Your current appointment is unchanged; please pick another time.", alternatives: alternatives.slice(0, 5) };
      }
      throw this.mapManageError(e);
    }
  }

  private async owned(tenantId: string, userId: string, bookingId: string): Promise<ManagedBooking | undefined> {
    const b = await this.source.getBooking(tenantId, bookingId);
    return b && b.userId === userId ? b : undefined;
  }

  /** A cached outcome describes the booking as it was when created; after a change it must be re-read from the source of truth. */
  private forget(tenantId: string, bookingId: string) {
    for (const [k, v] of this.settled) if (k.startsWith(`${tenantId}:`) && v.outcome.status === "confirmed" && v.outcome.bookingId === bookingId) this.settled.delete(k);
  }

  private async toManaged(tenantId: string, b: ManagedBooking): Promise<ManagedAppointment | undefined> {
    const d = await this.catalog.describe(tenantId, b.clinicId, b.serviceId, b.providerId);
    if (!d) return undefined;
    const canChange = b.status === "confirmed" && Date.parse(b.startsAt) - this.now().getTime() >= this.notice * 60_000;
    return { bookingId: b.bookingId, status: b.status, summary: { ...d, startsAt: b.startsAt, endsAt: b.endsAt, timeZone: d.clinic.timeZone, ...(b.modality ? { modality: b.modality } : {}), ...(b.joinUrl ? { joinUrl: b.joinUrl } : {}), ...(b.copayCents !== undefined ? { copayCents: b.copayCents } : {}), ...(b.patientName ? { patientName: b.patientName } : {}), ...(b.reason ? { reason: b.reason } : {}) }, canChange, changeNoticeMinutes: this.notice };
  }
  private async requireManaged(tenantId: string, b: ManagedBooking): Promise<ManagedAppointment> {
    const m = await this.toManaged(tenantId, b);
    if (!m) throw new DomainError("not_found", "not found");
    return m;
  }
  private mapManageError(e: unknown): unknown {
    if (e instanceof BookingNotFoundError) return new DomainError("not_found", "not found");
    if (e instanceof ChangeWindowClosedError) return new DomainError("change_window_closed", `Appointments can only be changed at least ${this.notice} minutes before they start. Please contact the clinic.`);
    if (e instanceof SchedulingUnavailableError || e instanceof SchedulingTimeoutError) return new DomainError("scheduling_unavailable", "Scheduling is temporarily unavailable. Nothing was changed.");
    return e;
  }

  async slots(tenantId: string, clinicId: string, serviceId: string, providerId: string, who?: { userId: string; patientId?: string }): Promise<Slot[]> {
    if (!(await this.catalog.eligible(tenantId, clinicId, serviceId, providerId))) return [];
    return this.source.listSlots({ tenantId, clinicId, serviceId, providerId, ...(who ? { userId: who.userId, ...(who.patientId ? { patientId: who.patientId } : {}) } : {}) });
  }

  /** "Any provider": the soonest openings across every eligible provider, soonest first. */
  async firstAvailable(tenantId: string, clinicId: string, serviceId: string, who: { userId: string; patientId?: string }, limit = 6): Promise<(Slot & { providerName: string })[]> {
    const out: (Slot & { providerName: string })[] = [];
    for (const p of await this.catalog.providers(tenantId, clinicId, serviceId)) {
      if (p.acceptingNew === false) continue;
      const slots = await this.source.listSlots({ tenantId, clinicId, serviceId, providerId: p.id, userId: who.userId, ...(who.patientId ? { patientId: who.patientId } : {}) }).catch(() => []);
      for (const s of slots.slice(0, limit)) out.push({ ...s, providerName: p.displayName });
    }
    return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.providerId.localeCompare(b.providerId)).slice(0, limit);
  }

  async create(tenantId: string, user: Principal, raw: unknown, idempotencyKey: string): Promise<BookingOutcome> {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(idempotencyKey)) throw new DomainError("invalid_request", "Idempotency-Key header is required (8-64 URL-safe characters)");
    const parsed = BookingRequest.safeParse(raw);
    if (!parsed.success) throw new DomainError("invalid_request", "invalid booking request");
    const req = parsed.data;
    const k = `${tenantId}:${user.id}:${idempotencyKey}`;
    const fingerprint = hash({ ...req, patient: undefined });

    const done = this.settled.get(k);
    if (done) {
      if (done.fingerprint !== fingerprint) throw new DomainError("idempotency_conflict", "this Idempotency-Key was used with a different request");
      if (done.outcome.status !== "pending") return done.outcome;           // replay returns the same result
      const r = await this.reconcile(tenantId, user.id, idempotencyKey);      // pending: ask the source of truth first
      if (r && r.status !== "pending") return r;
      this.settled.delete(k);                                               // source has no booking for this key: a retry is safe (the source dedupes by key)
    }
    const running = this.inflight.get(k);
    if (running) {
      if (running.fingerprint !== fingerprint) throw new DomainError("idempotency_conflict", "this Idempotency-Key was used with a different request");
      return running.promise;                                                // concurrent duplicate: share one attempt
    }
    const promise = this.attempt(tenantId, user, req, idempotencyKey).then((outcome) => {
      // Only outcomes that may already exist at the source are remembered. Failures and lost races are re-attemptable.
      if (outcome.status === "confirmed" || outcome.status === "pending") this.settled.set(k, { fingerprint, outcome, req });
      return outcome;
    }).finally(() => this.inflight.delete(k));
    this.inflight.set(k, { fingerprint, promise });
    return promise;
  }

  /** Reconcile an unknown outcome with the source of truth by key. A source that cannot answer leaves it pending. */
  async reconcile(tenantId: string, userId: string, idempotencyKey: string): Promise<BookingOutcome | undefined> {
    const prior = this.settled.get(`${tenantId}:${userId}:${idempotencyKey}`);
    if (!prior) return undefined;
    if (prior.outcome.status !== "pending") return prior.outcome;
    const rec = await this.source.lookupByKey(tenantId, idempotencyKey).catch(() => undefined);
    if (!rec || rec.status !== "confirmed") return prior.outcome;             // unknown or since cancelled: claim nothing
    const e = await this.catalog.eligible(tenantId, prior.req.clinicId, prior.req.serviceId, prior.req.providerId);
    if (!e) return prior.outcome;
    const outcome: BookingOutcome = { status: "confirmed", bookingId: rec.bookingId, summary: { ...e, startsAt: rec.startsAt, endsAt: rec.endsAt, timeZone: e.clinic.timeZone } };
    this.settled.set(`${tenantId}:${userId}:${idempotencyKey}`, { ...prior, outcome });
    return outcome;
  }

  private async attempt(tenantId: string, user: Principal, req: BookingRequest, key: string): Promise<BookingOutcome> {
    const elig = await this.catalog.eligible(tenantId, req.clinicId, req.serviceId, req.providerId);
    if (!elig) throw new DomainError("not_found", "selection is not available");   // same answer for "other tenant" and "does not exist"
    let decision: IntakeDecision | undefined;
    if (this.intake) {
      try { decision = await this.intake.prepare(tenantId, user.id, req); }
      catch (e) { if (e instanceof IntakeError) return { status: "failed", code: e.code, message: e.message, retryable: false }; throw e; }
    }
    const who = { tenantId, clinicId: req.clinicId, serviceId: req.serviceId, providerId: req.providerId, userId: user.id, ...(decision ? { patientId: decision.patientId } : {}) };
    // A key that already has a booking at the source is a replay: let the source answer (it also checks the request matches).
    const prior = await this.source.lookupByKey(tenantId, key).catch(() => undefined);
    if (!prior) {
      const offered = await this.source.listSlots(who);
      if (!offered.some((s) => s.id === req.slotId)) return this.unavailable(offered);
    }
    try {
      const rec = await this.source.reserve({ tenantId, clinicId: req.clinicId, serviceId: req.serviceId, providerId: req.providerId, slotId: req.slotId, idempotencyKey: key, userId: user.id,
        patient: { firstName: decision?.patientFirstName ?? user.firstName, lastName: decision?.patientLastName ?? user.lastName, email: user.email, phone: user.phone }, ...(decision ? { intake: decision } : {}) });
      if (rec.status !== "confirmed") return { status: "failed", code: "booking_cancelled", message: "This booking was cancelled. Please start a new booking.", retryable: false };
      return { status: "confirmed", bookingId: rec.bookingId, summary: { ...elig, startsAt: rec.startsAt, endsAt: rec.endsAt, timeZone: elig.clinic.timeZone, ...(decision ? { modality: decision.modality, copayCents: decision.copayCents, ...(decision.modality === "telehealth" && decision.videoJoinBase ? { joinUrl: `${decision.videoJoinBase.replace(/\/+$/, "")}/${rec.bookingId}` } : {}), patientName: `${decision.patientFirstName} ${decision.patientLastName}`, ...(decision.reason ? { reason: decision.reason } : {}) } : {}) } };
    } catch (e) {
      if (e instanceof IdempotencyConflictError) throw new DomainError("idempotency_conflict", "this Idempotency-Key was used with a different request");
      if (e instanceof SlotTakenError) return this.unavailable(await this.source.listSlots(who).catch(() => []));
      if (e instanceof SchedulingTimeoutError) return { status: "pending", correlationId: key, message: "We could not confirm whether your appointment was booked yet. Please do not rebook; we are checking." };
      return { status: "failed", code: "scheduling_unavailable", message: "Booking is temporarily unavailable. No appointment was created.", retryable: true };
    }
  }

  private unavailable(alternatives: Slot[]): BookingOutcome {
    return { status: "slot_unavailable", message: "That time is no longer available. Your other choices are kept; please pick another time.", alternatives: alternatives.slice(0, 5) };
  }
}
