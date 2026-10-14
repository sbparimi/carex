// Owner-approved spec for apps/api/src/db-scheduling.ts, the CareX-native scheduling engine (ADR-002).
// Fixed clock: Wed 2026-10-14 14:00Z = 07:00 in America/Los_Angeles (PDT, UTC-7).
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, openTestDb, seedDb, type Db } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";
import { DbScheduling } from "../src/db-scheduling.js";
import { IdempotencyConflictError, SlotTakenError } from "../src/scheduling.js";

const NOW = "2026-10-14T14:00:00Z";
const patient = { firstName: "Pat", lastName: "Example", email: "pat@example.test" };
const q = (over: object = {}) => ({ tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", ...over });
const reserve = (s: DbScheduling, slotId: string, key: string, over: object = {}) => s.reserve({ ...q(), slotId, idempotencyKey: key, patient, ...over });
let db: Db; let now: Date; let s: DbScheduling;
const make = (opts: object = {}) => new DbScheduling(db, { now: () => now, ...opts });
beforeEach(async () => { db = await openTestDb(); await seedDb(db, syntheticCatalog()); now = new Date(NOW); s = make(); });

describe("slot generation from availability rules", () => {
  it("builds slots in the clinic's local working hours, converted to UTC", async () => {
    const slots = await s.listSlots(q());
    const wed = slots.filter((x) => x.startsAt.startsWith("2026-10-14"));
    expect(wed).toHaveLength(14);                                   // 09:00-12:00 (6) + 13:00-17:00 (8), 30 min each
    expect(wed[0]).toMatchObject({ startsAt: "2026-10-14T16:00:00.000Z", endsAt: "2026-10-14T16:30:00.000Z", timeZone: "America/Los_Angeles", providerId: "pr-a", clinicId: "cl-sb", serviceId: "sv-pc-n" });
    expect(wed[5]!.endsAt).toBe("2026-10-14T19:00:00.000Z");        // last morning slot ends at 12:00 local
    expect(wed[6]!.startsAt).toBe("2026-10-14T20:00:00.000Z");      // lunch gap, then 13:00 local
    expect(wed.at(-1)!.endsAt).toBe("2026-10-15T00:00:00.000Z");    // 17:00 local
  });
  it("is ordered, has unique ids in the documented format, and skips weekends", async () => {
    const slots = await s.listSlots(q());
    expect(slots.map((x) => x.startsAt)).toEqual([...slots.map((x) => x.startsAt)].sort());
    expect(new Set(slots.map((x) => x.id)).size).toBe(slots.length);
    expect(slots[0]!.id).toBe("tn-north:pr-a:20261014T1600");
    expect(slots.some((x) => ["2026-10-17", "2026-10-18"].includes(x.startsAt.slice(0, 10)))).toBe(false);
  });
  it("uses the visit type's duration and never lets a slot run past the working window", async () => {
    const slots = await s.listSlots(q({ serviceId: "sv-physio-n", providerId: "pr-b" }));
    const wed = slots.filter((x) => x.startsAt.startsWith("2026-10-14")).map((x) => x.startsAt.slice(11, 16));
    expect(wed).toEqual(["15:00", "15:45", "16:30", "17:15", "18:00"]);   // 08:00 local + 45 min steps; 11:45 would end at 12:30
  });
  it("honours the minimum lead time and the booking horizon", async () => {
    now = new Date("2026-10-14T15:45:00Z");                          // earliest allowed start is 16:45Z with the default 60 min lead
    const first = (await s.listSlots(q()))[0]!;
    expect(first.startsAt).toBe("2026-10-14T17:00:00.000Z");
    const far = await make({ horizonDays: 3, minLeadMinutes: 0 }).listSlots(q());
    expect(far.every((x) => Date.parse(x.startsAt) < now.getTime() + 3 * 86_400_000)).toBe(true);
    expect(far.length).toBeGreaterThan(0);
  });
  it("follows daylight-saving changes in the clinic's zone", async () => {
    now = new Date("2026-10-30T14:00:00Z");                          // Fri; clocks go back on Sun 2026-11-01
    const slots = await s.listSlots(q());
    expect(slots.find((x) => x.startsAt.startsWith("2026-10-30"))!.startsAt).toBe("2026-10-30T16:00:00.000Z");   // 09:00 PDT
    expect(slots.find((x) => x.startsAt.startsWith("2026-11-02"))!.startsAt).toBe("2026-11-02T17:00:00.000Z");   // 09:00 PST
  });
  it("removes slots that overlap provider time off", async () => {
    await db.run("INSERT INTO time_off (tenant_id, provider_id, starts_at, ends_at) VALUES (?,?,?,?)", "tn-north", "pr-a", "2026-10-14T16:15:00Z", "2026-10-14T17:00:00Z");
    const starts = (await s.listSlots(q())).map((x) => x.startsAt);
    expect(starts).not.toContain("2026-10-14T16:00:00.000Z");        // 16:00-16:30 overlaps the leave
    expect(starts).not.toContain("2026-10-14T16:30:00.000Z");
    expect(starts).toContain("2026-10-14T17:00:00.000Z");
  });
  it("returns nothing for a provider who does not work at that clinic, or a tenant that does not own them", async () => {
    expect(await s.listSlots(q({ clinicId: "cl-au" }))).toEqual([]);
    expect(await s.listSlots(q({ tenantId: "tn-bay" }))).toEqual([]);
    expect(await s.listSlots(q({ providerId: "pr-unknown" }))).toEqual([]);
  });
});

describe("booking (atomic, idempotent, durable)", () => {
  it("reserves a slot and returns the authoritative record", async () => {
    const slot = (await s.listSlots(q()))[0]!;
    const rec = await reserve(s, slot.id, "key-aaaaaaaa");
    expect(rec).toMatchObject({ tenantId: "tn-north", slotId: slot.id, idempotencyKey: "key-aaaaaaaa", startsAt: slot.startsAt, endsAt: slot.endsAt });
    expect(rec.bookingId).toBeTruthy();
    expect((await s.listSlots(q())).map((x) => x.id)).not.toContain(slot.id);
  });
  it("returns the same booking for a repeated key and request, and creates exactly one row", async () => {
    const slot = (await s.listSlots(q()))[0]!;
    const a = await reserve(s, slot.id, "key-bbbbbbbb");
    const b = await reserve(s, slot.id, "key-bbbbbbbb");
    expect(b.bookingId).toBe(a.bookingId);
    expect((await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM appointments"))!.n).toBe(1);
  });
  it("rejects a reused key with a different request", async () => {
    const slots = await s.listSlots(q());
    await reserve(s, slots[0]!.id, "key-cccccccc");
    await expect(reserve(s, slots[1]!.id, "key-cccccccc")).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
  it("lets only one of two concurrent bookings for the same slot succeed", async () => {
    const slot = (await s.listSlots(q()))[0]!;
    const results = await Promise.allSettled([reserve(s, slot.id, "key-dddddddd"), reserve(s, slot.id, "key-eeeeeeee")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(SlotTakenError);
  });
  it("refuses slots that overlap a confirmed appointment, but not adjacent ones", async () => {
    const physio = q({ serviceId: "sv-physio-n", providerId: "pr-b" });
    const slots = await s.listSlots(physio);
    await s.reserve({ ...physio, slotId: slots[1]!.id, idempotencyKey: "key-ffffffff", patient });   // 15:45-16:30Z
    const left = (await s.listSlots(physio)).filter((x) => x.startsAt.startsWith("2026-10-14")).map((x) => x.startsAt.slice(11, 16));
    expect(left).toEqual(["15:00", "16:30", "17:15", "18:00"]);      // adjacent 15:00 and 16:30 stay open
  });
  it("rejects slots that were never offered, are in the past, or belong to another tenant", async () => {
    await expect(reserve(s, "tn-north:pr-a:20261014T1615", "key-gggggggg")).rejects.toBeInstanceOf(SlotTakenError);   // off the grid
    await expect(reserve(s, "tn-north:pr-a:20261014T1000", "key-hhhhhhhh")).rejects.toBeInstanceOf(SlotTakenError);   // before now
    const slot = (await s.listSlots(q()))[0]!;
    await expect(reserve(s, slot.id, "key-iiiiiiii", { tenantId: "tn-bay" })).rejects.toBeInstanceOf(SlotTakenError);
  });
  it("finds a booking by key within its tenant only", async () => {
    const slot = (await s.listSlots(q()))[0]!;
    const rec = await reserve(s, slot.id, "key-jjjjjjjj");
    expect(await s.lookupByKey("tn-north", "key-jjjjjjjj")).toEqual(rec);
    expect(await s.lookupByKey("tn-bay", "key-jjjjjjjj")).toBeUndefined();
    expect(await s.lookupByKey("tn-north", "key-unknown1")).toBeUndefined();
  });
  it("survives a restart: bookings are durable and still block the slot", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "carex-pg-")), "data");
    const db1 = await openDb({ dir }); await seedDb(db1, syntheticCatalog());
    const s1 = new DbScheduling(db1, { now: () => now });
    const slot = (await s1.listSlots(q()))[0]!;
    const rec = await s1.reserve({ ...q(), slotId: slot.id, idempotencyKey: "key-kkkkkkkk", patient });
    await db1.close();
    const db2 = await openDb({ dir });
    const s2 = new DbScheduling(db2, { now: () => now });
    expect(await s2.lookupByKey("tn-north", "key-kkkkkkkk")).toEqual(rec);
    expect((await s2.listSlots(q())).map((x) => x.id)).not.toContain(slot.id);
    await db2.close();
  }, 60_000);
  it("the database itself refuses a second confirmed appointment for the same provider and start", async () => {
    const ins = (id: string, key: string) => db.run("INSERT INTO appointments (id, tenant_id, clinic_id, visit_type_id, provider_id, starts_at, ends_at, status, idempotency_key, request_hash, patient_first_name, patient_last_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, "tn-north", "cl-sb", "sv-pc-n", "pr-a", "2026-10-14T16:00:00.000Z", "2026-10-14T16:30:00.000Z", "confirmed", key, "h", "A", "B", NOW);
    await ins("a1", "k1");
    await expect(ins("a2", "k2")).rejects.toThrow();
  });
});
