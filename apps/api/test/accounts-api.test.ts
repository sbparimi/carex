// Account HTTP API (ADR-005): cookies, errors that do not leak, public lookups, reset flow, abuse limits.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startApi, signupBody, PASSWORD, type Api, type Client } from "./helpers.js";
import type { Mailer } from "../src/accounts.js";

const NW = "/t/northwind-health/api";
let api: Api; let c: Client; let tokens: string[];
const mailer: Mailer = { async sendPasswordReset(_to, _slug, token) { tokens.push(token); } };
beforeEach(async () => { tokens = []; api = await startApi({ mailer }); c = api.client(); });
afterEach(() => api.close());

describe("sign up and session cookie", () => {
  it("creates the account and sets an HttpOnly, SameSite=Lax cookie scoped to the tenant path", async () => {
    const r = await c.signup("northwind-health");
    expect(r.status).toBe(201); expect(r.body.user).toMatchObject({ email: "pat.synthetic@example.test", firstName: "Pat", access: { type: "employer", name: "Acme Logistics (demo)" } });
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^carex_session=[A-Za-z0-9_-]{43};/); expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/SameSite=Lax/); expect(cookie).toMatch(/Path=\/t\/northwind-health(;|$)/);
    expect(cookie).not.toMatch(/Secure/);                                                // plain http in development
    expect(r.text).not.toMatch(/password|scrypt/i);
  });
  it("marks the cookie Secure when the deployment says it is behind HTTPS", async () => {
    await api.close(); api = await startApi({ secureCookies: true }); c = api.client();
    expect((await c.signup("northwind-health")).headers.get("set-cookie")).toMatch(/; Secure/);
  });
  it("returns field-level errors for invalid input and 409 for a duplicate email", async () => {
    const bad = await c.call("POST", `${NW}/auth/signup`, signupBody({ email: "x", password: "short", dateOfBirth: "2015-01-01" }));
    expect(bad.status).toBe(400); expect(Object.keys(bad.body.error.fields).sort()).toEqual(["dateOfBirth", "email", "password"]);
    expect((await c.signup("northwind-health")).status).toBe(201);
    const dup = await api.client().signup("northwind-health");
    expect(dup.status).toBe(409); expect(dup.body.error.code).toBe("email_taken");
  });
  it("ignores unknown fields and refuses non-object bodies", async () => {
    expect((await c.call("POST", `${NW}/auth/signup`, [1])).status).toBe(400);
    expect((await c.call("POST", `${NW}/auth/signup`, "{nope")).status).toBe(400);
  });
});

describe("me, logout, login", () => {
  it("me is 401 anonymously and returns the profile when signed in; logout clears the session server-side and the cookie", async () => {
    expect((await c.get(`${NW}/auth/me`)).status).toBe(401);
    await c.signup("northwind-health");
    expect((await c.get(`${NW}/auth/me`)).body.user.email).toBe("pat.synthetic@example.test");
    const saved = c.jar.get("northwind-health")!;
    const out = await c.post(`${NW}/auth/logout`);
    expect(out.status).toBe(204); expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await c.call("GET", `${NW}/auth/me`, undefined, { cookie: saved })).status).toBe(401);     // the old cookie is dead even if replayed
  });
  it("logs in, and gives one identical 401 body for a wrong password and an unknown email", async () => {
    await c.signup("northwind-health");
    const fresh = api.client();
    const ok = await fresh.post(`${NW}/auth/login`, { email: "pat.synthetic@example.test", password: PASSWORD });
    expect(ok.status).toBe(200); expect((await fresh.get(`${NW}/auth/me`)).status).toBe(200);
    const wrong = await api.client().post(`${NW}/auth/login`, { email: "pat.synthetic@example.test", password: "nope nope nope 1" });
    const unknown = await api.client().post(`${NW}/auth/login`, { email: "who@example.test", password: "nope nope nope 1" });
    expect(wrong.status).toBe(401); expect(unknown.status).toBe(401); expect(wrong.text).toBe(unknown.text);
  });
  it("answers 423 once the account is locked", async () => {
    await c.signup("northwind-health");
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await api.client().post(`${NW}/auth/login`, { email: "pat.synthetic@example.test", password: "nope nope nope 1" })).status;
    expect(last).toBe(423);
  });
  it("throttles login attempts per email address", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await api.client().post(`${NW}/auth/login`, { email: "target@example.test", password: "nope nope nope 1" })).status);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
  it("a cookie from one tenant does not sign you in to another", async () => {
    await c.signup("northwind-health");
    const r = await c.call("GET", `/t/bayview-care/api/auth/me`, undefined, { cookie: c.jar.get("northwind-health")! });
    expect(r.status).toBe(401);
  });
});

describe("public lookups for the sign-up form", () => {
  it("searches employers and lists insurers without being signed in, scoped to the tenant", async () => {
    expect((await c.get(`${NW}/auth/employers?q=acme`)).body.employers).toEqual([{ id: "em-n-1", name: "Acme Logistics (demo)" }]);
    expect((await c.get(`${NW}/auth/employers?q=`)).body.employers).toEqual([]);
    expect((await c.get(`${NW}/auth/insurers`)).body.insurers.length).toBe(3);
    expect((await c.get(`/t/bayview-care/api/auth/employers?q=acme`)).body.employers).toEqual([]);
  });
});

describe("forgot and reset password", () => {
  it("answers 202 with the same text for known and unknown emails, and the link works once", async () => {
    await c.signup("northwind-health");
    const known = await api.client().post(`${NW}/auth/forgot-password`, { email: "pat.synthetic@example.test" });
    const unknown = await api.client().post(`${NW}/auth/forgot-password`, { email: "who@example.test" });
    expect(known.status).toBe(202); expect(known.text).toBe(unknown.text); expect(tokens).toHaveLength(1);
    expect(JSON.stringify(known.body)).not.toContain(tokens[0]!);
    expect((await api.client().post(`${NW}/auth/reset-password`, { token: tokens[0], password: "a brand new passphrase 99" })).status).toBe(204);
    expect((await api.client().post(`${NW}/auth/reset-password`, { token: tokens[0], password: "another new passphrase 7" })).status).toBe(400);
    expect((await api.client().post(`${NW}/auth/login`, { email: "pat.synthetic@example.test", password: "a brand new passphrase 99" })).status).toBe(200);
  });
  it("rejects a weak new password without consuming the link", async () => {
    await c.signup("northwind-health"); await c.post(`${NW}/auth/forgot-password`, { email: "pat.synthetic@example.test" });
    const weak = await c.post(`${NW}/auth/reset-password`, { token: tokens[0], password: "short" });
    expect(weak.status).toBe(400); expect(weak.body.error.fields).toHaveProperty("password");
    expect((await c.post(`${NW}/auth/reset-password`, { token: tokens[0], password: "a brand new passphrase 99" })).status).toBe(204);
  });
});

describe("cross-site protection", () => {
  it("refuses sign-up, login and logout that arrive from another origin", async () => {
    for (const p of ["auth/signup", "auth/login", "auth/logout", "auth/forgot-password"]) {
      const r = await c.call("POST", `${NW}/${p}`, signupBody(), { origin: "https://evil.example" });
      expect(r.status, p).toBe(403);
    }
    expect((await c.call("POST", `${NW}/auth/login`, { email: "a@b.co", password: "x" }, { origin: api.base })).status).not.toBe(403);
  });
});
