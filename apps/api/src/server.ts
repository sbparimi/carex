import { createServer as httpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Id, RescheduleRequest, StateCode, type BookingOutcome } from "@carex/contracts";
import type { CatalogPort } from "./catalog.js";
import { BookingService, DomainError } from "./booking-service.js";
import { emitTelemetry, redact, type TelemetrySink } from "./telemetry.js";
import { createRateLimiter } from "./ratelimit.js";
import { issueManageToken, verifyManageToken } from "./manage-token.js";
import type { AdminKeys } from "./admin-keys.js";
import { AdminNotFoundError, AdminValidationError, type SqliteAdmin } from "./sqlite-admin.js";

export interface Deps {
  catalog: CatalogPort; bookings: BookingService;
  log?: (entry: unknown) => void; telemetry?: TelemetrySink;
  /** Directory holding index.html, app.js, app.css for the patient UI. */
  staticDir?: string;
  /** HMAC secret (>= 32 chars) for guest "manage this appointment" tokens. Without it the manage endpoints answer 404. */
  manageSecret?: string;
  /** Per-client request budgets per minute; the defaults suit a single small deployment. Clients are identified by socket address (no proxy headers are trusted). */
  limits?: Partial<Record<"read" | "write" | "manage", { limit: number; windowMs: number }>>;
  /** Admin configuration API (ADR-004). Without it every /admin route answers 404. */
  admin?: { keys: AdminKeys; config: SqliteAdmin };
  /** Registered ONLY by the e2e server entry; never by the dev or production entries. */
  testHooks?: { injectFault(fault: string): void; reset(): void };
}

const ASSETS: Record<string, string> = { "app.js": "text/javascript; charset=utf-8", "manage.js": "text/javascript; charset=utf-8", "app.css": "text/css; charset=utf-8" };

