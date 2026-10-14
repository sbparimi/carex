// Guest "manage my appointment" API, rate limiting and response hardening, against the real engine.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildApp } from "../src/index.js";
import { seedDb } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";

const SECRET = "api-test-secret-api-test-secret-0123456789";
const NW = "/t/northwind-health/api";
const PATIENT = { firstName: "Pat", lastName: "Synthetic", email: "pat.synthetic@example.test" };
let server: Server; let base: string; let now: Date; let app: ReturnType<typeof buildApp>;

async function start(extra: object = {}) {
  now = new Date("2026-11-02T08:00:00Z");                 // Monday 00:00 in Los Angeles
  app = buildApp({ dbPath: ":memory:", now: () => now, manageSecret: SECRET, staticDir: new URL("../../web/public", import.meta.url).pathname, ...extra });
  seedDb(app.db, syntheticCatalog());
  server = app.server; await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(() => start());
afterEach(() => new Promise<void>((r) => server.close(() => r())));

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: r.status, body: json, text, headers: r.headers };
};
const slots = async () => (await call("GET", `${NW}/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a`)).body.slots as { id: string; startsAt: string }[];
let n = 0;
const book = async (slotId: string) => {
  const r = await call("POST", `${NW}/bookings`, { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId, patient: PATIENT, confirmed: true }, { "idempotency-key": `key-api-${++n}-xxxxxxxx` });
  return r;
};
const asManager = (id: string, token: string) => ({ "x-manage-token": token, id });

describe("manage token issuance", () => {
  it("is returned with a confirmed booking, is stable on replay, and is not returned for failures", async () => {
    const [s] = await slots();
    const key = "key-replay-0001";
    const post = () => call("POST", `${NW}/bookings`, { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: s!.id, patient: PATIENT, confirmed: true }, { "idempotency-key": key });
    const a = await post(); const b = await post();
    expect(a.status).toBe(201); expect(a.body.manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b.body.manageToken).toBe(a.body.manageToken);
    const taken = await book(s!.id);
    expect(taken.status).toBe(409); expect(taken.body.manageToken).toBeUndefined();
  });
  it("is also returned by the by-key reconciliation endpoint", async () => {
    const [s] = await slots(); const a = await book(s!.id);
    const key = `key-api-${n}-xxxxxxxx`;
    const r = await call("GET", `${NW}/bookings/by-key/${key}`);
    expect(r.body).toMatchObject({ status: "confirmed", bookingId: a.body.bookingId, manageToken: a.body.manageToken });
  });
});

describe("viewing a booking", () => {
  it("returns the appointment, without patient details, for the right token", async () => {
    const [s] = await slots(); const a = await book(s!.id);
    const r = await call("GET", `${NW}/bookings/${a.body.bookingId}`, undefined, { "x-manage-token": a.body.manageToken });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ bookingId: a.body.bookingId, status: "confirmed", canChange: true, changeNoticeMinutes: 120, summary: { clinic: { id: "cl-sb" }, provider: { displayName: "Dr. Alex Example" }, startsAt: s!.startsAt } });
    expect(r.text).not.toMatch(/Synthetic|pat\.synthetic|Pat\b/);
  });
  it("answers a missing, wrong, truncated or other-tenant token exactly like an unknown booking", async () => {
    const [s] = await slots(); const a = await book(s!.id); const id = a.body.bookingId as string;
    const unknown = await call("GET", `${NW}/bookings/CX-0000-0000`, undefined, { "x-manage-token": a.body.manageToken });
    const cases = [
      await call("GET", `${NW}/bookings/${id}`),
      await call("GET", `${NW}/bookings/${id}`, undefined, { "x-manage-token": "x".repeat(43) }),
      await call("GET", `${NW}/bookings/${id}`, undefined, { "x-manage-token": (a.body.manageToken as string).slice(0, 20) }),
      await call("GET", `/t/bayview-care/api/bookings/${id}`, undefined, { "x-manage-token": a.body.manageToken }),
      unknown,
    ];
    for (const c of cases) { expect(c.status).toBe(404); expect(c.body).toEqual({ error: { code: "not_found", message: "Not found" } }); }
  });
  it("is disabled (404) when the server has no manage secret", async () => {
    await new Promise<void>((r) => server.close(() => r())); await start({ manageSecret: undefined });
    const [s] = await slots(); const a = await book(s!.id);
    expect(a.body.manageToken).toBeUndefined();
    expect((await call("GET", `${NW}/bookings/${a.body.bookingId}`, undefined, { "x-manage-token": "x".repeat(43) })).status).toBe(404);
  });
});

