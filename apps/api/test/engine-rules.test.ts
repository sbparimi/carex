// P1 engine rules: per-visit lead/horizon, buffers, rooms, closures, age and new/established limits, richer statuses.
// Fixed clock: Wed 2026-10-14 14:00Z = 07:00 America/Los_Angeles.
import { describe, it, expect, beforeEach } from "vitest";
import { openTestDb, seedDb, type Db } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";
import { DbScheduling, ageOn } from "../src/db-scheduling.js";
import { SlotTakenError } from "../src/scheduling.js";

const patient = { firstName: "Pat", lastName: "Example", email: "pat@example.test" };
const q = (over: object = {}) => ({ tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", ...over });
let db: Db; let now: Date; let s: DbScheduling;
beforeEach(async () => { db = await openTestDb(); await seedDb(db, syntheticCatalog()); now = new Date("2026-10-14T14:00:00Z"); s = new DbScheduling(db, { now: () => now }); });
const reserve = (slotId: string, key: string, over: object = {}) => s.reserve({ ...q(), slotId, idempotencyKey: key, patient, ...over });
const mkUser = (id: string, dob: string) => db.run(
  "INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, date_of_birth, phone, access_type, employer_id, insurer_id, created_at) SELECT ?, 'tn-north', ?, 'x', 'A', 'B', ?, '555', 'employer', id, NULL, ? FROM employers WHERE tenant_id = 'tn-north' LIMIT 1", id, `${id}@x.test`, dob, now.toISOString());

describe("visit buffers", () => {
  it("keeps the buffer after a booked visit free for the same provider", async () => {
    await db.run("UPDATE visit_types SET buffer_after_min = 30 WHERE id = 'sv-pc-n'");
    const wed = (await s.listSlots(q())).filter((x) => x.startsAt.startsWith("2026-10-14"));
    await reserve(wed[0]!.id, "k1");
    const after = (await s.listSlots(q())).filter((x) => x.startsAt.startsWith("2026-10-14")).map((x) => x.startsAt.slice(11, 16));
    expect(after).not.toContain("16:00"); expect(after).not.toContain("16:30");   // booked + 30 min cleanup
    expect(after).toContain("17:00");
  });
  it("keeps the buffer before a visit free too", async () => {
    await db.run("UPDATE visit_types SET buffer_before_min = 30 WHERE id = 'sv-pc-n'");
    const wed = (await s.listSlots(q())).filter((x) => x.startsAt.startsWith("2026-10-14"));
    await reserve(wed[2]!.id, "k2");                                              // 17:00Z
    const t = (await s.listSlots(q())).filter((x) => x.startsAt.startsWith("2026-10-14")).map((x) => x.startsAt.slice(11, 16));
    expect(t).not.toContain("16:30"); expect(t).toContain("16:00");
  });
});

describe("per-visit lead time and horizon", () => {
  it("applies the visit's own lead and horizon over the defaults", async () => {
    await db.run("UPDATE visit_types SET min_lead_minutes = 24*60, horizon_days = 3 WHERE id = 'sv-pc-n'");
    const slots = await s.listSlots(q());
    expect(Date.parse(slots[0]!.startsAt)).toBeGreaterThanOrEqual(now.getTime() + 24 * 3600_000);
    expect(slots.every((x) => Date.parse(x.startsAt) < now.getTime() + 3 * 86_400_000)).toBe(true);
  });
});

describe("clinic closures", () => {
  it("removes every slot inside a closure, for every provider", async () => {
    await db.run("INSERT INTO clinic_closures (tenant_id, clinic_id, starts_at, ends_at, reason) VALUES ('tn-north','cl-sb','2026-10-15T07:00:00.000Z','2026-10-16T07:00:00.000Z','Holiday')");
    const slots = await s.listSlots(q());
    expect(slots.some((x) => x.startsAt.startsWith("2026-10-15"))).toBe(false);
    expect(slots.some((x) => x.startsAt.startsWith("2026-10-14"))).toBe(true);
  });
});

describe("rooms and resources", () => {
  it("offers a slot only while a room of the required kind is free, and assigns one", async () => {
    await db.run("UPDATE visit_types SET resource_kind = 'exam_room' WHERE id = 'sv-pc-n'");
    await db.run("INSERT INTO clinic_resources (id, tenant_id, clinic_id, kind, name) VALUES ('rm-1','tn-north','cl-sb','exam_room','Room 1')");
    const wed = (await s.listSlots(q())).filter((x) => x.startsAt.startsWith("2026-10-14"));
    expect(wed.length).toBeGreaterThan(0);
    await reserve(wed[0]!.id, "r1");
    const row = await db.get<{ resource_id: string }>("SELECT resource_id FROM appointments WHERE idempotency_key = 'r1'");
    expect(row!.resource_id).toBe("rm-1");
    // The single room is now taken at that time for any provider seeing that visit type.
    const other = await s.listSlots(q({ providerId: "pr-b" }));
    expect(other.some((x) => x.startsAt === wed[0]!.startsAt)).toBe(false);
  });
  it("offers nothing when the clinic has no room of that kind", async () => {
    await db.run("UPDATE visit_types SET resource_kind = 'imaging' WHERE id = 'sv-pc-n'");
    expect(await s.listSlots(q())).toEqual([]);
  });
});

describe("age and new/established rules", () => {
  it("computes age on the birthday boundary", () => {
    expect(ageOn("2008-10-14", new Date("2026-10-14T00:00:00Z"))).toBe(18);
    expect(ageOn("2008-10-15", new Date("2026-10-14T00:00:00Z"))).toBe(17);
  });
  it("refuses a booking outside the visit's age range", async () => {
    await db.run("UPDATE visit_types SET min_age = 65 WHERE id = 'sv-pc-n'");
    await mkUser("u-young", "1990-01-01"); await mkUser("u-old", "1950-01-01");
    const slot = (await s.listSlots(q()))[0]!;
    await expect(reserve(slot.id, "a1", { userId: "u-young" })).rejects.toBeInstanceOf(SlotTakenError);
    await expect(reserve(slot.id, "a1", { userId: "" })).rejects.toBeInstanceOf(SlotTakenError);
    expect((await reserve(slot.id, "a2", { userId: "u-old" })).status).toBe("confirmed");
  });
  it("limits new-patient and established-patient visits", async () => {
    await mkUser("u-new", "1985-05-05");
    await db.run("UPDATE visit_types SET new_patients = 'established_only' WHERE id = 'sv-pc-n'");
    const slot = (await s.listSlots(q()))[0]!;
    await expect(reserve(slot.id, "n1", { userId: "u-new" })).rejects.toBeInstanceOf(SlotTakenError);
    await db.run("UPDATE visit_types SET new_patients = 'new_only' WHERE id = 'sv-pc-n'");
    expect((await reserve(slot.id, "n2", { userId: "u-new" })).status).toBe("confirmed");
  });
});

describe("appointment lifecycle statuses", () => {
  it("keeps arrived, completed and no-show appointments blocking their slot", async () => {
    const slot = (await s.listSlots(q()))[0]!;
    const rec = await reserve(slot.id, "l1");
    for (const st of ["arrived", "completed", "no_show"]) {
      await db.run("UPDATE appointments SET status = ? WHERE id = ?", st, rec.bookingId);
      expect((await s.listSlots(q())).some((x) => x.id === slot.id)).toBe(false);
    }
    await db.run("UPDATE appointments SET status = 'cancelled' WHERE id = ?", rec.bookingId);
    expect((await s.listSlots(q())).some((x) => x.id === slot.id)).toBe(true);
  });
});
