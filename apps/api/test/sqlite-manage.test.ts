// Owner-approved spec: view, cancel and reschedule on the real scheduling engine (ADR-003). Fixed clock: Wed 2026-10-14 14:00Z.
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, seedDb, type Db } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";
import { SqliteScheduling } from "../src/sqlite-scheduling.js";
import { BookingNotFoundError, ChangeWindowClosedError, SlotTakenError } from "../src/scheduling.js";

const patient = { firstName: "Pat", lastName: "Example", email: "pat@example.test" };
const q = { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a" };
let db: Db; let now: Date; let s: SqliteScheduling;
const book = async (idx: number, key: string) => { const slot = (await s.listSlots(q))[idx]!; return { slot, rec: await s.reserve({ ...q, slotId: slot.id, idempotencyKey: key, patient }) }; };
beforeEach(() => { db = openDb(); seedDb(db, syntheticCatalog()); now = new Date("2026-10-14T14:00:00Z"); s = new SqliteScheduling(db, { now: () => now }); });

describe("viewing", () => {
  it("returns the booking the patient owns, without patient details", async () => {
    const { rec, slot } = await book(2, "key-manage-01");
    expect(rec.status).toBe("confirmed");
    const b = await s.getBooking("tn-north", rec.bookingId);
    expect(b).toEqual({ bookingId: rec.bookingId, tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", startsAt: slot.startsAt, endsAt: slot.endsAt, status: "confirmed" });
    expect(JSON.stringify(b)).not.toMatch(/Pat|Example|pat@/);
  });
  it("does not reveal bookings across tenants or unknown references", async () => {
    const { rec } = await book(0, "key-manage-02");
    expect(await s.getBooking("tn-bay", rec.bookingId)).toBeUndefined();
    expect(await s.getBooking("tn-north", "CX-0000-0000")).toBeUndefined();
  });
});

describe("cancelling", () => {
  it("cancels, frees the slot for others, and is idempotent", async () => {
    const { rec, slot } = await book(2, "key-manage-03");
    const c = await s.cancel("tn-north", rec.bookingId);
    expect(c.status).toBe("cancelled");
    expect((await s.listSlots(q)).map((x) => x.id)).toContain(slot.id);
    expect((await s.cancel("tn-north", rec.bookingId)).status).toBe("cancelled");
    expect((db.prepare("SELECT cancelled_at FROM appointments WHERE id = ?").get(rec.bookingId) as { cancelled_at: string | null }).cancelled_at).toBeTruthy();
    const again = await s.reserve({ ...q, slotId: slot.id, idempotencyKey: "key-manage-04", patient });   // someone else can now take it
    expect(again.bookingId).not.toBe(rec.bookingId);
  });
  it("reports a cancelled booking as cancelled when looked up by its original key", async () => {
    const { rec } = await book(2, "key-manage-05");
    await s.cancel("tn-north", rec.bookingId);
    expect(await s.lookupByKey("tn-north", "key-manage-05")).toMatchObject({ bookingId: rec.bookingId, status: "cancelled" });
  });
  it("refuses unknown bookings and other tenants' bookings with the same error", async () => {
    const { rec } = await book(2, "key-manage-06");
    await expect(s.cancel("tn-bay", rec.bookingId)).rejects.toBeInstanceOf(BookingNotFoundError);
    await expect(s.cancel("tn-north", "CX-0000-0000")).rejects.toBeInstanceOf(BookingNotFoundError);
  });
  it("refuses changes inside the notice window (default 120 minutes), inclusive at the boundary", async () => {
    const { rec } = await book(0, "key-manage-07");              // starts 16:00Z
    now = new Date("2026-10-14T14:00:00Z");                      // exactly 120 minutes before: still allowed
    expect((await s.cancel("tn-north", rec.bookingId)).status).toBe("cancelled");
    const { rec: r2 } = await book(2, "key-manage-08");          // starts 17:00Z
    now = new Date("2026-10-14T15:01:00Z");                      // 119 minutes before
    await expect(s.cancel("tn-north", r2.bookingId)).rejects.toBeInstanceOf(ChangeWindowClosedError);
    expect((await s.getBooking("tn-north", r2.bookingId))!.status).toBe("confirmed");
  });
  it("honours a configured notice window", async () => {
    const strict = new SqliteScheduling(db, { now: () => now, minChangeNoticeMinutes: 24 * 60 });
    const { rec } = await book(2, "key-manage-09");
    await expect(strict.cancel("tn-north", rec.bookingId)).rejects.toBeInstanceOf(ChangeWindowClosedError);
  });
});

describe("rescheduling", () => {
  it("moves the same booking to another offered slot, frees the old one, and keeps the reference", async () => {
    const { rec, slot } = await book(2, "key-manage-10");
    const target = (await s.listSlots(q))[10]!;
    const moved = await s.reschedule("tn-north", rec.bookingId, target.id);
    expect(moved).toMatchObject({ bookingId: rec.bookingId, startsAt: target.startsAt, endsAt: target.endsAt, status: "confirmed" });
    const ids = (await s.listSlots(q)).map((x) => x.id);
    expect(ids).toContain(slot.id); expect(ids).not.toContain(target.id);
    expect(await s.lookupByKey("tn-north", "key-manage-10")).toMatchObject({ bookingId: rec.bookingId, startsAt: target.startsAt, status: "confirmed" });
    expect((db.prepare("SELECT reschedule_count AS n FROM appointments WHERE id = ?").get(rec.bookingId) as { n: number }).n).toBe(1);
  });
  it("leaves the original booking untouched when the new slot is taken, never offered, or someone else's provider", async () => {
    const { rec, slot } = await book(2, "key-manage-11");
    const other = await s.reserve({ ...q, slotId: (await s.listSlots(q))[5]!.id, idempotencyKey: "key-manage-12", patient });
    await expect(s.reschedule("tn-north", rec.bookingId, other.slotId)).rejects.toBeInstanceOf(SlotTakenError);
    await expect(s.reschedule("tn-north", rec.bookingId, "tn-north:pr-a:20261014T1615")).rejects.toBeInstanceOf(SlotTakenError);
    await expect(s.reschedule("tn-north", rec.bookingId, "tn-north:pr-b:20261015T1500")).rejects.toBeInstanceOf(SlotTakenError);
    expect(await s.getBooking("tn-north", rec.bookingId)).toMatchObject({ startsAt: slot.startsAt, status: "confirmed" });
  });
  it("is a no-op success when moved to the slot it already holds", async () => {
    const { rec, slot } = await book(2, "key-manage-13");
    expect(await s.reschedule("tn-north", rec.bookingId, slot.id)).toMatchObject({ startsAt: slot.startsAt, status: "confirmed" });
  });
  it("refuses cancelled, unknown and cross-tenant bookings, and the notice window", async () => {
    const { rec } = await book(2, "key-manage-14");
    const target = (await s.listSlots(q))[10]!;
    await expect(s.reschedule("tn-bay", rec.bookingId, target.id)).rejects.toBeInstanceOf(BookingNotFoundError);
    await expect(s.reschedule("tn-north", "CX-0000-0000", target.id)).rejects.toBeInstanceOf(BookingNotFoundError);
    now = new Date("2026-10-14T15:30:00Z");
    await expect(s.reschedule("tn-north", rec.bookingId, target.id)).rejects.toBeInstanceOf(ChangeWindowClosedError);
    now = new Date("2026-10-14T14:00:00Z");
    await s.cancel("tn-north", rec.bookingId);
    await expect(s.reschedule("tn-north", rec.bookingId, target.id)).rejects.toBeInstanceOf(BookingNotFoundError);
  });
  it("lets only one of two concurrent reschedules claim the same slot", async () => {
    const a = await book(0, "key-manage-15"); const b = await book(2, "key-manage-16");
    const target = (await s.listSlots(q))[10]!;
    const res = await Promise.allSettled([s.reschedule("tn-north", a.rec.bookingId, target.id), s.reschedule("tn-north", b.rec.bookingId, target.id)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
