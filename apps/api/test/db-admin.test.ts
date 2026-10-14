// Owner-approved spec for apps/api/src/db-admin.ts (ADR-004): tenant-scoped configuration changes.
import { describe, it, expect, beforeEach } from "vitest";
import { openTestDb, seedDb, type Db } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";
import { DbAdmin, AdminNotFoundError, AdminValidationError } from "../src/db-admin.js";
import { DbCatalog } from "../src/db-catalog.js";
import { DbScheduling } from "../src/db-scheduling.js";

let db: Db; let admin: DbAdmin; let catalog: DbCatalog; let sched: DbScheduling;
const NOW = new Date("2026-10-14T14:00:00Z");
beforeEach(async () => { db = await openTestDb(); await seedDb(db, syntheticCatalog()); admin = new DbAdmin(db, () => NOW); catalog = new DbCatalog(db); sched = new DbScheduling(db, { now: () => NOW }); });
const newClinic = { name: "Harbor Clinic", city: "Harbor", address: "9 Example Way, Harbor", stateCode: "WA", timeZone: "America/Los_Angeles" };

describe("branding and analytics", () => {
  it("updates only the brand fields given and validates them", async () => {
    const b = await admin.updateBrand("tn-north", { displayName: "Northwind Care", primaryColor: "#112233" });
    expect(b).toMatchObject({ displayName: "Northwind Care", primaryColor: "#112233", supportEmail: "help@northwind-health.example" });
    expect((await catalog.tenantBySlug("northwind-health"))!.brand.displayName).toBe("Northwind Care");
    await expect(admin.updateBrand("tn-north", { primaryColor: "blue" })).rejects.toBeInstanceOf(AdminValidationError);
    await expect(admin.updateBrand("tn-north", { displayName: "" })).rejects.toBeInstanceOf(AdminValidationError);
  });
  it("can clear optional contact fields with null, and switch analytics per tenant", async () => {
    expect((await admin.updateBrand("tn-north", { supportEmail: null })).supportEmail).toBeUndefined();
    await admin.setAnalytics("tn-bay", true);
    expect((await catalog.tenantBySlug("bayview-care"))!.analyticsEnabled).toBe(true);
    expect((await catalog.tenantBySlug("northwind-health"))!.analyticsEnabled).toBe(true);
  });
  it("never touches another tenant", async () => {
    await admin.updateBrand("tn-north", { displayName: "X" });
    expect((await catalog.tenantBySlug("bayview-care"))!.brand.displayName).toBe("Bayview Care (synthetic)");
    await expect(admin.updateBrand("tn-unknown", { displayName: "X" })).rejects.toBeInstanceOf(AdminNotFoundError);
  });
});

