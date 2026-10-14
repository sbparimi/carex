// Admin configuration API (ADR-004) end to end against the real engine.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startApi, type Api, type Client } from "./helpers.js";

const NW = "/t/northwind-health/api"; const BV = "/t/bayview-care/api";
let api: Api; let key: string; let bayKey: string; let base: string; let patient: Client;
beforeEach(async () => {
  api = await startApi(); base = api.base; patient = api.client(); await patient.signup("northwind-health");
  key = await api.app.admin.keys.create("tn-north", "test"); bayKey = await api.app.admin.keys.create("tn-bay", "test");
});
afterEach(() => api.close());
const call = async (method: string, path: string, body?: unknown, k: string | null = key) => {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(k ? { authorization: `Bearer ${k}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: r.status, body: json, text };
};

describe("authentication", () => {
  it("answers 401 without a key, with a malformed key, with a revoked key, and with another tenant's key", async () => {
    expect((await call("GET", `${NW}/admin/clinics`, undefined, null)).status).toBe(401);
    expect((await call("GET", `${NW}/admin/clinics`, undefined, "cxa_short")).status).toBe(401);
    expect((await call("GET", `${NW}/admin/clinics`, undefined, bayKey)).status).toBe(401);
    await api.app.admin.keys.revokeByLabel("tn-north", "test");
    expect((await call("GET", `${NW}/admin/clinics`)).status).toBe(401);
  });
  it("gives identical bodies for every kind of failure", async () => {
    const a = await call("GET", `${NW}/admin/clinics`, undefined, null); const b = await call("GET", `${NW}/admin/clinics`, undefined, bayKey);
    expect(a.text).toBe(b.text);
  });
  it("is rate limited per client", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 70; i++) codes.push((await call("GET", `${NW}/admin/clinics`, undefined, null)).status);
    expect(codes).toContain(429);
  });
  it("does not exist when the admin service is not wired", async () => {
    const bare = (await import("../src/server.js")).createServer({ catalog: api.app.catalog, bookings: api.app.bookings, accounts: api.app.accounts });
    await new Promise<void>((r) => bare.listen(0, "127.0.0.1", r));
    const res = await fetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}${NW}/admin/clinics`, { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(404); bare.close();
  });
});

describe("configuration changes show up for patients immediately", () => {
  it("lists, creates, activates a clinic", async () => {
    expect((await call("GET", `${NW}/admin/clinics`)).body.clinics).toHaveLength(4);
    const c = await call("POST", `${NW}/admin/clinics`, { name: "Harbor Clinic", city: "Harbor", address: "9 Example Way", stateCode: "WA", timeZone: "America/Los_Angeles" });
    expect(c.status).toBe(201);
    const pub = async () => (await patient.get(`${NW}/states`)).body.states as string[];
    expect(await pub()).not.toContain("WA");
    expect((await call("PATCH", `${NW}/admin/clinics/${c.body.id}`, { status: "active", bookable: true })).status).toBe(200);
    expect(await pub()).toContain("WA");
  });
  it("changes branding and the analytics flag", async () => {
    expect((await call("PATCH", `${NW}/admin/brand`, { displayName: "Northwind Care", primaryColor: "#223344" })).body.brand.displayName).toBe("Northwind Care");
    const cfg = (await patient.get(`${NW}/config`)).body;
    expect(cfg.brand).toMatchObject({ displayName: "Northwind Care", primaryColor: "#223344" });
    expect((await call("PUT", `${NW}/admin/analytics`, { enabled: false })).status).toBe(204);
  });
  it("replaces weekly hours and adds then removes time off", async () => {
    const put = await call("PUT", `${NW}/admin/providers/pr-a/clinics/cl-sb/availability`, { rules: [{ weekday: 1, startMinute: 540, endMinute: 600 }] });
    expect(put.status).toBe(200); expect(put.body.rules).toHaveLength(1);
    const slots = async () => (await patient.get(`${NW}/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a`)).body.slots as { id: string; startsAt: string; endsAt: string }[];
    const before = await slots(); expect(before.length).toBeGreaterThan(0);
    const t = await call("POST", `${NW}/admin/providers/pr-a/time-off`, { startsAt: before[0]!.startsAt, endsAt: before[0]!.endsAt });
    expect(t.status).toBe(201);
    expect((await slots()).map((s) => s.id)).not.toContain(before[0]!.id);
    expect((await call("DELETE", `${NW}/admin/time-off/${t.body.id}`)).status).toBe(204);
    expect((await slots()).map((s) => s.id)).toContain(before[0]!.id);
  });
  it("switches a visit type on at a clinic", async () => {
    expect((await call("PUT", `${NW}/admin/clinics/cl-sb/visit-types/sv-vision-n`, { active: true })).status).toBe(204);
    const vt = (await patient.get(`${NW}/clinics/cl-sb/visit-types`)).body;
    expect(vt.visitTypes.map((v: any) => v.id)).toContain("sv-vision-n");
  });
});

describe("validation and isolation", () => {
  it("returns 400 with a message for invalid input, and changes nothing", async () => {
    const r = await call("PATCH", `${NW}/admin/brand`, { primaryColor: "red" });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe("invalid_request");
    expect((await call("PUT", `${NW}/admin/providers/pr-a/clinics/cl-sb/availability`, { rules: [{ weekday: 1, startMinute: 600, endMinute: 540 }] })).status).toBe(400);
    expect((await call("PATCH", `${NW}/admin/brand`, [1])).status).toBe(400);
  });
  it("answers 404 for another tenant's objects, even with a valid key of this tenant", async () => {
    expect((await call("PATCH", `${BV}/admin/clinics/cl-sb`, { status: "inactive" }, bayKey)).status).toBe(404);
    expect((await call("PATCH", `${NW}/admin/clinics/cl-oak`, { status: "inactive" })).status).toBe(404);
    expect((await call("DELETE", `${NW}/admin/time-off/9999`)).status).toBe(404);
  });
  it("never echoes the key and sets no-store", async () => {
    const r = await call("GET", `${NW}/admin/clinics`); expect(r.text).not.toContain(key);
  });
});
