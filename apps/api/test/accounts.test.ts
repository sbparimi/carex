// Owner-approved spec for apps/api/src/accounts.ts (ADR-005): sign-up validation, passwords, lockout, sessions, password reset.
import { describe, it, expect, beforeEach } from "vitest";
import { openTestDb, seedDb, type Db } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";
import { Accounts, AccountError, hashPassword, verifyPassword, passwordProblem, type Mailer, type SignupInput } from "../src/accounts.js";

let db: Db; let acc: Accounts; let now: Date; let mails: { to: string; slug: string; token: string }[];
const base = (over: Partial<SignupInput> = {}): SignupInput => ({
  email: "Pat.Synthetic@Example.test", password: "correct horse battery 42", firstName: "Pat", lastName: "Synthetic", dateOfBirth: "1985-04-12", phone: "+31 6 1234 5678",
  access: { type: "employer", employerId: "em-n-1" }, ...over,
});
const mailer: Mailer = { async sendPasswordReset(to, slug, token) { mails.push({ to, slug, token }); } };
beforeEach(async () => {
  now = new Date("2026-11-02T08:00:00Z"); mails = [];
  db = await openTestDb(); await seedDb(db, syntheticCatalog()); acc = new Accounts(db, () => now, mailer);
});
const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as AccountError; } throw new Error("expected a rejection"); };

