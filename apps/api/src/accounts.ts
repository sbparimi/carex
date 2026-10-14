import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "./db.js";
import { isUniqueViolation } from "./db.js";
import type { Principal } from "./booking-service.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export class AccountError extends Error {
  constructor(public code: "invalid_input" | "email_taken" | "invalid_credentials" | "locked" | "invalid_token", message: string, public fields?: Record<string, string>) { super(message); this.name = "AccountError"; }
}

export type Access = { type: "employer"; employerId: string } | { type: "insurer"; insurerId: string };
export interface SignupInput { email: string; password: string; firstName: string; lastName: string; dateOfBirth: string; phone: string; access: Access }
export interface Profile { id: string; email: string; firstName: string; lastName: string; dateOfBirth: string; phone: string; access: { type: "employer" | "insurer"; id: string; name: string } }
export interface Mailer { sendPasswordReset(to: string, tenantSlug: string, token: string): Promise<void> }

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const SESSION_MS = 7 * 86_400_000;
const RESET_MS = 30 * 60_000;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const want = Buffer.from(key, "base64url");
  const got = await scrypt(pw, Buffer.from(salt, "base64url"), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return got.length === want.length && timingSafeEqual(got, want);
}
const DUMMY = hashPassword("carex-dummy-password-for-timing");

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export function passwordProblem(pw: unknown, email?: string): string | undefined {
  if (typeof pw !== "string") return "Password is required";
  if (pw.length < 10) return "Use at least 10 characters";
  if (pw.length > 128) return "Use at most 128 characters";
  if (email && pw.toLowerCase() === email.toLowerCase()) return "Password must not be your email address";
  if (/^(.)\1+$/.test(pw)) return "Choose a less repetitive password";
  return undefined;
}

function dobProblem(dob: unknown, now: Date): string | undefined {
  if (typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return "Enter your date of birth";
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dob) return "Enter a real date";
  if (d.getUTCFullYear() < 1900 || d.getTime() > now.getTime()) return "Enter a real date of birth";
  const adult = new Date(Date.UTC(d.getUTCFullYear() + 18, d.getUTCMonth(), d.getUTCDate()));
  if (adult.getTime() > now.getTime()) return "You must be 18 or older to create an account";
  return undefined;
}

