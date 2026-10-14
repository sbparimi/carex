// Signed-in account: booking, viewing, cancelling and rescheduling its OWN appointments; rate limiting and response hardening.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startApi, NOW, type Api, type Client } from "./helpers.js";

const NW = "/t/northwind-health/api";
let api: Api; let me: Client; let other: Client; let now: Date;

beforeEach(async () => {
  now = new Date(NOW);
  api = await startApi({ now: () => now });
  me = api.client(); other = api.client();
  expect((await me.signup("northwind-health")).status).toBe(201);
  expect((await other.signup("northwind-health", { email: "someone.else@example.test", firstName: "Sam", lastName: "Other" })).status).toBe(201);
});
afterEach(() => api.close());

const slots = async (c: Client = me) => (await c.get(`${NW}/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a`)).body.slots as { id: string; startsAt: string }[];
let n = 0;
const book = (slotId: string, c: Client = me, key = `key-api-${++n}-xxxxxxxx`) =>
  c.post(`${NW}/bookings`, { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId, confirmed: true }, { "idempotency-key": key });

describe("booking requires a signed-in account", () => {
  it("answers 401 for every booking and catalogue route without a session, but branding stays public", async () => {
    const anon = api.client();
    for (const p of ["states", "clinics?state=CA", "clinics/cl-sb/visit-types", "providers?clinicId=cl-sb&serviceId=sv-pc-n", "slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a", "bookings", "bookings/CX-AAAA-BBBB"])
      expect((await anon.get(`${NW}/${p}`)).status, p).toBe(401);
    expect((await anon.post(`${NW}/bookings`, { confirmed: true }, { "idempotency-key": "key-anon-0001" })).status).toBe(401);
    expect((await anon.get(`${NW}/config`)).status).toBe(200);
  });
  it("uses the account's details, not the request body, as the patient", async () => {
    const [s] = await slots();
    const r = await me.post(`${NW}/bookings`, { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: s!.id, confirmed: true, patient: { firstName: "Mallory", lastName: "Forged", email: "mallory@example.test" } }, { "idempotency-key": "key-forged-0001" });
    expect(r.status).toBe(201);
    const row = await api.app.db.get<{ patient_first_name: string; patient_email: string; user_id: string }>("SELECT patient_first_name, patient_email, user_id FROM appointments WHERE id = ?", r.body.bookingId);
    expect(row).toMatchObject({ patient_first_name: "Pat", patient_email: "pat.synthetic@example.test" });
    expect(row!.user_id).toBeTruthy();
  });
  it("a session of one tenant is useless in another", async () => {
    const r = await me.call("GET", `/t/bayview-care/api/states`, undefined, { cookie: me.jar.get("northwind-health")! });
    expect(r.status).toBe(401);
  });
});