describe("cancelling and rescheduling", () => {
  it("cancel releases the slot and is idempotent", async () => {
    const all = await slots(); const a = await book(all[3]!.id); const h = { "x-manage-token": a.body.manageToken };
    const c = await call("POST", `${NW}/bookings/${a.body.bookingId}/cancel`, undefined, h);
    expect(c.status).toBe(200); expect(c.body).toMatchObject({ status: "cancelled", canChange: false });
    expect((await slots()).map((x) => x.id)).toContain(all[3]!.id);
    expect((await call("POST", `${NW}/bookings/${a.body.bookingId}/cancel`, undefined, h)).body.status).toBe("cancelled");
    expect((await call("GET", `${NW}/bookings/by-key/key-api-${n}-xxxxxxxx`)).body.status).not.toBe("confirmed");   // a cancelled booking is never reported as confirmed
  });
  it("replaying the original request after a cancel does not resurrect or re-confirm it", async () => {
    const all = await slots(); const key = "key-resurrect-01"; const body = { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: all[3]!.id, patient: PATIENT, confirmed: true };
    const a = await call("POST", `${NW}/bookings`, body, { "idempotency-key": key });
    await call("POST", `${NW}/bookings/${a.body.bookingId}/cancel`, undefined, { "x-manage-token": a.body.manageToken });
    const again = await call("POST", `${NW}/bookings`, body, { "idempotency-key": key });
    expect(again.status).toBe(409); expect(again.body).toMatchObject({ status: "failed", code: "booking_cancelled", retryable: false });
    expect((await slots()).map((x) => x.id)).toContain(all[3]!.id);               // the slot stays free
  });
  it("a replay after the booking was moved reports the current time, not the original one", async () => {
    const all = await slots(); const key = "key-moved-000001"; const body = { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: all[3]!.id, patient: PATIENT, confirmed: true };
    const a = await call("POST", `${NW}/bookings`, body, { "idempotency-key": key });
    await call("POST", `${NW}/bookings/${a.body.bookingId}/reschedule`, { slotId: all[20]!.id }, { "x-manage-token": a.body.manageToken });
    await book(all[3]!.id);                                                         // someone else takes the original time
    const again = await call("POST", `${NW}/bookings`, body, { "idempotency-key": key });
    expect(again.body).toMatchObject({ status: "confirmed", bookingId: a.body.bookingId, summary: { startsAt: all[20]!.startsAt } });
  });
  it("reschedule moves the booking, keeps the reference, and frees the old time", async () => {
    const all = await slots(); const a = await book(all[3]!.id); const h = { "x-manage-token": a.body.manageToken };
    const r = await call("POST", `${NW}/bookings/${a.body.bookingId}/reschedule`, { slotId: all[20]!.id }, h);
    expect(r.status).toBe(200); expect(r.body.status).toBe("rescheduled");
    expect(r.body.appointment).toMatchObject({ bookingId: a.body.bookingId, status: "confirmed", summary: { startsAt: all[20]!.startsAt } });
    expect((await slots()).map((x) => x.id)).toContain(all[3]!.id);
  });
  it("reschedule to a taken or invalid time is refused and changes nothing", async () => {
    const all = await slots(); const a = await book(all[3]!.id); await book(all[4]!.id); const h = { "x-manage-token": a.body.manageToken };
    const taken = await call("POST", `${NW}/bookings/${a.body.bookingId}/reschedule`, { slotId: all[4]!.id }, h);
    expect(taken.status).toBe(409); expect(taken.body).toMatchObject({ status: "slot_unavailable" }); expect(taken.body.alternatives.length).toBeGreaterThan(0);
    expect((await call("POST", `${NW}/bookings/${a.body.bookingId}/reschedule`, { nope: 1 }, h)).status).toBe(400);
    expect((await call("GET", `${NW}/bookings/${a.body.bookingId}`, undefined, h)).body.summary.startsAt).toBe(all[3]!.startsAt);
  });
  it("refuses changes inside the notice window with a clear code, and reports canChange=false", async () => {
    const all = await slots(); const a = await book(all[0]!.id); const h = { "x-manage-token": a.body.manageToken };
    now = new Date(Date.parse(all[0]!.startsAt) - 60 * 60_000);             // one hour before the start
    expect((await call("GET", `${NW}/bookings/${a.body.bookingId}`, undefined, h)).body.canChange).toBe(false);
    const c = await call("POST", `${NW}/bookings/${a.body.bookingId}/cancel`, undefined, h);
    expect(c.status).toBe(409); expect(c.body.error.code).toBe("change_window_closed");
    expect((await call("GET", `${NW}/bookings/${a.body.bookingId}`, undefined, h)).body.status).toBe("confirmed");
  });
  it("never lets one tenant's token act on another tenant's booking", async () => {
    const all = await slots(); const a = await book(all[3]!.id);
    const r = await call("POST", `/t/bayview-care/api/bookings/${a.body.bookingId}/cancel`, undefined, { "x-manage-token": a.body.manageToken });
    expect(r.status).toBe(404);
    expect((await call("GET", `${NW}/bookings/${a.body.bookingId}`, undefined, { "x-manage-token": a.body.manageToken })).body.status).toBe("confirmed");
  });
});

