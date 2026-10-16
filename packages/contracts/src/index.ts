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

export const Modality = z.enum(["in_person", "telehealth"]);
export type Modality = z.infer<typeof Modality>;
export const VisitType = z.object({
  id: Id, canonicalType: CanonicalVisitType, label: z.string(), description: z.string(),
  durationMin: z.number().int().optional(), modality: z.enum(["in_person", "telehealth", "either"]).optional(),
  requiresReferral: z.boolean().optional(), minAge: z.number().int().optional(), maxAge: z.number().int().optional(),
});
export type VisitType = z.infer<typeof VisitType>;

export const PublicProvider = z.object({
  id: Id, displayName: z.string(),
  specialty: z.string().optional(), languages: z.array(z.string()).optional(), acceptingNew: z.boolean().optional(), bio: z.string().optional(),
});
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
  // Clinical intake (enforced by the server when the tenant requires intake).
  patientId: Id.optional(),
  reason: z.string().trim().max(500).optional(),
  /** Red-flag keys the patient answered YES to. Present (even empty) means the screening question was shown and answered. */
  redFlags: z.array(z.string().max(40)).max(20).optional(),
  modality: Modality.optional(),
  patientState: StateCode.optional(),
  interpreterLanguage: z.string().trim().max(40).optional(),
  accommodations: z.string().trim().max(300).optional(),
  referralRef: z.string().trim().max(60).optional(),
  consentVersion: z.string().max(20).optional(),
});
export type BookingRequest = z.infer<typeof BookingRequest>;

export const AppointmentSummary = z.object({
  clinic: PublicClinic, visitType: VisitType, provider: PublicProvider, startsAt: z.string(), endsAt: z.string(), timeZone: z.string(),
  modality: Modality.optional(), joinUrl: z.string().optional(), copayCents: z.number().int().optional(), patientName: z.string().optional(), reason: z.string().optional(),
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
