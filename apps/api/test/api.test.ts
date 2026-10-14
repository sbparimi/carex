import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { openDb, seedDb, type Db } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";
import { SqliteCatalog } from "../src/sqlite-catalog.js";
import { SqliteScheduling } from "../src/sqlite-scheduling.js";
import { FaultInjectingScheduling } from "../src/fault-injection.js";
import { BookingService } from "../src/booking-service.js";
import { createServer } from "../src/server.js";

let server: Server; let base: string; let db: Db; let catalog: SqliteCatalog; let source: FaultInjectingScheduling; let bookings: BookingService;
const NOW = () => new Date("2026-11-02T08:00:00Z");   // Monday 00:00 in Los Angeles
const count = () => (db.prepare("SELECT COUNT(*) AS n FROM appointments").get() as { n: number }).n;
let logs: unknown[]; let events: Record<string, string>[];
const PATIENT = { firstName: "Pat", lastName: "Synthetic", email: "pat.synthetic@example.test" };

beforeEach(async () => {
  logs = []; events = [];
  db = openDb(); seedDb(db, syntheticCatalog());
  catalog = new SqliteCatalog(db);
  source = new FaultInjectingScheduling(new SqliteScheduling(db, { now: NOW }));
  bookings = new BookingService(catalog, source);
  server = createServer({ catalog, bookings, log: (e) => logs.push(e), telemetry: (e) => events.push(e) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

const get = async (path: string) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() as any, headers: r.headers }; };
const post = async (path: string, body: unknown, key: string | null = "key-00000001") => {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json() as any };
};
const NW = "/t/northwind-health/api";
const req = (slotId: string, over: object = {}) => ({ clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId, patient: PATIENT, confirmed: true, ...over });
const firstSlots = async () => (await get(`${NW}/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a`)).body.slots as { id: string }[];

describe("catalog filtering (FR-002..FR-005, BR-003..BR-005)", () => {
  it("shows only states with an active, bookable clinic", async () => {
    expect((await get(`${NW}/states`)).body.states).toEqual(["CA", "TX"]);                       // NY clinic is not bookable
    expect((await get(`/t/bayview-care/api/states`)).body.states).toEqual(["CA"]);
  });
  it("lists only active clinics in the state for the tenant", async () => {
    const names = (await get(`${NW}/clinics?state=CA`)).body.clinics.map((c: any) => c.name);
    expect(names).toEqual(["San Bernardo Clinic"]);                                                // not the inactive Fresno clinic, not another tenant's Oakland
    expect((await get(`${NW}/clinics?state=NY`)).body.clinics).toEqual([]);
  });
  it("offers only visit types switched on at that clinic", async () => {
    const labels = (await get(`${NW}/clinics/cl-sb/visit-types`)).body.visitTypes.map((v: any) => v.label).sort();
    expect(labels).toEqual(["Physio", "Primary Care"]);                                            // vision is configured but off; coaching is another clinic's
  });
  it("offers only active, eligible providers", async () => {
    expect((await get(`${NW}/providers?clinicId=cl-sb&serviceId=sv-pc-n`)).body.providers.map((p: any) => p.displayName)).toEqual(["Dr. Alex Example"]);
    expect((await get(`${NW}/providers?clinicId=cl-sb&serviceId=sv-physio-n`)).body.providers.map((p: any) => p.displayName)).toEqual(["Sam Sample, PT"]);
    expect((await get(`${NW}/providers?clinicId=cl-sb&serviceId=sv-fit-n`)).body.providers).toEqual([]);
  });
  it("returns provisional slots only for an eligible provider", async () => {
    const ok = await get(`${NW}/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a`);
    expect(ok.body.slots).toHaveLength(9); expect(ok.body.note).toMatch(/provisional/i);
    expect((await get(`${NW}/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-b`)).body.slots).toEqual([]);   // pr-b is not eligible for primary care
  });
});

describe("tenant isolation and safe errors (BR-001, BR-012, FR-001)", () => {
  it("never returns another tenant's data for the same ids", async () => {
    const other = "/t/bayview-care/api";
    expect((await get(`${other}/clinics/cl-sb/visit-types`)).body.visitTypes).toEqual([]);
    expect((await get(`${other}/providers?clinicId=cl-sb&serviceId=sv-pc-n`)).body.providers).toEqual([]);
    expect((await get(`${other}/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a`)).body.slots).toEqual([]);
    expect((await get(`${other}/clinics?state=CA`)).body.clinics.map((c: any) => c.id)).toEqual(["cl-oak"]);
  });
  it("cannot book another tenant's clinic or slot, and answers exactly like a missing one", async () => {
    const [s] = await firstSlots();
    const cross = await post("/t/bayview-care/api/bookings", req(s!.id));
    expect(cross.status).toBe(404); expect(cross.body).toEqual({ error: { code: "not_found", message: "Not found" } });
    expect(count()).toBe(0);
  });
  it("does not fall back when the tenant is unknown, suspended or malformed", async () => {
    const unknownRoute = await get(`/nope`);
    for (const slug of ["no-such-tenant", "dormant-clinic"]) {
      const r = await get(`/t/${slug}/api/states`);
      expect(r.status).toBe(404); expect(r.body).toEqual(unknownRoute.body);                       // indistinguishable from any other not-found
    }
    expect((await get(`/t/BAD%20SLUG/api/states`)).status).toBe(400);
    expect((await get(`/t/..%2F..%2Fetc/api/states`)).status).toBe(400);
  });
  it("rejects malformed query values before they reach the data layer", async () => {
    for (const p of [`${NW}/clinics?state=California`, `${NW}/clinics?state=`, `${NW}/clinics/${encodeURIComponent("x' OR 1=1--")}/visit-types`, `${NW}/providers?clinicId=a&serviceId=${"x".repeat(200)}`])
      expect((await get(p)).status, p).toBe(400);
  });
  it("sets no-store and a correlation id, and exposes only brand config", async () => {
    const r = await get(`${NW}/config`);
    expect(r.headers.get("cache-control")).toBe("no-store"); expect(r.headers.get("x-correlation-id")).toBeTruthy();
    expect(r.body.brand.primaryColor).toBe("#0b5fff"); expect(JSON.stringify(r.body)).not.toMatch(/tn-north|tenantId/);
  });
});

describe("booking integrity (FR-008, BR-006..BR-009, PRD §12)", () => {
  it("confirms only after the source confirms, with a full summary", async () => {
    const [s] = await firstSlots();
    const r = await post(`${NW}/bookings`, req(s!.id));
    expect(r.status).toBe(201); expect(r.body.status).toBe("confirmed"); expect(r.body.bookingId).toEqual(expect.any(String));
    expect(r.body.summary).toMatchObject({ clinic: { name: "San Bernardo Clinic", timeZone: "America/Los_Angeles" }, visitType: { label: "Primary Care" }, provider: { displayName: "Dr. Alex Example" } });
    expect(count()).toBe(1);
    expect((await firstSlots()).map((x) => x.id)).not.toContain(s!.id);                              // the slot left availability
  });
  it("requires explicit confirmation and an idempotency key", async () => {
    const [s] = await firstSlots();
    expect((await post(`${NW}/bookings`, req(s!.id, { confirmed: false }))).status).toBe(400);
    expect((await post(`${NW}/bookings`, { ...req(s!.id), confirmed: undefined }))).toMatchObject({ status: 400 });
    expect((await post(`${NW}/bookings`, req(s!.id), null)).status).toBe(400);
    expect((await post(`${NW}/bookings`, req(s!.id), "short")).status).toBe(400);
    expect(count()).toBe(0);
  });
  it("a duplicate submit with the same key returns the same booking and creates no second one", async () => {
    const [s] = await firstSlots();
    const a = await post(`${NW}/bookings`, req(s!.id)); const b = await post(`${NW}/bookings`, req(s!.id));
    expect(b.body.bookingId).toBe(a.body.bookingId); expect(count()).toBe(1);
  });
  it("concurrent duplicate submits share one attempt", async () => {
    bookings = new BookingService(catalog, source);
    const [s] = await bookings.slots("tn-north", "cl-sb", "sv-pc-n", "pr-a");
    const results = await Promise.all([1, 2, 3, 4].map(() => bookings.create("tn-north", req(s!.id), "key-concurrent")));
    expect(new Set(results.map((r) => r.status === "confirmed" && r.bookingId)).size).toBe(1);
    expect(count()).toBe(1);
  });
  it("the same key with a different request is refused", async () => {
    const [s1, s2] = await firstSlots();
    await post(`${NW}/bookings`, req(s1!.id));
    const r = await post(`${NW}/bookings`, req(s2!.id));
    expect(r.status).toBe(422); expect(r.body.error.code).toBe("idempotency_conflict");
  });
  it("a slot race produces exactly one booking; the loser gets alternatives without the taken slot", async () => {
    const [s] = await firstSlots();
    const [a, b] = await Promise.all([post(`${NW}/bookings`, req(s!.id), "key-racer-aaa"), post(`${NW}/bookings`, req(s!.id), "key-racer-bbb")]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]); expect(count()).toBe(1);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.status).toBe("slot_unavailable"); expect(loser.body.alternatives.map((x: any) => x.id)).not.toContain(s!.id);
  });
  it("rejects a slot that is not offered for the selection (stale or forged slot id)", async () => {
    const r = await post(`${NW}/bookings`, req("tn-north:pr-a:20300101T0000"));
    expect(r.status).toBe(409); expect(r.body.status).toBe("slot_unavailable"); expect(count()).toBe(0);
  });
  it("scheduling outage: failure is reported, nothing is claimed, and the same key can be retried", async () => {
    const [s] = await firstSlots(); source.injectFault("unavailable");
    const a = await post(`${NW}/bookings`, req(s!.id));
    expect(a.status).toBe(503); expect(a.body).toMatchObject({ status: "failed", retryable: true }); expect(count()).toBe(0);
    const b = await post(`${NW}/bookings`, req(s!.id));
    expect(b.status).toBe(201); expect(count()).toBe(1);
  });
  it("timeout AFTER commit: reported as pending, never confirmed; reconciliation finds the booking; retry does not double-book", async () => {
    const [s] = await firstSlots(); source.injectFault("timeout_after_commit");
    const a = await post(`${NW}/bookings`, req(s!.id));
    expect(a.status).toBe(202); expect(a.body.status).toBe("pending"); expect(JSON.stringify(a.body)).not.toMatch(/bookingId/);
    const rec = await get(`${NW}/bookings/by-key/key-00000001`);
    expect(rec.body).toMatchObject({ status: "confirmed", bookingId: expect.any(String) });
    const retry = await post(`${NW}/bookings`, req(s!.id));
    expect(retry.body.bookingId).toBe(rec.body.bookingId); expect(count()).toBe(1);
  });
  it("timeout BEFORE commit: stays pending until a safe retry succeeds", async () => {
    const [s] = await firstSlots(); source.injectFault("timeout_before_commit");
    expect((await post(`${NW}/bookings`, req(s!.id))).body.status).toBe("pending");
    expect((await get(`${NW}/bookings/by-key/key-00000001`)).body.status).toBe("pending");
    expect(count()).toBe(0);
    const retry = await post(`${NW}/bookings`, req(s!.id));
    expect(retry.body.status).toBe("confirmed"); expect(count()).toBe(1);
  });
  it("rejects oversized and non-JSON bodies, and never leaks internals on unexpected errors", async () => {
    expect((await post(`${NW}/bookings`, "x".repeat(20_000))).status).toBe(413);
    expect((await post(`${NW}/bookings`, "{not json")).status).toBe(400);
    const boom = createServer({ catalog: catalog, bookings: { create: async () => { throw new Error("db password=hunter2 at /srv/app.ts:42"); } } as unknown as BookingService });
    await new Promise<void>((r) => boom.listen(0, "127.0.0.1", r));
    const r = await fetch(`http://127.0.0.1:${(boom.address() as AddressInfo).port}${NW}/bookings`, { method: "POST", headers: { "idempotency-key": "key-00000001" }, body: JSON.stringify(req("x")) });
    const text = await r.text(); boom.close();
    expect(r.status).toBe(500); expect(text).not.toMatch(/hunter2|app\.ts/);
  });
});

describe("privacy: logs and telemetry (FR-010, BR-012)", () => {
  it("never writes patient details to logs or telemetry", async () => {
    const [s] = await firstSlots(); await post(`${NW}/bookings`, req(s!.id));
    const dump = JSON.stringify([logs, events]);
    for (const secret of ["Pat", "Synthetic", "pat.synthetic@example.test"]) expect(dump).not.toContain(secret);
    expect(logs.length).toBeGreaterThan(0);
    expect(events.map((e) => e.event)).toEqual(["booking_confirm_attempted", "booking_confirmed"]);
    for (const e of events) expect(Object.keys(e).every((k) => ["event", "tenantId", "correlationId", "errorCode", "step"].includes(k))).toBe(true);
  });
  it("emits nothing for a tenant with analytics disabled", async () => {
    const baySlots = await bookings.slots("tn-bay", "cl-oak", "sv-pc-b", "pr-z");
    const r = await post("/t/bayview-care/api/bookings", { clinicId: "cl-oak", serviceId: "sv-pc-b", providerId: "pr-z", slotId: baySlots[0]!.id, patient: PATIENT, confirmed: true });
    expect(r.status).toBe(201); expect(events).toEqual([]);
  });
});