describe("rate limiting", () => {
  it("limits writes per client with 429 and Retry-After, then recovers after the window", async () => {
    await new Promise<void>((r) => server.close(() => r())); await start({ limits: { write: { limit: 2, windowMs: 60_000 } } });
    const bad = () => call("POST", `${NW}/bookings`, {}, { "idempotency-key": "key-limit-0001" });
    expect((await bad()).status).toBe(400); expect((await bad()).status).toBe(400);
    const third = await bad();
    expect(third.status).toBe(429); expect(third.body.error.code).toBe("rate_limited"); expect(Number(third.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await call("GET", `${NW}/states`)).status).toBe(200);            // reads have their own budget
  });
  it("throttles token guessing against one booking reference", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await call("GET", `${NW}/bookings/CX-AAAA-BBBB`, undefined, { "x-manage-token": "x".repeat(43) })).status);
    expect(codes.slice(0, 10).every((c) => c === 404)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});

describe("response hardening", () => {
  it("sets security headers on API, page and asset responses; the page CSP forbids inline script and style", async () => {
    const api = await call("GET", `${NW}/states`);
    expect(api.headers.get("x-content-type-options")).toBe("nosniff"); expect(api.headers.get("x-frame-options")).toBe("DENY");
    expect(api.headers.get("cache-control")).toBe("no-store"); expect(api.headers.get("referrer-policy")).toBe("no-referrer");
    for (const path of ["/t/northwind-health/", "/t/northwind-health/manage"]) {
      const page = await call("GET", path);
      expect(page.status).toBe(200);
      const csp = page.headers.get("content-security-policy")!;
      expect(csp).toMatch(/default-src 'none'/); expect(csp).toMatch(/script-src 'self'/); expect(csp).toMatch(/frame-ancestors 'none'/);
      expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
      expect(page.headers.get("x-frame-options")).toBe("DENY");
    }
    expect((await call("GET", "/t/northwind-health/manage")).text).toContain("/assets/manage.js");
    const css = await fetch(base + "/assets/app.css"); expect(css.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
