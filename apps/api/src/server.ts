import { createServer as httpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Id, RescheduleRequest, StateCode } from "@carex/contracts";
import type { CatalogPort } from "./catalog.js";
import { BookingService, DomainError } from "./booking-service.js";
import { emitTelemetry, redact, type TelemetrySink } from "./telemetry.js";
import { createRateLimiter } from "./ratelimit.js";
import { Accounts, AccountError } from "./accounts.js";
import type { AdminKeys } from "./admin-keys.js";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Audit, Actor } from "./audit.js";
import { StaffError, toCsv, toFhir, type StaffAccounts, type StaffDesk, type StaffPrincipal } from "./staff.js";
import type { Notifier } from "./notify.js";
import { DbWaitlist, WaitlistError } from "./waitlist.js";
import { IntakeError, type DbIntake } from "./intake.js";
import { RED_FLAGS } from "./triage.js";
import { AdminNotFoundError, AdminValidationError, type DbAdmin } from "./db-admin.js";

export interface Deps {
  catalog: CatalogPort; bookings: BookingService;
  log?: (entry: unknown) => void; telemetry?: TelemetrySink;
  /** Directory holding index.html, app.js, app.css for the patient UI. */
  staticDir?: string;
  /** Account sign-up, login and sessions (ADR-005). */
  accounts: Accounts;
  /** Patients, consent, screening, coverage (P2). Without it bookings skip clinical intake. */
  intake?: DbIntake;
  /** Waitlist (P3). */
  waitlist?: DbWaitlist;
  /** Append-only access trail (P4). */
  audit?: Audit;
  /** Staff console (P5). */
  staff?: { accounts: StaffAccounts; desk: StaffDesk };
  /** Outbound messages (P3). With `cronSecret`, GET/POST /internal/dispatch sends what is due. */
  notifier?: Notifier;
  cronSecret?: string;
  /** Mark the session cookie Secure. True in production (HTTPS); false for http://localhost development. */
  secureCookies?: boolean;
  /** Per-client request budgets per minute; the defaults suit a single small deployment. Clients are identified by socket address (no proxy headers are trusted). */
  limits?: Partial<Record<"read" | "write" | "auth", { limit: number; windowMs: number }>>;
  /** Behind a trusted reverse proxy (Vercel): identify clients by x-real-ip / x-forwarded-for instead of the socket address. Never enable when the app is directly exposed. */
  trustProxy?: boolean;
  /** Admin configuration API (ADR-004). Without it every /admin route answers 404. */
  admin?: { keys: AdminKeys; config: DbAdmin };
  /** Registered ONLY by the e2e server entry; never by the dev or production entries. */
  testHooks?: { injectFault(fault: string): void; reset(): void | Promise<void>; lastResetToken(): string };
}

const ASSETS: Record<string, string> = { "app.js": "text/javascript; charset=utf-8", "manage.js": "text/javascript; charset=utf-8", "auth.js": "text/javascript; charset=utf-8", "app.css": "text/css; charset=utf-8" };
/** Page shells served under /t/<slug>/<page>. Each is generic and contains no tenant or user data. */
const PAGES: Record<string, string> = { "": "index.html", appointments: "manage.html", login: "login.html", signup: "signup.html", forgot: "forgot.html", reset: "reset.html" };
const COOKIE = "carex_session";
const STAFF_COOKIE = "carex_staff";
const STAFF_SECONDS = 12 * 3600;
const SESSION_SECONDS = 24 * 3600;

const MAX_BODY = 10_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const cookieOf = (req: IncomingMessage, name: string): string | undefined => {
  for (const part of String(req.headers.cookie ?? "").split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return undefined;
};

/** Headers on every response. The page CSP allows only same-origin script and style: the UI uses no inline code or styles. */
const SECURITY_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "cross-origin-opener-policy": "same-origin", "permissions-policy": "geolocation=(), camera=(), microphone=()" };
const CSP_PAGE = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const CSP_API = "default-src 'none'; frame-ancestors 'none'";

const send = (res: ServerResponse, status: number, body: unknown, cid: string) => {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-security-policy": CSP_API, "content-type": "application/json", "cache-control": "no-store", "x-correlation-id": cid });
  res.end(JSON.stringify(body));
};
const err = (res: ServerResponse, status: number, code: string, message: string, cid: string) => send(res, status, { error: { code, message } }, cid);

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; let tooLarge = false; const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) tooLarge = true; else chunks.push(c); });   // keep draining so the client gets a response
    req.on("end", () => {
      if (tooLarge) return reject(new DomainError("payload_too_large", "request body too large"));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new DomainError("invalid_request", "invalid JSON")); }
    });
    req.on("error", reject);
  });
}

