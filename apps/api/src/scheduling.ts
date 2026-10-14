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
export interface BookingRecord { bookingId: string; tenantId: string; slotId: string; idempotencyKey: string; startsAt: string; endsAt: string; status: "confirmed" | "cancelled" }

/** A booking as the patient manages it. No patient details: those never leave the scheduling store through this path. */
export interface ManagedBooking { bookingId: string; tenantId: string; clinicId: string; serviceId: string; providerId: string; startsAt: string; endsAt: string; status: "confirmed" | "cancelled" }
/** Unknown booking, another tenant's booking, or a cancelled booking where an active one is required: indistinguishable on purpose. */
export class BookingNotFoundError extends Error {}
/** Changes are refused inside the notice window before the start time. */
export class ChangeWindowClosedError extends Error {}

/** The system of record. The booking service never reports success unless `reserve` resolves. */
export interface SchedulingSource {
  listSlots(q: { tenantId: string; clinicId: string; serviceId: string; providerId: string }): Promise<Slot[]>;
  /** Atomic: either the slot is reserved for this key or an error is thrown. Same key twice => same booking. */
  reserve(input: ReserveInput): Promise<BookingRecord>;
  lookupByKey(tenantId: string, idempotencyKey: string): Promise<BookingRecord | undefined>;
  getBooking(tenantId: string, bookingId: string): Promise<ManagedBooking | undefined>;
  /** Idempotent: cancelling an already cancelled booking returns it. Throws BookingNotFoundError, ChangeWindowClosedError. */
  cancel(tenantId: string, bookingId: string): Promise<ManagedBooking>;
  /** Atomic move to another offered slot of the same provider, clinic and visit type; the reference stays the same. Throws BookingNotFoundError, ChangeWindowClosedError, SlotTakenError. */
  reschedule(tenantId: string, bookingId: string, newSlotId: string): Promise<ManagedBooking>;
}