describe("password hashing", () => {
  it("uses salted scrypt, verifies the right password only, and never stores plaintext", async () => {
    const a = await hashPassword("correct horse battery 42"); const b = await hashPassword("correct horse battery 42");
    expect(a).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/); expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse battery 42", a)).toBe(true);
    expect(await verifyPassword("correct horse battery 43", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("applies the password policy: 10 to 128 characters, not the email, not one repeated character", () => {
    expect(passwordProblem("short")).toBeTruthy(); expect(passwordProblem("x".repeat(129))).toBeTruthy(); expect(passwordProblem("aaaaaaaaaaaa")).toBeTruthy();
    expect(passwordProblem("pat@example.test", "pat@example.test")).toBeTruthy(); expect(passwordProblem("correct horse battery 42")).toBeUndefined();
  });
});

describe("sign up", () => {
  it("creates an account, normalises the email, and returns the profile with the access path (no password data)", async () => {
    const r = await acc.signup("tn-north", base());
    expect(r.profile).toEqual({ id: expect.any(String), email: "pat.synthetic@example.test", firstName: "Pat", lastName: "Synthetic", dateOfBirth: "1985-04-12", phone: "+31 6 1234 5678", access: { type: "employer", id: "em-n-1", name: "Acme Logistics (demo)" }, notify: { email: true, sms: false } });
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", r.profile.id);
    expect(row!.password_hash).toMatch(/^scrypt\$/); expect(JSON.stringify(r)).not.toMatch(/scrypt|correct horse/);
  });
  it("supports the insurance-provider path", async () => {
    const r = await acc.signup("tn-north", base({ access: { type: "insurer", insurerId: "in-n-2" } }));
    expect(r.profile.access).toEqual({ type: "insurer", id: "in-n-2", name: "Sample Mutual Insurance (demo)" });
  });
  it("reports every invalid field at once", async () => {
    const e = await rejection(acc.signup("tn-north", base({ email: "nope", password: "short", firstName: " ", lastName: "", dateOfBirth: "1985-02-30", phone: "abc", access: undefined as never })));
    expect(e.code).toBe("invalid_input");
    expect(Object.keys(e.fields!).sort()).toEqual(["access", "dateOfBirth", "email", "firstName", "lastName", "password", "phone"]);
  });
  it("requires an adult with a real, past date of birth", async () => {
    expect((await rejection(acc.signup("tn-north", base({ dateOfBirth: "2030-01-01" })))).fields).toHaveProperty("dateOfBirth");
    expect((await rejection(acc.signup("tn-north", base({ dateOfBirth: "2010-01-01" })))).fields!.dateOfBirth).toMatch(/18/);
    expect((await rejection(acc.signup("tn-north", base({ dateOfBirth: "1899-01-01" })))).fields).toHaveProperty("dateOfBirth");
    await acc.signup("tn-north", base({ dateOfBirth: "2008-11-02" }));                      // turns 18 today
  });
  it("only accepts employers and insurers that belong to this tenant", async () => {
    expect((await rejection(acc.signup("tn-north", base({ access: { type: "employer", employerId: "em-b-1" } })))).fields).toHaveProperty("access");
    expect((await rejection(acc.signup("tn-bay", base({ access: { type: "insurer", insurerId: "in-n-1" } })))).fields).toHaveProperty("access");
    expect((await rejection(acc.signup("tn-north", base({ access: { type: "employer", employerId: "nope" } })))).fields).toHaveProperty("access");
  });
  it("refuses a duplicate email in the same tenant (case-insensitively) but allows it in another tenant", async () => {
    await acc.signup("tn-north", base());
    expect((await rejection(acc.signup("tn-north", base({ email: "PAT.SYNTHETIC@example.test" })))).code).toBe("email_taken");
    await acc.signup("tn-bay", base({ access: { type: "employer", employerId: "em-b-1" } }));
  });
});

describe("employer and insurer lookup", () => {
  it("searches employers by name, case-insensitively, per tenant, only after at least one character", async () => {
    expect(await acc.employers("tn-north", "")).toEqual([]);
    expect((await acc.employers("tn-north", "ACME")).map((e) => e.name)).toEqual(["Acme Logistics (demo)"]);
    expect((await acc.employers("tn-north", "o")).length).toBeGreaterThan(1);
    expect(await acc.employers("tn-bay", "acme")).toEqual([]);
    expect(await acc.employers("tn-north", "%")).toEqual([]);                               // wildcard characters are not wildcards
  });
  it("lists a tenant's insurers", async () => {
    expect((await acc.insurers("tn-north")).length).toBe(3); expect((await acc.insurers("tn-bay")).length).toBe(1);
  });
});

describe("login and lockout", () => {
  beforeEach(async () => { await acc.signup("tn-north", base()); });
  it("logs in with the right password, any email casing", async () => {
    const r = await acc.login("tn-north", "PAT.synthetic@example.test", "correct horse battery 42");
    expect(r.profile.firstName).toBe("Pat"); expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("gives the same error for a wrong password and an unknown email, and never logs in across tenants", async () => {
    const a = await rejection(acc.login("tn-north", "pat.synthetic@example.test", "wrong password 123"));
    const b = await rejection(acc.login("tn-north", "nobody@example.test", "wrong password 123"));
    const c = await rejection(acc.login("tn-bay", "pat.synthetic@example.test", "correct horse battery 42"));
    for (const e of [a, b, c]) { expect(e.code).toBe("invalid_credentials"); expect(e.message).toBe("Invalid email or password"); }
  });
  it("locks after 5 failures for 15 minutes, even for the right password, then unlocks", async () => {
    for (let i = 0; i < 5; i++) expect((await rejection(acc.login("tn-north", "pat.synthetic@example.test", "wrong password 123"))).code).toBe("invalid_credentials");
    expect((await rejection(acc.login("tn-north", "pat.synthetic@example.test", "correct horse battery 42"))).code).toBe("locked");
    now = new Date(now.getTime() + 14 * 60_000);
    expect((await rejection(acc.login("tn-north", "pat.synthetic@example.test", "correct horse battery 42"))).code).toBe("locked");
    now = new Date(now.getTime() + 2 * 60_000);
    await acc.login("tn-north", "pat.synthetic@example.test", "correct horse battery 42");
  });
  it("a successful login resets the failure counter", async () => {
    for (let i = 0; i < 4; i++) await rejection(acc.login("tn-north", "pat.synthetic@example.test", "wrong password 123"));
    await acc.login("tn-north", "pat.synthetic@example.test", "correct horse battery 42");
    for (let i = 0; i < 4; i++) await rejection(acc.login("tn-north", "pat.synthetic@example.test", "wrong password 123"));
    await acc.login("tn-north", "pat.synthetic@example.test", "correct horse battery 42");
  });
});

describe("sessions", () => {
  it("authenticates a token for its own tenant only, and logout ends it", async () => {
    const { token, profile } = await acc.signup("tn-north", base());
    expect((await acc.authenticate("tn-north", token))!.id).toBe(profile.id);
    expect(await acc.authenticate("tn-bay", token)).toBeUndefined();
    for (const bad of [undefined, "", "short", "x".repeat(43), token.slice(0, 42)]) expect(await acc.authenticate("tn-north", bad)).toBeUndefined();
    await acc.logout("tn-north", token);
    expect(await acc.authenticate("tn-north", token)).toBeUndefined();
  });
  it("expires 24 hours after sign-in, however active", async () => {
    const { token } = await acc.signup("tn-north", base());
    for (let i = 0; i < 71; i++) { now = new Date(now.getTime() + 20 * 60_000); expect(await acc.authenticate("tn-north", token)).toBeDefined(); }
    now = new Date(now.getTime() + 41 * 60_000); expect(await acc.authenticate("tn-north", token)).toBeUndefined();
  });
  it("stores only a hash of the session token", async () => {
    const { token } = await acc.signup("tn-north", base());
    expect(JSON.stringify(await db.all("SELECT * FROM sessions"))).not.toContain(token);
  });
});

describe("password reset", () => {
  beforeEach(async () => { await acc.signup("tn-north", base()); });
  it("sends a link only for a known email, and never reveals which", async () => {
    await acc.requestReset("tn-north", "northwind-health", "nobody@example.test");
    expect(mails).toEqual([]);
    await acc.requestReset("tn-north", "northwind-health", "PAT.synthetic@example.test");
    expect(mails).toHaveLength(1); expect(mails[0]).toMatchObject({ to: "pat.synthetic@example.test", slug: "northwind-health" }); expect(mails[0]!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(await db.all("SELECT * FROM password_resets"))).not.toContain(mails[0]!.token);
  });
  it("sets a new password once, signs out every session, and the old password stops working", async () => {
    const { token: session } = await acc.login("tn-north", "pat.synthetic@example.test", "correct horse battery 42");
    await acc.requestReset("tn-north", "northwind-health", "pat.synthetic@example.test");
    await acc.resetPassword("tn-north", mails[0]!.token, "a brand new passphrase 99");
    expect(await acc.authenticate("tn-north", session)).toBeUndefined();
    expect((await rejection(acc.login("tn-north", "pat.synthetic@example.test", "correct horse battery 42"))).code).toBe("invalid_credentials");
    await acc.login("tn-north", "pat.synthetic@example.test", "a brand new passphrase 99");
    expect((await rejection(acc.resetPassword("tn-north", mails[0]!.token, "yet another passphrase 11"))).code).toBe("invalid_token");
  });
  it("rejects expired, wrong-tenant, malformed and weak-password resets", async () => {
    await acc.requestReset("tn-north", "northwind-health", "pat.synthetic@example.test"); const t = mails[0]!.token;
    expect((await rejection(acc.resetPassword("tn-north", t, "short"))).code).toBe("invalid_input");
    expect((await rejection(acc.resetPassword("tn-bay", t, "a brand new passphrase 99"))).code).toBe("invalid_token");
    expect((await rejection(acc.resetPassword("tn-north", "nope", "a brand new passphrase 99"))).code).toBe("invalid_token");
    now = new Date(now.getTime() + 31 * 60_000);
    expect((await rejection(acc.resetPassword("tn-north", t, "a brand new passphrase 99"))).code).toBe("invalid_token");
  });
  it("a reset also clears a lockout", async () => {
    for (let i = 0; i < 5; i++) await rejection(acc.login("tn-north", "pat.synthetic@example.test", "wrong password 123"));
    await acc.requestReset("tn-north", "northwind-health", "pat.synthetic@example.test");
    await acc.resetPassword("tn-north", mails[0]!.token, "a brand new passphrase 99");
    await acc.login("tn-north", "pat.synthetic@example.test", "a brand new passphrase 99");
  });
});