export function createServer(deps: Deps): Server {
  const L = { read: { limit: 300, windowMs: 60_000 }, write: { limit: 20, windowMs: 60_000 }, auth: { limit: 20, windowMs: 60_000 }, ...deps.limits };
  const limiter = { read: createRateLimiter(L.read), write: createRateLimiter(L.write), auth: createRateLimiter(L.auth), loginId: createRateLimiter({ limit: 10, windowMs: 60_000 }), admin: createRateLimiter({ limit: 60, windowMs: 60_000 }) };
  setInterval(() => Object.values(limiter).forEach((l) => l.sweep()), 60_000).unref();
  return httpServer(async (req, res) => {
    const cid = randomUUID(); const started = Date.now();
    let route = "unknown"; let status = 500; let tenantSlug: string | undefined;
    const reply = (s: number, body: unknown) => { status = s; send(res, s, body, cid); };
    const fail = (s: number, code: string, msg: string) => { status = s; err(res, s, code, msg, cid); };
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (deps.testHooks && req.method === "POST" && url.pathname === "/__test/fault") {
        deps.testHooks.injectFault(String(url.searchParams.get("fault"))); return reply(204, {});
      }
      if (deps.testHooks && req.method === "POST" && url.pathname === "/__test/reset") { await deps.testHooks.reset(); return reply(204, {}); }
      if (deps.testHooks && req.method === "GET" && url.pathname === "/__test/reset-token") return reply(200, { token: deps.testHooks.lastResetToken() });
      if (deps.staticDir && req.method === "GET") {
        const asset = /^\/assets\/(app\.js|manage\.js|auth\.js|app\.css)$/.exec(url.pathname);
        if (asset) {
          route = "asset"; const body = await readFile(join(deps.staticDir, asset[1]!));
          status = 200; res.writeHead(200, { ...SECURITY_HEADERS, "content-type": ASSETS[asset[1]!]!, "cache-control": "no-store" }); return void res.end(body);
        }
        // Page shells are generic and contain no tenant or user data; each page asks the API who is signed in.
        const pg = /^\/t\/[^/]*\/(appointments|login|signup|forgot|reset)?\/?$/.exec(url.pathname);
        if (pg) {
          route = "page"; const html = await readFile(join(deps.staticDir, PAGES[pg[1] ?? ""]!));
          status = 200; res.writeHead(200, { ...SECURITY_HEADERS, "content-security-policy": CSP_PAGE, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return void res.end(html);
        }
      }
      if (url.pathname === "/internal/dispatch" && (req.method === "GET" || req.method === "POST")) {
        route = "dispatch";
        if (!deps.cronSecret || !deps.notifier) return fail(404, "not_found", "Not found");
        const given = Buffer.from(String(req.headers.authorization ?? "")), want = Buffer.from(`Bearer ${deps.cronSecret}`);
        if (given.length !== want.length || !timingSafeEqual(given, want)) return fail(401, "unauthorized", "Unauthorized");
        return reply(200, await deps.notifier.dispatch({ limit: 200 }));
      }
      const m = /^\/t\/([^/]+)\/api\/(.+)$/.exec(url.pathname);
      if (!m) return fail(404, "not_found", "Not found");
      tenantSlug = m[1]!;
      if (!SLUG.test(tenantSlug)) return fail(400, "invalid_request", "Invalid request");           // malformed tenant id: reject safely
      const tenant = await deps.catalog.tenantBySlug(tenantSlug);
      if (!tenant) return fail(404, "not_found", "Not found");                                       // FR-001: no fallback to another tenant
      const path = m[2]!.replace(/\/$/, ""); const q = url.searchParams; const t = tenant.id;
      const fwd = deps.trustProxy ? (String(req.headers["x-real-ip"] ?? "") || String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim()) : "";
      const client = fwd || (req.socket.remoteAddress ?? "unknown");
      const allow = (l: ReturnType<typeof createRateLimiter>, key: string) => { const r = l.check(key); if (!r.allowed) res.setHeader("retry-after", String(r.retryAfterSec)); return r.allowed; };
      const tooMany = () => fail(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
      if (!allow(req.method === "GET" ? limiter.read : limiter.write, client)) return tooMany();
      // CSRF: a state-changing request must come from this site. SameSite=Lax already blocks cross-site cookies; this checks Origin as a second layer.
      if (req.method !== "GET" && req.method !== "HEAD" && !(path === "admin" || path.startsWith("admin/"))) {
        const origin = req.headers.origin;
        if (origin !== undefined && (() => { try { return new URL(origin).host !== req.headers.host; } catch { return true; } })()) return fail(403, "forbidden", "Forbidden");
      }
      const tel = tenant.analyticsEnabled ? deps.telemetry : undefined;                             // tenant analytics policy
      const setSession = (token: string | undefined) => {
        const attrs = [`${COOKIE}=${token ?? ""}`, `Path=/t/${tenantSlug}`, "HttpOnly", "SameSite=Lax", token ? `Max-Age=${SESSION_SECONDS}` : "Max-Age=0"];
        if (deps.secureCookies) attrs.push("Secure");
        res.setHeader("set-cookie", attrs.join("; "));
      };
      const aud = (actor: Actor, action: string, o: { targetType?: string; targetId?: string; detail?: Record<string, unknown> } = {}) =>
        deps.audit?.record({ tenantId: t, actor, action, ip: client, ...o });
      const obj = async () => { const b = await readBody(req); if (typeof b !== "object" || b === null || Array.isArray(b)) throw new DomainError("invalid_request", "body must be an object"); return b as Record<string, any>; };

      // ---- public: branding for the login page
      if (req.method === "GET" && path === "config") { route = "config"; return reply(200, { tenant: tenant.slug, brand: tenant.brand }); }

      // ---- accounts (ADR-005)
      if (path.startsWith("auth/")) {
        route = "auth"; const accounts = deps.accounts; const sub = path.slice(5);
        if (!allow(limiter.auth, client)) return tooMany();
        try {
          if (req.method === "GET" && sub === "employers") return reply(200, { employers: await accounts.employers(t, q.get("q") ?? "") });
          if (req.method === "GET" && sub === "insurers") return reply(200, { insurers: await accounts.insurers(t) });
          if (req.method === "GET" && sub === "me") { const me = await accounts.authenticate(t, cookieOf(req, COOKIE)); return me ? reply(200, { user: me }) : fail(401, "unauthorized", "Please log in"); }
          if (req.method === "POST" && sub === "signup") {
            const r = await accounts.signup(t, (await obj()) as any); setSession(r.token);
            emitTelemetry(tel, { event: "account_created", tenantId: t, correlationId: cid }); await aud({ type: "user", id: r.profile.id }, "auth.signup"); return reply(201, { user: r.profile });
          }
          if (req.method === "POST" && sub === "login") {
            const b = await obj(); if (!allow(limiter.loginId, `${t}:${String(b.email).toLowerCase()}`)) return tooMany();
            let r; try { r = await accounts.beginLogin(t, String(b.email ?? ""), String(b.password ?? "")); }
            catch (e) { if (e instanceof AccountError) await aud({ type: "anonymous" }, e.code === "locked" ? "auth.login_locked" : "auth.login_failed", { detail: { email: createHash("sha256").update(String(b.email ?? "").toLowerCase()).digest("hex").slice(0, 12) } }); throw e; }
            if (r.mfa) { await aud({ type: "anonymous" }, "auth.mfa_challenge"); return reply(200, { mfa: { required: true, challenge: r.mfa.challenge } }); }
            setSession(r.token); await aud({ type: "user", id: r.profile.id }, "auth.login"); return reply(200, { user: r.profile });
          }
          if (req.method === "POST" && sub === "verify-login") {
            const b = await obj(); if (!allow(limiter.loginId, `mfa:${t}:${String(b.challenge).slice(0, 12)}`)) return tooMany();
            let r; try { r = await accounts.verifyLogin(t, String(b.challenge ?? ""), String(b.code ?? "")); }
            catch (e) { if (e instanceof AccountError) await aud({ type: "anonymous" }, "auth.mfa_failed"); throw e; }
            setSession(r.token); await aud({ type: "user", id: r.profile.id }, "auth.login", { detail: { mfa: true } }); return reply(200, { user: r.profile });
          }
          if (req.method === "POST" && sub === "logout") { const who = await accounts.authenticate(t, cookieOf(req, COOKIE)); await accounts.logout(t, cookieOf(req, COOKIE)); if (who) await aud({ type: "user", id: who.id }, "auth.logout"); setSession(undefined); return reply(204, {}); }
          if (req.method === "POST" && sub === "forgot-password") {
            const b = await obj(); if (!allow(limiter.loginId, `reset:${t}:${String(b.email).toLowerCase()}`)) return tooMany();
            await accounts.requestReset(t, tenantSlug, String(b.email ?? "")); await aud({ type: "anonymous" }, "auth.password_reset_requested"); return reply(202, { message: "If that email has an account, we have sent a link to reset the password." });
          }
          if (req.method === "POST" && sub === "reset-password") { const b = await obj(); await accounts.resetPassword(t, String(b.token ?? ""), String(b.password ?? "")); await aud({ type: "anonymous" }, "auth.password_reset_completed"); return reply(204, {}); }
        } catch (e) {
          if (e instanceof AccountError) {
            const st = { invalid_input: 400, email_taken: 409, invalid_credentials: 401, locked: 423, invalid_token: 400 }[e.code];
            status = st; res.writeHead(st, { ...SECURITY_HEADERS, "content-security-policy": CSP_API, "content-type": "application/json", "cache-control": "no-store", "x-correlation-id": cid });
            return void res.end(JSON.stringify({ error: { code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) } }));
          }
          throw e;
        }
        return fail(404, "not_found", "Not found");
      }

      // ---- admin configuration: Bearer key bound to exactly this tenant; any failure is the same generic 401
      if (path === "admin" || path.startsWith("admin/")) {
        route = "admin"; const adm = deps.admin;
        if (!adm) return fail(404, "not_found", "Not found");
        if (!allow(limiter.admin, client)) return tooMany();
        const auth = req.headers["authorization"]; const bearer = typeof auth === "string" ? /^Bearer (\S+)$/.exec(auth)?.[1] : undefined;
        if ((await adm.keys.verify(bearer)) !== t) return fail(401, "unauthorized", "Unauthorized");
        const sub = path.slice("admin".length).replace(/^\//, ""); const M = req.method;
        const aobj = async () => { const b = await readBody(req); if (typeof b !== "object" || b === null || Array.isArray(b)) throw new AdminValidationError("body must be an object"); return b as Record<string, any>; };
        const idp = "([A-Za-z0-9_-]{1,64})"; let am: RegExpExecArray | null;
        try {
          if (M === "GET" && sub === "clinics") return reply(200, { clinics: await adm.config.listClinics(t) });
          if (M === "POST" && sub === "clinics") return reply(201, await adm.config.createClinic(t, (await aobj()) as any));
          if (M === "PATCH" && (am = new RegExp(`^clinics/${idp}$`).exec(sub))) return reply(200, await adm.config.updateClinic(t, am[1]!, (await aobj()) as any));
          if (M === "PUT" && (am = new RegExp(`^clinics/${idp}/visit-types/${idp}$`).exec(sub))) { const b = await aobj(); if (typeof b.active !== "boolean") throw new AdminValidationError("active must be true or false"); await adm.config.setClinicVisitType(t, am[1]!, am[2]!, b.active); return reply(204, {}); }
          if (M === "GET" && (am = new RegExp(`^providers/${idp}/clinics/${idp}/availability$`).exec(sub))) return reply(200, { rules: await adm.config.getAvailability(t, am[1]!, am[2]!) });
          if (M === "PUT" && (am = new RegExp(`^providers/${idp}/clinics/${idp}/availability$`).exec(sub))) { const b = await aobj(); await adm.config.setAvailability(t, am[1]!, am[2]!, b.rules); return reply(200, { rules: await adm.config.getAvailability(t, am[1]!, am[2]!) }); }
          if (M === "POST" && (am = new RegExp(`^providers/${idp}/time-off$`).exec(sub))) { const b = await aobj(); return reply(201, { id: await adm.config.addTimeOff(t, am[1]!, String(b.startsAt), String(b.endsAt)) }); }
          if (M === "DELETE" && (am = /^time-off\/(\d{1,12})$/.exec(sub))) { await adm.config.removeTimeOff(t, Number(am[1])); return reply(204, {}); }
          if (deps.staff && M === "POST" && sub === "staff") { const c = await deps.staff.accounts.create(t, (await aobj()) as any); await deps.audit?.record({ tenantId: t, actor: { type: "admin" }, action: "admin.staff_create", targetType: "staff", targetId: c.id }); return reply(201, { staff: c }); }
          if (deps.staff && M === "GET" && sub === "staff") return reply(200, { staff: await deps.staff.accounts.list(t) });
          if (deps.staff && M === "PATCH" && (am = new RegExp(`^staff/${idp}$`).exec(sub))) { const b = await aobj(); if (typeof b.active !== "boolean") throw new AdminValidationError("active must be true or false"); await deps.staff.accounts.setActive(t, am[1]!, b.active); await deps.audit?.record({ tenantId: t, actor: { type: "admin" }, action: b.active ? "admin.staff_activate" : "admin.staff_deactivate", targetType: "staff", targetId: am[1]! }); return reply(204, {}); }
          if (deps.staff && M === "PUT" && (am = new RegExp(`^staff/${idp}/password$`).exec(sub))) { const b = await aobj(); await deps.staff.accounts.setPassword(t, am[1]!, String(b.password ?? "")); await deps.audit?.record({ tenantId: t, actor: { type: "admin" }, action: "admin.staff_password_set", targetType: "staff", targetId: am[1]! }); return reply(204, {}); }
          if (deps.staff && M === "GET" && sub === "fhir/Appointment") {
            const rows = await deps.staff.desk.range(t, { id: "admin", name: "admin", email: "", role: "admin", providerId: null }, q.get("from") ?? "", q.get("to") ?? "");
            await deps.audit?.record({ tenantId: t, actor: { type: "admin" }, action: "export.fhir", detail: { count: rows.length } });
            status = 200; res.writeHead(200, { ...SECURITY_HEADERS, "content-security-policy": CSP_API, "content-type": "application/fhir+json", "cache-control": "no-store", "x-correlation-id": cid });
            return void res.end(JSON.stringify(toFhir(rows, `${req.headers["x-forwarded-proto"] ?? "https"}://${req.headers.host}/t/${tenantSlug}/api/admin/fhir`)));
          }
          if (deps.audit && M === "GET" && sub === "audit") return reply(200, { entries: await deps.audit.list(t, { limit: Number(q.get("limit") ?? 100), ...(q.get("before") ? { before: Number(q.get("before")) } : {}), ...(q.get("action") ? { action: q.get("action")! } : {}), ...(q.get("targetId") ? { targetId: q.get("targetId")! } : {}) }) });
          if (M === "GET" && (am = new RegExp(`^clinics/${idp}/closures$`).exec(sub))) return reply(200, { closures: await adm.config.listClosures(t, am[1]!) });
          if (M === "POST" && (am = new RegExp(`^clinics/${idp}/closures$`).exec(sub))) { const b = await aobj(); return reply(201, await adm.config.addClosure(t, am[1]!, String(b.startsAt), String(b.endsAt), String(b.reason ?? ""))); }
          if (M === "DELETE" && (am = /^closures\/(\d{1,12})$/.exec(sub))) { await adm.config.removeClosure(t, Number(am[1])); return reply(204, {}); }
          if (M === "PATCH" && sub === "brand") return reply(200, { brand: await adm.config.updateBrand(t, (await aobj()) as any) });
          if (M === "PUT" && sub === "analytics") { const b = await aobj(); if (typeof b.enabled !== "boolean") throw new AdminValidationError("enabled must be true or false"); await adm.config.setAnalytics(t, b.enabled); return reply(204, {}); }
        } catch (e) {
          if (e instanceof StaffError) return fail({ invalid_input: 400, invalid_credentials: 401, locked: 423, forbidden: 403, not_found: 404, conflict: 409 }[e.code], e.code, e.message);
          if (e instanceof AdminNotFoundError) return fail(404, "not_found", "Not found");
          if (e instanceof AdminValidationError) return fail(400, "invalid_request", e.message);
          throw e;
        }
        return fail(404, "not_found", "Not found");
      }

      // ---- staff console: separate cookie and accounts from patients; role-checked on every route
      if (path.startsWith("staff/") && deps.staff) {
        route = "staff"; const { accounts: sa, desk } = deps.staff; const sub = path.slice(6);
        if (!allow(limiter.auth, client)) return tooMany();
        const setStaff = (token: string | undefined) => {
          const attrs = [`${STAFF_COOKIE}=${token ?? ""}`, `Path=/t/${tenantSlug}`, "HttpOnly", "SameSite=Strict", token ? `Max-Age=${STAFF_SECONDS}` : "Max-Age=0"];
          if (deps.secureCookies) attrs.push("Secure");
          res.setHeader("set-cookie", attrs.join("; "));
        };
        try {
          if (req.method === "POST" && sub === "login") {
            const b = await obj(); if (!allow(limiter.loginId, `staff:${t}:${String(b.email).toLowerCase()}`)) return tooMany();
            try { const r = await sa.login(t, String(b.email ?? ""), String(b.password ?? "")); setStaff(r.token); await aud({ type: "staff", id: r.staff.id }, "staff.login"); return reply(200, { staff: r.staff }); }
            catch (e) { if (e instanceof StaffError) await aud({ type: "anonymous" }, "staff.login_failed", { detail: { email: createHash("sha256").update(String(b.email ?? "").toLowerCase()).digest("hex").slice(0, 12) } }); throw e; }
          }
          const me = await sa.authenticate(t, cookieOf(req, STAFF_COOKIE));
          if (sub === "logout" && req.method === "POST") { await sa.logout(t, cookieOf(req, STAFF_COOKIE)); if (me) await aud({ type: "staff", id: me.id }, "staff.logout"); setStaff(undefined); return reply(204, {}); }
          if (!me) return fail(401, "unauthorized", "Please log in");
          const actor: Actor = { type: "staff", id: me.id };
          const need = (...roles: StaffPrincipal["role"][]) => { if (!roles.includes(me.role)) throw new StaffError("forbidden", "You don't have access to this"); };
          const idm = (v: string | undefined) => { const r = Id.safeParse(v); if (!r.success) throw new StaffError("invalid_input", "Invalid request"); return r.data; };
          const apptId = "([A-Za-z0-9-]{6,32})"; let sm: RegExpExecArray | null;
          if (req.method === "GET" && sub === "me") return reply(200, { staff: me });
          if (req.method === "GET" && sub === "catalog") return reply(200, await desk.catalog(t, me));
          if (req.method === "GET" && sub === "schedule") {
            const rows = await desk.schedule(t, me, { date: q.get("date") ?? "", ...(q.get("clinicId") ? { clinicId: idm(q.get("clinicId")!) } : {}), ...(q.get("providerId") ? { providerId: idm(q.get("providerId")!) } : {}) });
            await aud(actor, "schedule.view", { detail: { date: q.get("date"), count: rows.length } }); return reply(200, { appointments: rows });
          }
          if (req.method === "GET" && sub === "slots") return reply(200, { slots: await desk.slots(t, me, { clinicId: idm(q.get("clinicId") ?? ""), serviceId: idm(q.get("serviceId") ?? ""), providerId: idm(q.get("providerId") ?? "") }) });
          if (req.method === "POST" && sub === "appointments") {
            need("front_desk", "admin"); const row = await desk.book(t, me, await obj());
            await aud(actor, "staff.booking_create", { targetType: "appointment", targetId: row.id }); void deps.notifier?.dispatch({ appointmentId: row.id }).catch(() => {}); return reply(201, { appointment: row });
          }
          if ((sm = new RegExp(`^appointments/${apptId}$`).exec(sub)) && req.method === "GET") { const row = await desk.get(t, me, sm[1]!); await aud(actor, "appointment.view", { targetType: "appointment", targetId: row.id }); return reply(200, { appointment: row }); }
          if ((sm = new RegExp(`^appointments/${apptId}/(status|cancel|reschedule)$`).exec(sub)) && req.method === "POST") {
            const b = await obj(); const id = sm[1]!; const act = sm[2]!;
            if (act === "status") {
              if (me.role === "provider" && !["arrived", "completed"].includes(String(b.status))) throw new StaffError("forbidden", "Providers can mark visits arrived or completed");
              const row = await desk.setStatus(t, me, id, String(b.status ?? "")); await aud(actor, "appointment.status", { targetType: "appointment", targetId: id, detail: { status: row.status } }); return reply(200, { appointment: row });
            }
            need("front_desk", "admin");
            if (act === "cancel") { const row = await desk.cancel(t, me, id, String(b.reason ?? "")); await aud(actor, "staff.booking_cancel", { targetType: "appointment", targetId: id }); void deps.notifier?.dispatch({ appointmentId: id }).catch(() => {}); return reply(200, { appointment: row }); }
            const row = await desk.reschedule(t, me, id, String(b.slotId ?? "")); await aud(actor, "staff.booking_reschedule", { targetType: "appointment", targetId: id }); void deps.notifier?.dispatch({ appointmentId: id }).catch(() => {}); return reply(200, { appointment: row });
          }
          if (req.method === "GET" && sub === "export.csv") {
            need("front_desk", "admin"); const from = q.get("from") ?? "", to = q.get("to") ?? "";
            const rows = await desk.range(t, me, from, to); await aud(actor, "export.csv", { detail: { from, to, count: rows.length } });
            status = 200; res.writeHead(200, { ...SECURITY_HEADERS, "content-security-policy": CSP_API, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="appointments-${from}-to-${to}.csv"`, "cache-control": "no-store", "x-correlation-id": cid });
            return void res.end(toCsv(rows));
          }
          // hours, time off and closures
          const adm = deps.admin?.config; if (!adm) return fail(404, "not_found", "Not found");
          const idp = "([A-Za-z0-9_-]{1,64})";
          const own = (providerId: string) => { if (me.role === "provider" && me.providerId !== providerId) throw new StaffError("forbidden", "You can only change your own schedule"); };
          if ((sm = new RegExp(`^providers/${idp}/clinics/${idp}/availability$`).exec(sub))) {
            own(sm[1]!);
            if (req.method === "GET") return reply(200, { rules: await adm.getAvailability(t, sm[1]!, sm[2]!) });
            if (req.method === "PUT") { need("front_desk", "admin"); const b = await obj(); await adm.setAvailability(t, sm[1]!, sm[2]!, b.rules); await aud(actor, "schedule.hours_change", { targetType: "provider", targetId: sm[1]! }); return reply(200, { rules: await adm.getAvailability(t, sm[1]!, sm[2]!) }); }
          }
          if ((sm = new RegExp(`^providers/${idp}/time-off$`).exec(sub))) {
            own(sm[1]!);
            if (req.method === "GET") return reply(200, { timeOff: await adm.listTimeOff(t, sm[1]!) });
            if (req.method === "POST") { const b = await obj(); const id = await adm.addTimeOff(t, sm[1]!, String(b.startsAt), String(b.endsAt)); await aud(actor, "schedule.time_off_add", { targetType: "provider", targetId: sm[1]! }); return reply(201, { id }); }
          }
          if (req.method === "DELETE" && (sm = /^time-off\/(\d{1,12})$/.exec(sub))) { need("front_desk", "admin"); await adm.removeTimeOff(t, Number(sm[1])); await aud(actor, "schedule.time_off_remove"); return reply(204, {}); }
          if ((sm = new RegExp(`^clinics/${idp}/closures$`).exec(sub))) {
            need("front_desk", "admin");
            if (req.method === "GET") return reply(200, { closures: await adm.listClosures(t, sm[1]!) });
            if (req.method === "POST") { const b = await obj(); const r = await adm.addClosure(t, sm[1]!, String(b.startsAt), String(b.endsAt), String(b.reason ?? "")); await aud(actor, "schedule.closure_add", { targetType: "clinic", targetId: sm[1]!, detail: { affected: r.affectedAppointments } }); return reply(201, r); }
          }
          if (req.method === "DELETE" && (sm = /^closures\/(\d{1,12})$/.exec(sub))) { need("front_desk", "admin"); await adm.removeClosure(t, Number(sm[1])); await aud(actor, "schedule.closure_remove"); return reply(204, {}); }
        } catch (e) {
          if (e instanceof StaffError) {
            const st = { invalid_input: 400, invalid_credentials: 401, locked: 423, forbidden: 403, not_found: 404, conflict: 409 }[e.code];
            return fail(st, e.code, e.code === "invalid_input" || e.code === "conflict" ? e.message : e.code === "not_found" ? "Not found" : e.message);
          }
          if (e instanceof AdminNotFoundError) return fail(404, "not_found", "Not found");
          if (e instanceof AdminValidationError) return fail(400, "invalid_request", e.message);
          throw e;
        }
        return fail(404, "not_found", "Not found");
      }

      // ---- everything below needs a signed-in account of THIS tenant (the session cookie is scoped to the tenant and is checked against it)
      const me = await deps.accounts.authenticate(t, cookieOf(req, COOKIE));
      if (!me) return fail(401, "unauthorized", "Please log in");
      const user = deps.accounts.principal(me);

      if (req.method === "GET") {
        if (path === "states") { route = "states"; return reply(200, { states: await deps.catalog.states(t) }); }
        if (path === "clinics") {
          route = "clinics"; const st = StateCode.safeParse(q.get("state"));
          if (!st.success) return fail(400, "invalid_request", "Invalid request");
          return reply(200, { clinics: await deps.catalog.clinics(t, st.data) });
        }
        let mm = /^clinics\/([^/]+)\/visit-types$/.exec(path);
        if (mm) {
          route = "visit-types"; const id = Id.safeParse(mm[1]);
          if (!id.success) return fail(400, "invalid_request", "Invalid request");
          return reply(200, { visitTypes: await deps.catalog.visitTypes(t, id.data) });
        }
        if (path === "intake-config" && deps.intake) { route = "intake-config"; return reply(200, { ...(await deps.intake.config(t)), redFlags: RED_FLAGS }); }
        if (path === "patients" && deps.intake) { route = "patients"; return reply(200, { patients: await deps.intake.list(t, user.id) }); }
        if (path === "coverage" && deps.intake) {
          route = "coverage"; const c = Id.safeParse(q.get("clinicId")), s = Id.safeParse(q.get("serviceId"));
          if (!c.success || !s.success) return fail(400, "invalid_request", "Invalid request");
          return reply(200, await deps.intake.preview(t, user.id, c.data, s.data));
        }
        if (path === "first-available") {
          route = "first-available"; const c = Id.safeParse(q.get("clinicId")), s = Id.safeParse(q.get("serviceId")), pt = q.get("patientId");
          if (!c.success || !s.success || (pt !== null && !Id.safeParse(pt).success)) return fail(400, "invalid_request", "Invalid request");
          return reply(200, { slots: await deps.bookings.firstAvailable(t, c.data, s.data, { userId: user.id, ...(pt ? { patientId: pt } : {}) }) });
        }
        if (path === "waitlist" && deps.waitlist) { route = "waitlist"; return reply(200, { entries: await deps.waitlist.list(t, user.id) }); }
        if (path === "providers" || path === "slots") {
          route = path; const c = Id.safeParse(q.get("clinicId")), s = Id.safeParse(q.get("serviceId"));
          if (!c.success || !s.success) return fail(400, "invalid_request", "Invalid request");
          if (path === "providers") return reply(200, { providers: await deps.catalog.providers(t, c.data, s.data) });
          const p = Id.safeParse(q.get("providerId"));
          if (!p.success) return fail(400, "invalid_request", "Invalid request");
          return reply(200, { slots: await deps.bookings.slots(t, c.data, s.data, p.data, { userId: user.id }), note: "Availability is provisional until the booking is confirmed." });
        }
        mm = /^bookings\/by-key\/([A-Za-z0-9_-]{8,64})$/.exec(path);
        if (mm) {
          route = "booking-by-key";
          const o = await deps.bookings.reconcile(t, user.id, mm[1]!);
          return o ? reply(200, o) : fail(404, "not_found", "Not found");
        }
        if (path === "bookings") { route = "my-bookings"; await aud({ type: "user", id: user.id }, "booking.list"); return reply(200, { appointments: await deps.bookings.list(t, user.id) }); }
      }
      // ---- an account's own booking: view, cancel, reschedule (another user's booking answers 404)
      const mg = /^bookings\/([A-Za-z0-9-]{6,32})(?:\/(cancel|reschedule))?$/.exec(path);
      if (mg) {
        route = "manage"; const id = mg[1]!; const action = mg[2];
        if (req.method === "GET" && !action) { const a = await deps.bookings.managed(t, user.id, id); if (a) await aud({ type: "user", id: user.id }, "booking.view", { targetType: "appointment", targetId: id }); return a ? reply(200, a) : fail(404, "not_found", "Not found"); }
        if (req.method === "POST" && action === "cancel") { const cb = await readBody(req).catch(() => ({})) as Record<string, unknown> | null; const a = await deps.bookings.cancel(t, user.id, id, typeof cb?.reason === "string" ? cb.reason : undefined); await aud({ type: "user", id: user.id }, "booking.cancel", { targetType: "appointment", targetId: id }); void deps.notifier?.dispatch({ appointmentId: id }).catch(() => {}); emitTelemetry(tel, { event: "booking_cancelled", tenantId: t, correlationId: cid }); return reply(200, a); }
        if (req.method === "POST" && action === "reschedule") {
          const body = RescheduleRequest.safeParse(await readBody(req));
          if (!body.success) return fail(400, "invalid_request", "Invalid request");
          const o = await deps.bookings.reschedule(t, user.id, id, body.data.slotId);
          if (o.status === "rescheduled") { emitTelemetry(tel, { event: "booking_rescheduled", tenantId: t, correlationId: cid }); await aud({ type: "user", id: user.id }, "booking.reschedule", { targetType: "appointment", targetId: id }); }
          return reply(o.status === "rescheduled" ? 200 : 409, o);
        }
        return fail(404, "not_found", "Not found");
      }
      if (req.method === "POST" && deps.waitlist && path === "waitlist") {
        route = "join-waitlist"; const b = await obj();
        const c = Id.safeParse(b.clinicId), sv = Id.safeParse(b.serviceId);
        const pv = b.providerId === undefined || b.providerId === null || b.providerId === "" ? undefined : Id.safeParse(b.providerId);
        const pt = b.patientId === undefined || b.patientId === null || b.patientId === "" ? undefined : Id.safeParse(b.patientId);
        if (!c.success || !sv.success || (pv && !pv.success) || (pt && !pt.success)) return fail(400, "invalid_request", "Invalid request");
        try { return reply(201, { entry: await deps.waitlist.join(t, user.id, { clinicId: c.data, serviceId: sv.data, ...(pv?.success ? { providerId: pv.data } : {}), ...(pt?.success ? { patientId: pt.data } : {}) }) }); }
        catch (e) { if (e instanceof WaitlistError) return fail(e.code === "not_found" ? 404 : 409, e.code, e.message); throw e; }
      }
      const wl = /^waitlist\/(\d{1,12})\/leave$/.exec(path);
      if (req.method === "POST" && deps.waitlist && wl) { route = "leave-waitlist"; return (await deps.waitlist.leave(t, user.id, Number(wl[1]))) ? reply(200, { left: true }) : fail(404, "not_found", "Not found"); }
      if (req.method === "POST" && path === "notifications") {
        route = "notify-prefs"; const b = await obj();
        await deps.accounts.setNotify(t, user.id, { ...(typeof b.email === "boolean" ? { email: b.email } : {}), ...(typeof b.sms === "boolean" ? { sms: b.sms } : {}) });
        return reply(200, { notify: (await deps.accounts.authenticate(t, cookieOf(req, COOKIE)))?.notify });
      }
      if (req.method === "POST" && deps.intake && path === "patients") {
        route = "add-patient";
        const b = (await readBody(req)) as Record<string, unknown> | null;
        try { const pt = await deps.intake.addDependent(t, user.id, { relationship: String(b?.relationship ?? ""), firstName: String(b?.firstName ?? ""), lastName: String(b?.lastName ?? ""), dateOfBirth: String(b?.dateOfBirth ?? "") }); await aud({ type: "user", id: user.id }, "patient.add", { targetType: "patient", targetId: pt.id }); return reply(201, { patient: pt }); }
        catch (e) { if (e instanceof IntakeError) return fail(400, e.code, e.message); throw e; }
      }
      const rp = /^patients\/([A-Za-z0-9_-]{6,80})\/remove$/.exec(path);
      if (req.method === "POST" && deps.intake && rp) {
        route = "remove-patient";
        try { if (await deps.intake.removeDependent(t, user.id, rp[1]!)) { await aud({ type: "user", id: user.id }, "patient.remove", { targetType: "patient", targetId: rp[1]! }); return reply(200, { removed: true }); } return fail(404, "not_found", "Not found"); }
        catch (e) { if (e instanceof IntakeError) return fail(409, e.code, e.message); throw e; }
      }
      if (req.method === "POST" && path === "bookings") {
        route = "create-booking";
        emitTelemetry(tel, { event: "booking_confirm_attempted", tenantId: t, correlationId: cid });
        const body = await readBody(req);
        const key = String(req.headers["idempotency-key"] ?? "");
        const outcome = await deps.bookings.create(t, user, body, key);
        emitTelemetry(tel, { event: outcome.status === "confirmed" ? "booking_confirmed" : "booking_failed", tenantId: t, correlationId: cid, errorCode: outcome.status === "confirmed" ? undefined : outcome.status });
        if (outcome.status === "confirmed") await aud({ type: "user", id: user.id }, "booking.create", { targetType: "appointment", targetId: outcome.bookingId });
        if (outcome.status === "failed" && outcome.code === "emergency_redirect") await aud({ type: "user", id: user.id }, "booking.emergency_redirect");
        if (outcome.status === "confirmed") await deps.notifier?.dispatch({ appointmentId: outcome.bookingId }).catch(() => undefined);   // best effort: the outbox retries later
        const code = outcome.status === "failed" ? (outcome.retryable ? 503 : 409) : { confirmed: 201, pending: 202, slot_unavailable: 409 }[outcome.status];
        return reply(code, outcome);
      }
      return fail(404, "not_found", "Not found");
    } catch (e) {
      if (e instanceof DomainError) {
        const s = { not_found: 404, invalid_request: 400, idempotency_conflict: 422, payload_too_large: 413, change_window_closed: 409, scheduling_unavailable: 503 }[e.code];
        return fail(s, e.code, e.code === "not_found" ? "Not found" : e.message);
      }
      deps.log?.({ correlationId: cid, event: "internal_error", error: e instanceof Error ? e.name : "unknown", code: (e as { code?: unknown })?.code });   // class and SQLSTATE only: messages may quote patient data
      if (process.env.CAREX_DEBUG_ERRORS) console.error(e);
      return fail(500, "internal_error", "Something went wrong");                                    // never leak internals
    } finally {
      deps.log?.(redact({ correlationId: cid, tenant: tenantSlug, route, method: req.method, status, durationMs: Date.now() - started }));
    }
  });
}
