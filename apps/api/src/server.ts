import { createServer as httpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Id, StateCode } from "@carex/contracts";
import type { Catalog } from "./catalog.js";
import { BookingService, DomainError } from "./booking-service.js";
import { emitTelemetry, redact, type TelemetrySink } from "./telemetry.js";

export interface Deps {
  catalog: Catalog; bookings: BookingService;
  log?: (entry: unknown) => void; telemetry?: TelemetrySink;
  /** Directory holding index.html, app.js, app.css for the patient UI. */
  staticDir?: string;
  /** Registered ONLY by the e2e server entry; never by the dev or production entries. */
  testHooks?: { injectFault(fault: string): void; reset(): void };
}

const ASSETS: Record<string, string> = { "app.js": "text/javascript; charset=utf-8", "app.css": "text/css; charset=utf-8" };

const MAX_BODY = 10_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

const send = (res: ServerResponse, status: number, body: unknown, cid: string) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-correlation-id": cid });
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
        const asset = /^\/assets\/(app\.js|app\.css)$/.exec(url.pathname);
        if (asset) {
          route = "asset"; const body = await readFile(join(deps.staticDir, asset[1]!));
          status = 200; res.writeHead(200, { "content-type": ASSETS[asset[1]!]!, "cache-control": "no-store", "x-content-type-options": "nosniff" }); return void res.end(body);
        }
        // The page shell is generic and contains no tenant data; the app shows a safe error if the tenant does not resolve.
        if (/^\/t\/[^/]*\/?$/.test(url.pathname)) {
          route = "page"; const html = await readFile(join(deps.staticDir, "index.html"));
          status = 200; res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); return void res.end(html);
        }
      }
      const m = /^\/t\/([^/]+)\/api\/(.+)$/.exec(url.pathname);
      if (!m) return fail(404, "not_found", "Not found");
      tenantSlug = m[1]!;
      if (!SLUG.test(tenantSlug)) return fail(400, "invalid_request", "Invalid request");           // malformed tenant id: reject safely
      const tenant = deps.catalog.tenantBySlug(tenantSlug);
      if (!tenant) return fail(404, "not_found", "Not found");                                       // FR-001: no fallback to another tenant
      const path = m[2]!.replace(/\/$/, ""); const q = url.searchParams; const t = tenant.id;
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
          return o ? reply(200, o) : fail(404, "not_found", "Not found");
        }
      }
      if (req.method === "POST" && path === "bookings") {
        route = "create-booking";
        emitTelemetry(tel, { event: "booking_confirm_attempted", tenantId: t, correlationId: cid });
        const body = await readBody(req);
        const key = String(req.headers["idempotency-key"] ?? "");
        const outcome = await deps.bookings.create(t, body, key);
        emitTelemetry(tel, { event: outcome.status === "confirmed" ? "booking_confirmed" : "booking_failed", tenantId: t, correlationId: cid, errorCode: outcome.status === "confirmed" ? undefined : outcome.status });
        const code = { confirmed: 201, pending: 202, slot_unavailable: 409, failed: 503 }[outcome.status];
        return reply(code, outcome);
      }
      return fail(404, "not_found", "Not found");
    } catch (e) {
      if (e instanceof DomainError) {
        const s = { not_found: 404, invalid_request: 400, idempotency_conflict: 422, payload_too_large: 413 }[e.code];
        return fail(s, e.code, e.code === "not_found" ? "Not found" : e.message);
      }
      return fail(500, "internal_error", "Something went wrong");                                    // never leak internals
    } finally {
      deps.log?.(redact({ correlationId: cid, tenant: tenantSlug, route, method: req.method, status, durationMs: Date.now() - started }));
    }
  });
}
