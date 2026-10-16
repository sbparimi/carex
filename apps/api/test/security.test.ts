// P4: audit trail, session idle/absolute limits, optional one-time-code sign-in.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startApi, NOW, PASSWORD, type Api, type Client } from "./helpers.js";

const NW = "/t/northwind-health/api";
let api: Api; let me: Client; let now: Date; let codes: string[];
const sql = (q: string, ...p: unknown[]) => api.app.db.run(q, ...p);
const rows = (q: string, ...p: unknown[]) => api.app.db.all<any>(q, ...p);
const mailer = { async sendPasswordReset() {}, async sendLoginCode(_to: string, _t: string, code: string) { codes.push(code); } };

beforeEach(async () => {
  now = new Date(NOW); codes = [];
  api = await startApi({ now: () => now, mailer });
  me = api.client(); expect((await me.signup("northwind-health")).status).toBe(201);
});
afterEach(() => api.close());
const min = (m: number) => { now = new Date(now.getTime() + m * 60_000); };
const slots = async (c: Client = me) => (await c.get(`${NW}/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a`)).body.slots as { id: string }[];
const book = (slotId: string) => me.post(`${NW}/bookings`, { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId, confirmed: true }, { "idempotency-key": "key-sec-0001-xxxxxxxx" });

describe("audit trail", () => {
  it("records sign-up, sign-in, failed sign-in, booking access and changes, without secrets", async () => {
    const other = api.client();
    expect((await other.call("POST", `${NW}/auth/login`, { email: "pat.synthetic@example.test", password: "wrong password" })).status).toBe(401);
    expect((await me.post(`${NW}/auth/logout`)).status).toBe(204);
    expect((await me.call("POST", `${NW}/auth/login`, { email: "pat.synthetic@example.test", password: PASSWORD })).status).toBe(200);
    const b = await book((await slots())[0]!.id);
    await me.get(`${NW}/bookings`); await me.get(`${NW}/bookings/${b.body.bookingId}`);
    await me.post(`${NW}/bookings/${b.body.bookingId}/cancel`, { reason: "private reason text" });
    const log = await rows("SELECT actor_type, actor_id, action, target_type, target_id, ip_hash, detail FROM audit_log ORDER BY id");
    expect(log.map((x) => x.action)).toEqual(["auth.signup", "auth.login_failed", "auth.logout", "auth.login", "booking.create", "booking.list", "booking.view", "booking.cancel"]);
    expect(log.find((x) => x.action === "booking.view")).toMatchObject({ actor_type: "user", target_type: "appointment", target_id: b.body.bookingId });
    expect(log[1]!.actor_type).toBe("anonymous");
    const dump = JSON.stringify(log);
    for (const secret of [PASSWORD, "wrong password", "private reason text", "pat.synthetic@example.test", "127.0.0.1"]) expect(dump).not.toContain(secret);
    expect(log.every((x) => /^[0-9a-f]{16}$/.test(x.ip_hash))).toBe(true);
  });
  it("records an emergency stop", async () => {
    await sql("UPDATE tenants SET intake_required = 1 WHERE id = 'tn-north'");
    const r = await me.post(`${NW}/bookings`, { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: (await slots())[0]!.id, confirmed: true, reason: "chest pain", redFlags: [], consentVersion: "v1" }, { "idempotency-key": "key-sec-0002-xxxxxxxx" });
    expect(r.body.code).toBe("emergency_redirect");
    expect((await rows("SELECT action FROM audit_log WHERE action = 'booking.emergency_redirect'"))).toHaveLength(1);
  });
});

describe("session limits", () => {
  it("signs out after 30 idle minutes but not while active", async () => {
    min(29); expect((await me.get(`${NW}/auth/me`)).status).toBe(200);
    min(29); expect((await me.get(`${NW}/auth/me`)).status).toBe(200);          // activity extended it
    min(31); expect((await me.get(`${NW}/auth/me`)).status).toBe(401);
    expect(await rows("SELECT 1 FROM sessions")).toHaveLength(0);                // and the dead session is removed
  });
  it("follows the tenant's idle setting", async () => {
    await sql("UPDATE tenants SET session_idle_minutes = 5 WHERE id = 'tn-north'");
    min(6); expect((await me.get(`${NW}/auth/me`)).status).toBe(401);
  });
  it("ends every session after 24 hours even if the person stays active", async () => {
    for (let i = 0; i < 90; i++) { min(20); const r = await me.get(`${NW}/states`); if (now.getTime() - NOW.getTime() >= 24 * 3_600_000) { expect(r.status).toBe(401); return; } expect(r.status).toBe(200); }
    throw new Error("session never expired");
  });
});

describe("one-time-code sign-in (tenants that require it)", () => {
  beforeEach(async () => { await sql("UPDATE tenants SET mfa_required = 1 WHERE id = 'tn-north'"); });
  const start = async (c = api.client()) => { const r = await c.call("POST", `${NW}/auth/login`, { email: "pat.synthetic@example.test", password: PASSWORD }); return { c, r }; };
  it("withholds the session until the emailed code is entered", async () => {
    const { c, r } = await start();
    expect(r.status).toBe(200); expect(r.body.mfa.required).toBe(true); expect(r.body.user).toBeUndefined();
    expect(r.headers.get("set-cookie")).toBeNull();
    expect((await c.get(`${NW}/auth/me`)).status).toBe(401);
    expect(codes).toHaveLength(1); expect(codes[0]).toMatch(/^\d{6}$/);
    const ok = await c.call("POST", `${NW}/auth/verify-login`, { challenge: r.body.mfa.challenge, code: codes[0] });
    expect(ok.status).toBe(200); expect(ok.body.user.email).toBe("pat.synthetic@example.test");
    expect((await c.get(`${NW}/auth/me`)).status).toBe(200);
    expect((await api.client().call("POST", `${NW}/auth/verify-login`, { challenge: r.body.mfa.challenge, code: codes[0] })).status).toBe(401);   // single use
  });
  it("rejects a wrong code and locks the challenge after five tries", async () => {
    const { c, r } = await start();
    const wrong = codes[0] === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await c.call("POST", `${NW}/auth/verify-login`, { challenge: r.body.mfa.challenge, code: wrong })).status).toBe(401);
    expect((await c.call("POST", `${NW}/auth/verify-login`, { challenge: r.body.mfa.challenge, code: codes[0] })).status).toBe(401);
    expect((await rows("SELECT action FROM audit_log WHERE action = 'auth.mfa_failed'")).length).toBe(6);
  });
  it("expires after ten minutes", async () => {
    const { c, r } = await start(); min(11);
    expect((await c.call("POST", `${NW}/auth/verify-login`, { challenge: r.body.mfa.challenge, code: codes[0] })).status).toBe(401);
  });
  it("never stores the code in plain text", async () => {
    await start();
    expect(JSON.stringify(await rows("SELECT * FROM mfa_challenges"))).not.toContain(codes[0]!);
  });
});
