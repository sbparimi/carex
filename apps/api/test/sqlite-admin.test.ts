// Owner-approved spec for apps/api/src/sqlite-admin.ts (ADR-004): tenant-scoped configuration changes.
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, seedDb, type Db } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";
import { SqliteAdmin, AdminNotFoundError, AdminValidationError } from "../src/sqlite-admin.js";
import { SqliteCatalog } from "../src/sqlite-catalog.js";
import { SqliteScheduling } from "../src/sqlite-scheduling.js";

let db: Db; let admin: SqliteAdmin; let catalog: SqliteCatalog; let sched: SqliteScheduling;
const NOW = new Date("2026-10-14T14:00:00Z");
beforeEach(() => { db = openDb(); seedDb(db, syntheticCatalog()); admin = new SqliteAdmin(db, () => NOW); catalog = new SqliteCatalog(db); sched = new SqliteScheduling(db, { now: () => NOW }); });
const newClinic = { name: "Harbor Clinic", city: "Harbor", address: "9 Example Way, Harbor", stateCode: "WA", timeZone: "America/Los_Angeles" };

describe("branding and analytics", () => {
  it("updates only the brand fields given and validates them", () => {
    const b = admin.updateBrand("tn-north", { displayName: "Northwind Care", primaryColor: "#112233" });
    expect(b).toMatchObject({ displayName: "Northwind Care", primaryColor: "#112233", supportEmail: "help@northwind-health.example" });
    expect(catalog.tenantBySlug("northwind-health")!.brand.displayName).toBe("Northwind Care");
    expect(() => admin.updateBrand("tn-north", { primaryColor: "blue" })).toThrow(AdminValidationError);
    expect(() => admin.updateBrand("tn-north", { displayName: "" })).toThrow(AdminValidationError);
  });
  it("can clear optional contact fields with null, and switch analytics per tenant", () => {
    expect(admin.updateBrand("tn-north", { supportEmail: null }).supportEmail).toBeUndefined();
    admin.setAnalytics("tn-bay", true);
    expect(catalog.tenantBySlug("bayview-care")!.analyticsEnabled).toBe(true);
    expect(catalog.tenantBySlug("northwind-health")!.analyticsEnabled).toBe(true);
  });
  it("never touches another tenant", () => {
    admin.updateBrand("tn-north", { displayName: "X" });
    expect(catalog.tenantBySlug("bayview-care")!.brand.displayName).toBe("Bayview Care (synthetic)");
    expect(() => admin.updateBrand("tn-unknown", { displayName: "X" })).toThrow(AdminNotFoundError);
  });
});

