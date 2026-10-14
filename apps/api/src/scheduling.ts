import type { Patient, Slot } from "@carex/contracts";

export class SlotTakenError extends Error {}
export class SchedulingTimeoutError extends Error {}
/** The same Idempotency-Key was reused for a different request. */
export class IdempotencyConflictError extends Error {}
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