describe("my appointments", () => {
  it("lists only my own appointments, soonest first", async () => {
    const all = await slots(); await book(all[5]!.id); await book(all[3]!.id); await book(all[4]!.id, other);
    const mine = (await me.get(`${NW}/bookings`)).body.appointments;
    expect(mine.map((a: any) => a.summary.startsAt)).toEqual([all[3]!.startsAt, all[5]!.startsAt]);
    expect((await other.get(`${NW}/bookings`)).body.appointments).toHaveLength(1);
  });
  it("views one appointment, without any patient details", async () => {
    const [s] = await slots(); const a = await book(s!.id);
    const r = await me.get(`${NW}/bookings/${a.body.bookingId}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ bookingId: a.body.bookingId, status: "confirmed", canChange: true, changeNoticeMinutes: 120, summary: { clinic: { id: "cl-sb" }, provider: { displayName: "Dr. Alex Example" }, startsAt: s!.startsAt } });
    expect(r.text).not.toMatch(/Synthetic|pat\.synthetic|Pat\b/);
  });
  it("another user's appointment answers exactly like an unknown one, for view, cancel and reschedule", async () => {
    const all = await slots(); const a = await book(all[3]!.id); const id = a.body.bookingId as string;
    const unknown = await other.get(`${NW}/bookings/CX-0000-0000`);
    for (const r of [await other.get(`${NW}/bookings/${id}`), await other.post(`${NW}/bookings/${id}/cancel`), await other.post(`${NW}/bookings/${id}/reschedule`, { slotId: all[20]!.id }), unknown]) {
      expect(r.status).toBe(404); expect(r.body).toEqual({ error: { code: "not_found", message: "Not found" } });
    }
    expect((await me.get(`${NW}/bookings/${id}`)).body.status).toBe("confirmed");
  });
  it("another tenant cannot see it either", async () => {
    const [s] = await slots(); const a = await book(s!.id);
    const bay = api.client(); await bay.signup("bayview-care");
    expect((await bay.get(`/t/bayview-care/api/bookings/${a.body.bookingId}`)).status).toBe(404);
  });
});

describe("cancelling and rescheduling", () => {
  it("cancel releases the slot and is idempotent", async () => {
    const all = await slots(); const a = await book(all[3]!.id);
    const c = await me.post(`${NW}/bookings/${a.body.bookingId}/cancel`);
    expect(c.status).toBe(200); expect(c.body).toMatchObject({ status: "cancelled", canChange: false });
    expect((await slots()).map((x) => x.id)).toContain(all[3]!.id);
    expect((await me.post(`${NW}/bookings/${a.body.bookingId}/cancel`)).body.status).toBe("cancelled");
    expect((await me.get(`${NW}/bookings/by-key/key-api-${n}-xxxxxxxx`)).body.status).not.toBe("confirmed");
  });
  it("replaying the original request after a cancel does not resurrect or re-confirm it", async () => {
    const all = await slots(); const key = "key-resurrect-01";
    const a = await book(all[3]!.id, me, key);
    await me.post(`${NW}/bookings/${a.body.bookingId}/cancel`);
    const again = await book(all[3]!.id, me, key);
    expect(again.status).toBe(409); expect(again.body).toMatchObject({ status: "failed", code: "booking_cancelled", retryable: false });
    expect((await slots()).map((x) => x.id)).toContain(all[3]!.id);
  });
  it("a replay after the booking was moved reports the current time, not the original one", async () => {
    const all = await slots(); const key = "key-moved-000001";
    const a = await book(all[3]!.id, me, key);
    await me.post(`${NW}/bookings/${a.body.bookingId}/reschedule`, { slotId: all[20]!.id });
    await book(all[3]!.id, other);
    const again = await book(all[3]!.id, me, key);
    expect(again.body).toMatchObject({ status: "confirmed", bookingId: a.body.bookingId, summary: { startsAt: all[20]!.startsAt } });
  });
  it("reschedule moves the booking, keeps the reference, and frees the old time", async () => {
    const all = await slots(); const a = await book(all[3]!.id);
    const r = await me.post(`${NW}/bookings/${a.body.bookingId}/reschedule`, { slotId: all[20]!.id });
    expect(r.status).toBe(200); expect(r.body.status).toBe("rescheduled");
    expect(r.body.appointment).toMatchObject({ bookingId: a.body.bookingId, status: "confirmed", summary: { startsAt: all[20]!.startsAt } });
    expect((await slots()).map((x) => x.id)).toContain(all[3]!.id);
  });
  it("reschedule to a taken or invalid time is refused and changes nothing", async () => {
    const all = await slots(); const a = await book(all[3]!.id); await book(all[4]!.id, other);
    const taken = await me.post(`${NW}/bookings/${a.body.bookingId}/reschedule`, { slotId: all[4]!.id });
    expect(taken.status).toBe(409); expect(taken.body).toMatchObject({ status: "slot_unavailable" }); expect(taken.body.alternatives.length).toBeGreaterThan(0);
    expect((await me.post(`${NW}/bookings/${a.body.bookingId}/reschedule`, { nope: 1 })).status).toBe(400);
    expect((await me.get(`${NW}/bookings/${a.body.bookingId}`)).body.summary.startsAt).toBe(all[3]!.startsAt);
  });
  it("refuses changes inside the notice window with a clear code, and reports canChange=false", async () => {
    const all = await slots(); const a = await book(all[0]!.id);
    now = new Date(Date.parse(all[0]!.startsAt) - 60 * 60_000);
    expect((await me.get(`${NW}/bookings/${a.body.bookingId}`)).body.canChange).toBe(false);
    const c = await me.post(`${NW}/bookings/${a.body.bookingId}/cancel`);
    expect(c.status).toBe(409); expect(c.body.error.code).toBe("change_window_closed");
    expect((await me.get(`${NW}/bookings/${a.body.bookingId}`)).body.status).toBe("confirmed");
  });
});

describe("rate limiting and CSRF", () => {
  it("limits writes per client with 429 and Retry-After; reads have their own budget", async () => {
    await api.close(); api = await startApi({ now: () => now, limits: { write: { limit: 3, windowMs: 60_000 } } });
    me = api.client();
    expect((await me.signup("northwind-health")).status).toBe(201);          // write 1
    const bad = () => me.post(`${NW}/bookings`, {}, { "idempotency-key": "key-limit-0001" });
    expect((await bad()).status).toBe(400);                                   // write 2
    expect((await bad()).status).toBe(400);                                   // write 3
    const fourth = await bad();
    expect(fourth.status).toBe(429); expect(fourth.body.error.code).toBe("rate_limited"); expect(Number(fourth.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await me.get(`${NW}/states`)).status).toBe(200);
  });
  it("refuses state-changing requests that come from another origin", async () => {
    const [s] = await slots();
    const r = await me.post(`${NW}/bookings`, { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: s!.id, confirmed: true }, { "idempotency-key": "key-csrf-00001", origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect((await api.app.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM appointments"))!.n).toBe(0);
  });
});

describe("response hardening", () => {
  it("sets security headers on API, page and asset responses; the page CSP forbids inline script and style", async () => {
    const api1 = await me.get(`${NW}/states`);
    expect(api1.headers.get("x-content-type-options")).toBe("nosniff"); expect(api1.headers.get("x-frame-options")).toBe("DENY");
    expect(api1.headers.get("cache-control")).toBe("no-store"); expect(api1.headers.get("referrer-policy")).toBe("no-referrer");
    for (const path of ["/t/northwind-health/", "/t/northwind-health/appointments", "/t/northwind-health/login", "/t/northwind-health/signup", "/t/northwind-health/forgot", "/t/northwind-health/reset"]) {
      const page = await me.get(path);
      expect(page.status, path).toBe(200);
      const csp = page.headers.get("content-security-policy")!;
      expect(csp).toMatch(/default-src 'none'/); expect(csp).toMatch(/script-src 'self'/); expect(csp).toMatch(/frame-ancestors 'none'/);
      expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
      expect(page.headers.get("x-frame-options")).toBe("DENY");
    }
    const css = await fetch(api.base + "/assets/app.css"); expect(css.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