export class Accounts {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date(), private readonly mailer?: Mailer) {}

  // ---- who may sign up through which door (per tenant)
  async employers(tenantId: string, q: string): Promise<{ id: string; name: string }[]> {
    const term = q.trim().toLowerCase().replace(/[\\%_]/g, "");
    if (term.length < 1) return [];
    return this.db.all("SELECT id, name FROM employers WHERE tenant_id = ? AND lower(name) LIKE ? ORDER BY name LIMIT 10", tenantId, `%${term}%`);
  }
  async insurers(tenantId: string): Promise<{ id: string; name: string }[]> {
    return this.db.all("SELECT id, name FROM insurers WHERE tenant_id = ? ORDER BY name", tenantId);
  }

  // ---- sign up / log in / out
  async signup(tenantId: string, i: SignupInput): Promise<{ profile: Profile; token: string }> {
    const fields: Record<string, string> = {};
    const email = typeof i.email === "string" ? normalizeEmail(i.email) : "";
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email) || email.length > 254) fields.email = "Enter a valid email address";
    const pw = passwordProblem(i.password, email); if (pw) fields.password = pw;
    const name = (v: unknown) => typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 80;
    if (!name(i.firstName)) fields.firstName = "Enter your first name";
    if (!name(i.lastName)) fields.lastName = "Enter your last name";
    const dob = dobProblem(i.dateOfBirth, this.now()); if (dob) fields.dateOfBirth = dob;
    if (typeof i.phone !== "string" || !/^[0-9+() .-]{7,20}$/.test(i.phone.trim())) fields.phone = "Enter a valid mobile phone number";
    let employerId: string | null = null, insurerId: string | null = null, accessName = "";
    if (i.access?.type === "employer") {
      const e = await this.db.get<{ id: string; name: string }>("SELECT id, name FROM employers WHERE tenant_id = ? AND id = ?", tenantId, String(i.access.employerId));
      if (!e) fields.access = "Choose your employer from the list"; else { employerId = e.id; accessName = e.name; }
    } else if (i.access?.type === "insurer") {
      const e = await this.db.get<{ id: string; name: string }>("SELECT id, name FROM insurers WHERE tenant_id = ? AND id = ?", tenantId, String(i.access.insurerId));
      if (!e) fields.access = "Choose your insurance provider from the list"; else { insurerId = e.id; accessName = e.name; }
    } else fields.access = "Tell us how you are accessing care";
    if (Object.keys(fields).length) throw new AccountError("invalid_input", "Please check the highlighted fields", fields);

    const id = randomUUID(); const hash = await hashPassword(i.password);
    try {
      await this.db.run(
        `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, date_of_birth, phone, access_type, employer_id, insurer_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, tenantId, email, hash, i.firstName.trim(), i.lastName.trim(), i.dateOfBirth, i.phone.trim(), employerId ? "employer" : "insurer", employerId, insurerId, this.now().toISOString());
    } catch (e) {
      if (isUniqueViolation(e)) throw new AccountError("email_taken", "An account with this email already exists. Try logging in.", { email: "An account with this email already exists" });
      throw e;
    }
    const profile: Profile = { id, email, firstName: i.firstName.trim(), lastName: i.lastName.trim(), dateOfBirth: i.dateOfBirth, phone: i.phone.trim(), access: { type: employerId ? "employer" : "insurer", id: (employerId ?? insurerId)!, name: accessName } };
    return { profile, token: await this.newSession(tenantId, id) };
  }

  async login(tenantId: string, emailRaw: string, password: string): Promise<{ profile: Profile; token: string }> {
    const email = typeof emailRaw === "string" ? normalizeEmail(emailRaw) : "";
    const u = typeof password === "string" && password.length <= 128 ? await this.db.get<{ id: string; password_hash: string; failed_logins: number; locked_until: string | null }>(
      "SELECT id, password_hash, failed_logins, locked_until FROM users WHERE tenant_id = ? AND email = ?", tenantId, email) : undefined;
    if (!u) { await verifyPassword(String(password).slice(0, 128), await DUMMY); throw new AccountError("invalid_credentials", "Invalid email or password"); }   // same work and same answer for unknown emails
    if (u.locked_until && Date.parse(u.locked_until) > this.now().getTime()) throw new AccountError("locked", "Too many failed attempts. Try again in a few minutes, or reset your password.");
    if (!(await verifyPassword(password, u.password_hash))) {
      const n = u.failed_logins + 1;
      await this.db.run("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?", n >= MAX_FAILED ? 0 : n, n >= MAX_FAILED ? new Date(this.now().getTime() + LOCK_MS).toISOString() : null, u.id);
      throw new AccountError("invalid_credentials", "Invalid email or password");
    }
    await this.db.run("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", u.id);
    return { profile: (await this.profileById(tenantId, u.id))!, token: await this.newSession(tenantId, u.id) };
  }

  async logout(tenantId: string, token: string | undefined): Promise<void> {
    if (token) await this.db.run("DELETE FROM sessions WHERE token_hash = ? AND tenant_id = ?", sha(token), tenantId);
  }

  /** The signed-in profile for a session cookie value, or undefined (missing, unknown, expired, other tenant). */
  async authenticate(tenantId: string, token: string | undefined): Promise<Profile | undefined> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const s = await this.db.get<{ user_id: string; expires_at: string }>("SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND tenant_id = ?", sha(token), tenantId);
    if (!s) return undefined;
    if (Date.parse(s.expires_at) <= this.now().getTime()) { await this.db.run("DELETE FROM sessions WHERE token_hash = ?", sha(token)); return undefined; }
    return this.profileById(tenantId, s.user_id);
  }

  principal(p: Profile): Principal { return { id: p.id, firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone }; }

  // ---- password reset
  async requestReset(tenantId: string, tenantSlug: string, emailRaw: string): Promise<void> {
    const email = typeof emailRaw === "string" ? normalizeEmail(emailRaw) : "";
    const u = await this.db.get<{ id: string }>("SELECT id FROM users WHERE tenant_id = ? AND email = ?", tenantId, email);
    if (!u) return;                                                       // same visible result either way
    const token = randomBytes(32).toString("base64url");
    await this.db.run("INSERT INTO password_resets (token_hash, user_id, tenant_id, expires_at) VALUES (?,?,?,?)", sha(token), u.id, tenantId, new Date(this.now().getTime() + RESET_MS).toISOString());
    await this.mailer?.sendPasswordReset(email, tenantSlug, token);
  }

  async resetPassword(tenantId: string, token: string, newPassword: string): Promise<void> {
    const pwProblem = passwordProblem(newPassword);
    if (pwProblem) throw new AccountError("invalid_input", pwProblem, { password: pwProblem });
    const hash = await hashPassword(newPassword);
    await this.db.tx(async (tx) => {
      const r = typeof token === "string" ? await tx.get<{ user_id: string; expires_at: string; used_at: string | null }>("SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ? AND tenant_id = ? FOR UPDATE", sha(token), tenantId) : undefined;
      if (!r || r.used_at || Date.parse(r.expires_at) <= this.now().getTime()) throw new AccountError("invalid_token", "This reset link is invalid or has expired. Request a new one.");
      await tx.run("UPDATE password_resets SET used_at = ? WHERE token_hash = ?", this.now().toISOString(), sha(token));
      await tx.run("UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ? AND tenant_id = ?", hash, r.user_id, tenantId);
      await tx.run("DELETE FROM sessions WHERE user_id = ?", r.user_id);   // a reset signs out every device
    });
  }

  private async newSession(tenantId: string, userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const t = this.now();
    await this.db.run("INSERT INTO sessions (token_hash, user_id, tenant_id, created_at, expires_at) VALUES (?,?,?,?,?)", sha(token), userId, tenantId, t.toISOString(), new Date(t.getTime() + SESSION_MS).toISOString());
    return token;
  }

  private async profileById(tenantId: string, id: string): Promise<Profile | undefined> {
    const r = await this.db.get<{ id: string; email: string; first_name: string; last_name: string; date_of_birth: string; phone: string; access_type: "employer" | "insurer"; employer_id: string | null; insurer_id: string | null; ename: string | null; iname: string | null }>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.date_of_birth, u.phone, u.access_type, u.employer_id, u.insurer_id, e.name AS ename, i.name AS iname
         FROM users u LEFT JOIN employers e ON e.id = u.employer_id LEFT JOIN insurers i ON i.id = u.insurer_id
        WHERE u.tenant_id = ? AND u.id = ?`, tenantId, id);
    if (!r) return undefined;
    return { id: r.id, email: r.email, firstName: r.first_name, lastName: r.last_name, dateOfBirth: r.date_of_birth, phone: r.phone,
      access: r.access_type === "employer" ? { type: "employer", id: r.employer_id!, name: r.ename! } : { type: "insurer", id: r.insurer_id!, name: r.iname! } };
  }
}