const MAX_BODY = 10_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

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
  const L = { read: { limit: 300, windowMs: 60_000 }, write: { limit: 20, windowMs: 60_000 }, manage: { limit: 30, windowMs: 60_000 }, ...deps.limits };
  const limiter = { read: createRateLimiter(L.read), write: createRateLimiter(L.write), manage: createRateLimiter(L.manage), manageId: createRateLimiter({ limit: 10, windowMs: 60_000 }), admin: createRateLimiter({ limit: 60, windowMs: 60_000 }) };
  setInterval(() => Object.values(limiter).forEach((l) => l.sweep()), 60_000).unref();
  const withToken = (tenantId: string, o: BookingOutcome): BookingOutcome =>
    o.status === "confirmed" && deps.manageSecret ? { ...o, manageToken: issueManageToken(deps.manageSecret, tenantId, o.bookingId) } : o;
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
      if (deps.testHooks && req.method === "POST" && url.pathname === "/__test/reset") { deps.testHooks.reset(); return reply(204, {}); }
      if (deps.staticDir && req.method === "GET") {
        const asset = /^\/assets\/(app\.js|manage\.js|app\.css)$/.exec(url.pathname);
        if (asset) {
          route = "asset"; const body = await readFile(join(deps.staticDir, asset[1]!));
          status = 200; res.writeHead(200, { ...SECURITY_HEADERS, "content-type": ASSETS[asset[1]!]!, "cache-control": "no-store" }); return void res.end(body);
        }
        // The page shell is generic and contains no tenant data; the app shows a safe error if the tenant does not resolve.
        if (/^\/t\/[^/]*\/(manage\/?)?$/.test(url.pathname)) {
          route = "page"; const html = await readFile(join(deps.staticDir, /\/manage\/?$/.test(url.pathname) ? "manage.html" : "index.html"));
          status = 200; res.writeHead(200, { ...SECURITY_HEADERS, "content-security-policy": CSP_PAGE, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return void res.end(html);
        }
      }
      const m = /^\/t\/([^/]+)\/api\/(.+)$/.exec(url.pathname);
      if (!m) return fail(404, "not_found", "Not found");
      tenantSlug = m[1]!;
      if (!SLUG.test(tenantSlug)) return fail(400, "invalid_request", "Invalid request");           // malformed tenant id: reject safely
      const tenant = deps.catalog.tenantBySlug(tenantSlug);
      if (!tenant) return fail(404, "not_found", "Not found");                                       // FR-001: no fallback to another tenant
      const path = m[2]!.replace(/\/$/, ""); const q = url.searchParams; const t = tenant.id;
      const client = req.socket.remoteAddress ?? "unknown";
      const allow = (l: ReturnType<typeof createRateLimiter>, key: string) => { const r = l.check(key); if (!r.allowed) res.setHeader("retry-after", String(r.retryAfterSec)); return r.allowed; };
      if (!allow(req.method === "GET" ? limiter.read : limiter.write, client)) return fail(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
      const tel = tenant.analyticsEnabled ? deps.telemetry : undefined;                             // tenant analytics policy

      if (req.method === "GET") {
        if (path === "config") { route = "config"; return reply(200, { tenant: tenant.slug, brand: tenant.brand }); }
        if (path === "states") { route = "states"; return reply(200, { states: deps.catalog.states(t) }); }
        if (path === "clinics") {
          route = "clinics"; const st = StateCode.safeParse(q.get("state"));
          if (!st.success) return fail(400, "invalid_request", "Invalid request");
          return reply(200, { clinics: deps.catalog.clinics(t, st.data) });
        }
        let mm = /^clinics\/([^/]+)\/visit-types$/.exec(path);
        if (mm) {
          route = "visit-types"; const id = Id.safeParse(mm[1]);
          if (!id.success) return fail(400, "invalid_request", "Invalid request");
          return reply(200, { visitTypes: deps.catalog.visitTypes(t, id.data) });
        }
        if (path === "providers" || path === "slots") {
          route = path; const c = Id.safeParse(q.get("clinicId")), s = Id.safeParse(q.get("serviceId"));
          if (!c.success || !s.success) return fail(400, "invalid_request", "Invalid request");
          if (path === "providers") return reply(200, { providers: deps.catalog.providers(t, c.data, s.data) });
          const p = Id.safeParse(q.get("providerId"));
          if (!p.success) return fail(400, "invalid_request", "Invalid request");
          return reply(200, { slots: await deps.bookings.slots(t, c.data, s.data, p.data), note: "Availability is provisional until the booking is confirmed." });
        }
        mm = /^bookings\/by-key\/([A-Za-z0-9_-]{8,64})$/.exec(path);
        if (mm) {
          route = "booking-by-key";
          const o = await deps.bookings.reconcile(t, mm[1]!);
          return o ? reply(200, withToken(t, o)) : fail(404, "not_found", "Not found");
        }
      }
      // ---- admin configuration: Bearer key bound to exactly this tenant; any failure is the same generic 401
      if (path === "admin" || path.startsWith("admin/")) {
        route = "admin"; const adm = deps.admin;
        if (!adm) return fail(404, "not_found", "Not found");
        if (!allow(limiter.admin, client)) return fail(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
        const auth = req.headers["authorization"]; const bearer = typeof auth === "string" ? /^Bearer (\S+)$/.exec(auth)?.[1] : undefined;
        if (adm.keys.verify(bearer) !== t) return fail(401, "unauthorized", "Unauthorized");
        const sub = path.slice("admin".length).replace(/^\//, ""); const M = req.method;
        const obj = async () => { const b = await readBody(req); if (typeof b !== "object" || b === null || Array.isArray(b)) throw new AdminValidationError("body must be an object"); return b as Record<string, any>; };
        const idp = "([A-Za-z0-9_-]{1,64})"; let am: RegExpExecArray | null;
        try {
          if (M === "GET" && sub === "clinics") return reply(200, { clinics: adm.config.listClinics(t) });
          if (M === "POST" && sub === "clinics") return reply(201, adm.config.createClinic(t, (await obj()) as any));
          if (M === "PATCH" && (am = new RegExp(`^clinics/${idp}$`).exec(sub))) return reply(200, adm.config.updateClinic(t, am[1]!, (await obj()) as any));
          if (M === "PUT" && (am = new RegExp(`^clinics/${idp}/visit-types/${idp}$`).exec(sub))) { const b = await obj(); if (typeof b.active !== "boolean") throw new AdminValidationError("active must be true or false"); adm.config.setClinicVisitType(t, am[1]!, am[2]!, b.active); return reply(204, {}); }
          if (M === "GET" && (am = new RegExp(`^providers/${idp}/clinics/${idp}/availability$`).exec(sub))) return reply(200, { rules: adm.config.getAvailability(t, am[1]!, am[2]!) });
          if (M === "PUT" && (am = new RegExp(`^providers/${idp}/clinics/${idp}/availability$`).exec(sub))) { const b = await obj(); adm.config.setAvailability(t, am[1]!, am[2]!, b.rules); return reply(200, { rules: adm.config.getAvailability(t, am[1]!, am[2]!) }); }
          if (M === "POST" && (am = new RegExp(`^providers/${idp}/time-off$`).exec(sub))) { const b = await obj(); return reply(201, { id: adm.config.addTimeOff(t, am[1]!, String(b.startsAt), String(b.endsAt)) }); }
          if (M === "DELETE" && (am = /^time-off\/(\d{1,12})$/.exec(sub))) { adm.config.removeTimeOff(t, Number(am[1])); return reply(204, {}); }
          if (M === "PATCH" && sub === "brand") return reply(200, { brand: adm.config.updateBrand(t, (await obj()) as any) });
          if (M === "PUT" && sub === "analytics") { const b = await obj(); if (typeof b.enabled !== "boolean") throw new AdminValidationError("enabled must be true or false"); adm.config.setAnalytics(t, b.enabled); return reply(204, {}); }
        } catch (e) {
          if (e instanceof AdminNotFoundError) return fail(404, "not_found", "Not found");
          if (e instanceof AdminValidationError) return fail(400, "invalid_request", e.message);
          throw e;
        }
        return fail(404, "not_found", "Not found");
      }
      // ---- manage an existing booking: authorised by the guest's manage token (header, never the URL), answered with a generic 404 otherwise
      const mg = /^bookings\/([A-Za-z0-9-]{6,32})(?:\/(cancel|reschedule))?$/.exec(path);
      if (mg) {
        route = "manage"; const id = mg[1]!; const action = mg[2];
        const secret = deps.manageSecret; const th = req.headers["x-manage-token"];
        if (!secret) return fail(404, "not_found", "Not found");
        if (!allow(limiter.manage, client) || !allow(limiter.manageId, `${t}:${id}`)) return fail(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
        if (!verifyManageToken(secret, t, id, typeof th === "string" ? th : undefined)) return fail(404, "not_found", "Not found");
        if (req.method === "GET" && !action) { const a = await deps.bookings.managed(t, id); return a ? reply(200, a) : fail(404, "not_found", "Not found"); }
        if (req.method === "POST" && action === "cancel") { const a = await deps.bookings.cancel(t, id); emitTelemetry(tel, { event: "booking_cancelled", tenantId: t, correlationId: cid }); return reply(200, a); }
        if (req.method === "POST" && action === "reschedule") {
          const body = RescheduleRequest.safeParse(await readBody(req));
          if (!body.success) return fail(400, "invalid_request", "Invalid request");
          const o = await deps.bookings.reschedule(t, id, body.data.slotId);
          if (o.status === "rescheduled") emitTelemetry(tel, { event: "booking_rescheduled", tenantId: t, correlationId: cid });
          return reply(o.status === "rescheduled" ? 200 : 409, o);
        }
        return fail(404, "not_found", "Not found");
      }
      if (req.method === "POST" && path === "bookings") {
        route = "create-booking";
        emitTelemetry(tel, { event: "booking_confirm_attempted", tenantId: t, correlationId: cid });
        const body = await readBody(req);
        const key = String(req.headers["idempotency-key"] ?? "");
        const outcome = await deps.bookings.create(t, body, key);
        emitTelemetry(tel, { event: outcome.status === "confirmed" ? "booking_confirmed" : "booking_failed", tenantId: t, correlationId: cid, errorCode: outcome.status === "confirmed" ? undefined : outcome.status });
        const code = outcome.status === "failed" ? (outcome.retryable ? 503 : 409) : { confirmed: 201, pending: 202, slot_unavailable: 409 }[outcome.status];
        return reply(code, withToken(t, outcome));
      }
      return fail(404, "not_found", "Not found");
    } catch (e) {
      if (e instanceof DomainError) {
        const s = { not_found: 404, invalid_request: 400, idempotency_conflict: 422, payload_too_large: 413, change_window_closed: 409, scheduling_unavailable: 503 }[e.code];
        return fail(s, e.code, e.code === "not_found" ? "Not found" : e.message);
      }
      return fail(500, "internal_error", "Something went wrong");                                    // never leak internals
    } finally {
      deps.log?.(redact({ correlationId: cid, tenant: tenantSlug, route, method: req.method, status, durationMs: Date.now() - started }));
    }
  });
}
