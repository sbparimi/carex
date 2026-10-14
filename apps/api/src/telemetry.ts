/** FR-010: step-level events with coded fields only. Unknown events and unknown fields are dropped, never forwarded. */
const EVENTS = new Set([
  "booking_started", "state_selected", "clinic_selected", "visit_type_selected", "provider_selected", "slot_selected",
  "booking_confirm_attempted", "booking_confirmed", "booking_failed",
]);
const FIELDS = new Set(["event", "tenantId", "correlationId", "errorCode", "step"]);

export type TelemetrySink = (e: Record<string, string>) => void;

export function emitTelemetry(sink: TelemetrySink | undefined, input: Record<string, unknown>): boolean {
  if (!sink || typeof input.event !== "string" || !EVENTS.has(input.event)) return false;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) if (FIELDS.has(k) && typeof v === "string" && v.length <= 80) clean[k] = v;
  sink(clean);
  return true;
}

const SENSITIVE = new Set(["patient", "firstName", "lastName", "name", "email", "phone", "address", "dob"]);

/** Log redaction: sensitive keys are replaced everywhere in a structure (observability without exposing patient data). */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, SENSITIVE.has(k) ? "[redacted]" : redact(v)]));
  }
  return value;
}
