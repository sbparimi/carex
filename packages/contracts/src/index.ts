import { z } from "zod";

/** Identifiers are opaque, URL-safe tokens. Anything else is rejected before it reaches a data layer. */
export const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/);
export const StateCode = z.string().regex(/^[A-Z]{2}$/);
export const CanonicalVisitType = z.enum(["physio", "health_coach", "fitness", "primary_care", "vision_care"]);

export const BrandConfig = z.object({
  displayName: z.string().min(1),
  logoUrl: z.string().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  supportEmail: z.string().optional(),
  supportPhone: z.string().optional(),
});
export type BrandConfig = z.infer<typeof BrandConfig>;

export const PublicClinic = z.object({
  id: Id, name: z.string(), city: z.string(), address: z.string(), stateCode: StateCode, timeZone: z.string(),
});
export type PublicClinic = z.infer<typeof PublicClinic>;

export const VisitType = z.object({ id: Id, canonicalType: CanonicalVisitType, label: z.string(), description: z.string() });
export type VisitType = z.infer<typeof VisitType>;

export const PublicProvider = z.object({ id: Id, displayName: z.string() });
export type PublicProvider = z.infer<typeof PublicProvider>;

/** Provisional until a booking succeeds (BR-006). */
export const Slot = z.object({
  id: Id.or(z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/)),
  providerId: Id, clinicId: Id, serviceId: Id,
  startsAt: z.string().datetime(), endsAt: z.string().datetime(), timeZone: z.string(),
});
export type Slot = z.infer<typeof Slot>;

export const Patient = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().email().max(200).optional(),
  phone: z.string().regex(/^[0-9+() .-]{7,20}$/).optional(),
}).refine((p) => p.email || p.phone, { message: "email or phone is required" });
export type Patient = z.infer<typeof Patient>;

/** BR-007: the booking is only created on explicit confirmation. */
export const BookingRequest = z.object({
  clinicId: Id, serviceId: Id, providerId: Id, slotId: Slot.shape.id,
  /** Ignored by the server: the patient is the signed-in account (ADR-005). Kept optional so older clients still parse. */
  patient: Patient.optional(),
  confirmed: z.literal(true),
});
export type BookingRequest = z.infer<typeof BookingRequest>;

export const AppointmentSummary = z.object({
  clinic: PublicClinic, visitType: VisitType, provider: PublicProvider, startsAt: z.string(), endsAt: z.string(), timeZone: z.string(),
});
export type AppointmentSummary = z.infer<typeof AppointmentSummary>;

/** BR-008: `confirmed` is only ever produced from an authoritative scheduling-source result. */
export const BookingOutcome = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), bookingId: z.string(), summary: AppointmentSummary }),
  z.object({ status: z.literal("slot_unavailable"), message: z.string(), alternatives: z.array(Slot) }),
  z.object({ status: z.literal("pending"), correlationId: z.string(), message: z.string() }),
  z.object({ status: z.literal("failed"), code: z.string(), message: z.string(), retryable: z.boolean() }),
]);
export type BookingOutcome = z.infer<typeof BookingOutcome>;

export const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ErrorBody = z.infer<typeof ErrorBody>;

export * from "./selection.js";

/** What a patient sees when managing a booking. No patient details are ever returned here. */
export const ManagedAppointment = z.object({
  bookingId: z.string(), status: z.enum(["confirmed", "cancelled", "arrived", "completed", "no_show"]), summary: AppointmentSummary,
  canChange: z.boolean(), changeNoticeMinutes: z.number().int(),
});
export type ManagedAppointment = z.infer<typeof ManagedAppointment>;

export const RescheduleRequest = z.object({ slotId: Slot.shape.id });
export type RescheduleRequest = z.infer<typeof RescheduleRequest>;

export const RescheduleOutcome = z.discriminatedUnion("status", [
  z.object({ status: z.literal("rescheduled"), appointment: ManagedAppointment }),
  z.object({ status: z.literal("slot_unavailable"), message: z.string(), alternatives: z.array(Slot) }),
]);
export type RescheduleOutcome = z.infer<typeof RescheduleOutcome>;
