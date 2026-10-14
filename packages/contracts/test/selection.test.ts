import { describe, it, expect } from "vitest";
import { applySelection, isComplete, BookingRequest, Patient, type Selection } from "../src/index.js";
import { emitTelemetry, redact } from "../../../apps/api/src/telemetry.js";

const full: Selection = { stateCode: "CA", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: "s1" };

describe("selection invalidation (PRD §5, FR-004)", () => {
  it("clears every downstream choice when an upstream one changes", () => {
    expect(applySelection(full, "clinicId", "cl-au")).toEqual({ stateCode: "CA", clinicId: "cl-au" });
    expect(applySelection(full, "stateCode", "TX")).toEqual({ stateCode: "TX" });
    expect(applySelection(full, "providerId", "pr-b")).toEqual({ stateCode: "CA", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-b" });
  });
  it("keeps the same value untouched", () => { expect(applySelection(full, "clinicId", "cl-sb")).toEqual(full); });
  it("keeps downstream values only when explicitly revalidated", () => {
    const next = applySelection(full, "clinicId", "cl-au", (step) => step === "serviceId");
    expect(next).toEqual({ stateCode: "CA", clinicId: "cl-au", serviceId: "sv-pc-n" });          // provider and slot still dropped
  });
  it("removing a choice clears what depends on it", () => { expect(applySelection(full, "serviceId", undefined)).toEqual({ stateCode: "CA", clinicId: "cl-sb" }); });
  it("knows when the journey is complete", () => { expect(isComplete(full)).toBe(true); expect(isComplete({ stateCode: "CA" })).toBe(false); });
});

describe("contracts", () => {
  const ok = { clinicId: "c", serviceId: "s", providerId: "p", slotId: "a:b:20261103T1700", confirmed: true, patient: { firstName: "A", lastName: "B", phone: "+1 555 0100" } };
  it("requires explicit confirmation and a contact method", () => {
    expect(BookingRequest.safeParse(ok).success).toBe(true);
    expect(BookingRequest.safeParse({ ...ok, confirmed: false }).success).toBe(false);
    expect(Patient.safeParse({ firstName: "A", lastName: "B" }).success).toBe(false);
  });
});

describe("telemetry and redaction", () => {
  it("drops unknown events and fields, and requires a sink", () => {
    const got: object[] = [];
    expect(emitTelemetry((e) => got.push(e), { event: "state_selected", tenantId: "t", email: "a@b.c", note: "free text" })).toBe(true);
    expect(got).toEqual([{ event: "state_selected", tenantId: "t" }]);
    expect(emitTelemetry((e) => got.push(e), { event: "something_else" })).toBe(false);
    expect(emitTelemetry(undefined, { event: "state_selected" })).toBe(false);
  });
  it("redacts sensitive keys at any depth", () => {
    expect(redact({ a: 1, patient: { firstName: "x" }, nested: [{ email: "e", ok: 2 }] })).toEqual({ a: 1, patient: "[redacted]", nested: [{ email: "[redacted]", ok: 2 }] });
  });
});