describe("clinics", () => {
  it("creates a clinic that is NOT bookable until explicitly activated", () => {
    const c = admin.createClinic("tn-north", newClinic);
    expect(c.id).toMatch(/^cl-[a-z0-9]{6,}$/);
    expect(catalog.clinics("tn-north", "WA")).toEqual([]);
    admin.updateClinic("tn-north", c.id, { status: "active", bookable: true });
    expect(catalog.clinics("tn-north", "WA").map((x) => x.name)).toEqual(["Harbor Clinic"]);
    expect(catalog.states("tn-north")).toContain("WA");
  });
  it("validates state code, time zone and required text", () => {
    expect(() => admin.createClinic("tn-north", { ...newClinic, stateCode: "Washington" })).toThrow(AdminValidationError);
    expect(() => admin.createClinic("tn-north", { ...newClinic, timeZone: "Mars/Olympus" })).toThrow(AdminValidationError);
    expect(() => admin.createClinic("tn-north", { ...newClinic, name: "  " })).toThrow(AdminValidationError);
  });
  it("lists every clinic of the tenant with its status, and no other tenant's", () => {
    const all = admin.listClinics("tn-north");
    expect(all.map((c) => c.id).sort()).toEqual(["cl-au", "cl-fr", "cl-nb", "cl-sb"]);
    expect(all.find((c) => c.id === "cl-fr")).toMatchObject({ status: "inactive", bookable: true });
  });
  it("refuses to edit another tenant's clinic", () => {
    expect(() => admin.updateClinic("tn-bay", "cl-sb", { status: "inactive" })).toThrow(AdminNotFoundError);
    expect(catalog.clinic("tn-north", "cl-sb")).toBeDefined();
  });
  it("deactivating a clinic reports, but does not cancel, future appointments there", async () => {
    const slot = (await sched.listSlots({ tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a" }))[0]!;
    const rec = await sched.reserve({ tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: slot.id, idempotencyKey: "key-admin-0001", patient: { firstName: "A", lastName: "B", email: "a@example.test" } });
    const r = admin.updateClinic("tn-north", "cl-sb", { status: "inactive" });
    expect(r.affectedFutureAppointments).toBe(1);
    expect(catalog.clinic("tn-north", "cl-sb")).toBeUndefined();
    expect((await sched.getBooking("tn-north", rec.bookingId))!.status).toBe("confirmed");
  });
});

describe("visit types per clinic", () => {
  it("switches a configured visit type on and off at one clinic", () => {
    admin.setClinicVisitType("tn-north", "cl-sb", "sv-vision-n", true);
    expect(catalog.visitTypes("tn-north", "cl-sb").map((v) => v.id)).toContain("sv-vision-n");
    admin.setClinicVisitType("tn-north", "cl-sb", "sv-vision-n", false);
    expect(catalog.visitTypes("tn-north", "cl-sb").map((v) => v.id)).not.toContain("sv-vision-n");
  });
  it("can add a visit type to a clinic that did not have it, but never across tenants", () => {
    admin.setClinicVisitType("tn-north", "cl-au", "sv-physio-n", true);
    expect(catalog.visitTypes("tn-north", "cl-au").map((v) => v.id)).toContain("sv-physio-n");
    expect(() => admin.setClinicVisitType("tn-north", "cl-sb", "sv-pc-b", true)).toThrow(AdminNotFoundError);
    expect(() => admin.setClinicVisitType("tn-bay", "cl-sb", "sv-pc-n", true)).toThrow(AdminNotFoundError);
  });
});

describe("availability and time off", () => {
  const rules = [{ weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 }, { weekday: 1, startMinute: 13 * 60, endMinute: 15 * 60 }, { weekday: 3, startMinute: 8 * 60, endMinute: 10 * 60 }];
  it("replaces a provider's weekly hours at a clinic atomically, and slots follow", async () => {
    admin.setAvailability("tn-north", "pr-a", "cl-sb", rules);
    const slots = await sched.listSlots({ tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a" });
    const days = new Set(slots.map((s) => new Date(s.startsAt).getUTCDay()));
    expect([...days].sort()).toEqual([1, 3]);                                 // Monday and Wednesday only (all hours fall on the same UTC day in Los Angeles)
    expect(admin.getAvailability("tn-north", "pr-a", "cl-sb")).toHaveLength(3);
  });
  it("rejects overlapping, inverted or out-of-range rules and leaves the old hours in place", () => {
    const before = admin.getAvailability("tn-north", "pr-a", "cl-sb").length;
    expect(() => admin.setAvailability("tn-north", "pr-a", "cl-sb", [{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 700, endMinute: 800 }])).toThrow(AdminValidationError);
    expect(() => admin.setAvailability("tn-north", "pr-a", "cl-sb", [{ weekday: 1, startMinute: 720, endMinute: 540 }])).toThrow(AdminValidationError);
    expect(() => admin.setAvailability("tn-north", "pr-a", "cl-sb", [{ weekday: 7, startMinute: 0, endMinute: 60 }])).toThrow(AdminValidationError);
    expect(admin.getAvailability("tn-north", "pr-a", "cl-sb")).toHaveLength(before);
  });
  it("is tenant-scoped", () => {
    expect(() => admin.setAvailability("tn-bay", "pr-a", "cl-sb", rules)).toThrow(AdminNotFoundError);
    expect(() => admin.getAvailability("tn-bay", "pr-a", "cl-sb")).toThrow(AdminNotFoundError);
  });
  it("adds and removes time off, which hides overlapping slots", async () => {
    const q = { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a" };
    const first = (await sched.listSlots(q))[0]!;
    const id = admin.addTimeOff("tn-north", "pr-a", first.startsAt, first.endsAt);
    expect((await sched.listSlots(q)).map((s) => s.id)).not.toContain(first.id);
    admin.removeTimeOff("tn-north", id);
    expect((await sched.listSlots(q)).map((s) => s.id)).toContain(first.id);
    expect(() => admin.addTimeOff("tn-north", "pr-a", first.endsAt, first.startsAt)).toThrow(AdminValidationError);
    expect(() => admin.addTimeOff("tn-bay", "pr-a", first.startsAt, first.endsAt)).toThrow(AdminNotFoundError);
    expect(() => admin.removeTimeOff("tn-bay", id)).toThrow(AdminNotFoundError);
  });
});