describe("clinics", () => {
  it("creates a clinic that is NOT bookable until explicitly activated", async () => {
    const c = await admin.createClinic("tn-north", newClinic);
    expect(c.id).toMatch(/^cl-[a-z0-9]{6,}$/);
    expect(await catalog.clinics("tn-north", "WA")).toEqual([]);
    await admin.updateClinic("tn-north", c.id, { status: "active", bookable: true });
    expect((await catalog.clinics("tn-north", "WA")).map((x) => x.name)).toEqual(["Harbor Clinic"]);
    expect(await catalog.states("tn-north")).toContain("WA");
  });
  it("validates state code, time zone and required text", async () => {
    await expect(admin.createClinic("tn-north", { ...newClinic, stateCode: "Washington" })).rejects.toBeInstanceOf(AdminValidationError);
    await expect(admin.createClinic("tn-north", { ...newClinic, timeZone: "Mars/Olympus" })).rejects.toBeInstanceOf(AdminValidationError);
    await expect(admin.createClinic("tn-north", { ...newClinic, name: "  " })).rejects.toBeInstanceOf(AdminValidationError);
  });
  it("lists every clinic of the tenant with its status, and no other tenant's", async () => {
    const all = await admin.listClinics("tn-north");
    expect(all.map((c) => c.id).sort()).toEqual(["cl-au", "cl-fr", "cl-nb", "cl-sb"]);
    expect(all.find((c) => c.id === "cl-fr")).toMatchObject({ status: "inactive", bookable: true });
  });
  it("refuses to edit another tenant's clinic", async () => {
    await expect(admin.updateClinic("tn-bay", "cl-sb", { status: "inactive" })).rejects.toBeInstanceOf(AdminNotFoundError);
    expect(await catalog.clinic("tn-north", "cl-sb")).toBeDefined();
  });
  it("deactivating a clinic reports, but does not cancel, future appointments there", async () => {
    const slot = (await sched.listSlots({ tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a" }))[0]!;
    const rec = await sched.reserve({ tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: slot.id, idempotencyKey: "key-admin-0001", patient: { firstName: "A", lastName: "B", email: "a@example.test" } });
    const r = await admin.updateClinic("tn-north", "cl-sb", { status: "inactive" });
    expect(r.affectedFutureAppointments).toBe(1);
    expect(await catalog.clinic("tn-north", "cl-sb")).toBeUndefined();
    expect((await sched.getBooking("tn-north", rec.bookingId))!.status).toBe("confirmed");
  });
});

describe("visit types per clinic", () => {
  it("switches a configured visit type on and off at one clinic", async () => {
    await admin.setClinicVisitType("tn-north", "cl-sb", "sv-vision-n", true);
    expect((await catalog.visitTypes("tn-north", "cl-sb")).map((v) => v.id)).toContain("sv-vision-n");
    await admin.setClinicVisitType("tn-north", "cl-sb", "sv-vision-n", false);
    expect((await catalog.visitTypes("tn-north", "cl-sb")).map((v) => v.id)).not.toContain("sv-vision-n");
  });
  it("can add a visit type to a clinic that did not have it, but never across tenants", async () => {
    await admin.setClinicVisitType("tn-north", "cl-au", "sv-physio-n", true);
    expect((await catalog.visitTypes("tn-north", "cl-au")).map((v) => v.id)).toContain("sv-physio-n");
    await expect(admin.setClinicVisitType("tn-north", "cl-sb", "sv-pc-b", true)).rejects.toBeInstanceOf(AdminNotFoundError);
    await expect(admin.setClinicVisitType("tn-bay", "cl-sb", "sv-pc-n", true)).rejects.toBeInstanceOf(AdminNotFoundError);
  });
});

describe("availability and time off", () => {
  const rules = [{ weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 }, { weekday: 1, startMinute: 13 * 60, endMinute: 15 * 60 }, { weekday: 3, startMinute: 8 * 60, endMinute: 10 * 60 }];
  it("replaces a provider's weekly hours at a clinic atomically, and slots follow", async () => {
    await admin.setAvailability("tn-north", "pr-a", "cl-sb", rules);
    const slots = await sched.listSlots({ tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a" });
    const days = new Set(slots.map((s) => new Date(s.startsAt).getUTCDay()));
    expect([...days].sort()).toEqual([1, 3]);                                 // Monday and Wednesday only (all hours fall on the same UTC day in Los Angeles)
    expect(await admin.getAvailability("tn-north", "pr-a", "cl-sb")).toHaveLength(3);
  });
  it("rejects overlapping, inverted or out-of-range rules and leaves the old hours in place", async () => {
    const before = (await admin.getAvailability("tn-north", "pr-a", "cl-sb")).length;
    await expect(admin.setAvailability("tn-north", "pr-a", "cl-sb", [{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 700, endMinute: 800 }])).rejects.toBeInstanceOf(AdminValidationError);
    await expect(admin.setAvailability("tn-north", "pr-a", "cl-sb", [{ weekday: 1, startMinute: 720, endMinute: 540 }])).rejects.toBeInstanceOf(AdminValidationError);
    await expect(admin.setAvailability("tn-north", "pr-a", "cl-sb", [{ weekday: 7, startMinute: 0, endMinute: 60 }])).rejects.toBeInstanceOf(AdminValidationError);
    expect(await admin.getAvailability("tn-north", "pr-a", "cl-sb")).toHaveLength(before);
  });
  it("is tenant-scoped", async () => {
    await expect(admin.setAvailability("tn-bay", "pr-a", "cl-sb", rules)).rejects.toBeInstanceOf(AdminNotFoundError);
    await expect(admin.getAvailability("tn-bay", "pr-a", "cl-sb")).rejects.toBeInstanceOf(AdminNotFoundError);
  });
  it("adds and removes time off, which hides overlapping slots", async () => {
    const q = { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a" };
    const first = (await sched.listSlots(q))[0]!;
    const id = await admin.addTimeOff("tn-north", "pr-a", first.startsAt, first.endsAt);
    expect((await sched.listSlots(q)).map((s) => s.id)).not.toContain(first.id);
    await admin.removeTimeOff("tn-north", id);
    expect((await sched.listSlots(q)).map((s) => s.id)).toContain(first.id);
    await expect(admin.addTimeOff("tn-north", "pr-a", first.endsAt, first.startsAt)).rejects.toBeInstanceOf(AdminValidationError);
    await expect(admin.addTimeOff("tn-bay", "pr-a", first.startsAt, first.endsAt)).rejects.toBeInstanceOf(AdminNotFoundError);
    await expect(admin.removeTimeOff("tn-bay", id)).rejects.toBeInstanceOf(AdminNotFoundError);
  });
});
