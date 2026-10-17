"""The CareX web application (FastAPI): server-rendered pages, a small JSON admin/operations API, and health/dispatch endpoints."""
from __future__ import annotations

import hmac
import logging
import re
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import pages_auth, pages_patient, pages_staff, pages_staff2, pages_account
from .admin import AdminNotFoundError, AdminValidationError
from .context import Ctx, build
from .staff import StaffError, to_fhir
from .web import CSP_API, SECURITY_HEADERS, SLUG, Redirect, Web

log = logging.getLogger("carex")
STATIC = Path(__file__).parent / "static"
HEADINGS = {400: "That didn't work", 401: "Please sign in", 403: "You don't have access", 404: "Page not found", 413: "That's too large", 422: "That didn't work", 429: "Please slow down", 503: "Temporarily unavailable"}
STATUS = {"invalid_input": 400, "invalid_credentials": 401, "locked": 423, "forbidden": 403, "not_found": 404, "conflict": 409}


def create_app(ctx: Ctx | None = None) -> FastAPI:
    ctx = ctx or build()
    W = Web(ctx)
    app = FastAPI(title="CareX", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.web, app.state.ctx = W, ctx

    # ---------------------------------------------------------------- middleware: CSRF second layer + security headers
    @app.middleware("http")
    async def guard(request: Request, call_next):
        cid = str(uuid.uuid4())
        if request.method not in ("GET", "HEAD", "OPTIONS") and not re.match(r"^/t/[^/]+/api/admin(/|$)", request.url.path) and request.url.path != "/internal/dispatch":
            origin, host = request.headers.get("origin"), request.headers.get("host")
            site = request.headers.get("sec-fetch-site")
            from urllib.parse import urlparse
            # Browsers state the request's provenance in Sec-Fetch-Site; otherwise fall back to the Origin header. SameSite cookies are the first layer.
            cross = (site not in ("same-origin", "none")) if site else (origin is not None and (origin == "null" or urlparse(origin).netloc != host))
            if cross:
                return JSONResponse({"error": {"code": "forbidden", "message": "Forbidden"}}, status_code=403, headers={**SECURITY_HEADERS, "content-security-policy": CSP_API})
        resp = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            resp.headers.setdefault(k, v)
        resp.headers["x-correlation-id"] = cid
        if request.url.path.startswith("/t/") and "/api/" in request.url.path:
            resp.headers.setdefault("content-security-policy", CSP_API)
        return resp

    # ---------------------------------------------------------------- errors
    def wants_json(request: Request) -> bool:
        p = request.url.path
        return "/api/" in p or p in ("/healthz", "/internal/dispatch")

    @app.exception_handler(Redirect)
    async def on_redirect(request: Request, exc: Redirect):
        return W.redirect(exc.location)

    @app.exception_handler(StarletteHTTPException)
    async def on_http(request: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 401: "unauthorized", 403: "forbidden", 429: "rate_limited", 413: "payload_too_large"}.get(exc.status_code, "invalid_request")
        if wants_json(request):
            return JSONResponse({"error": {"code": code, "message": str(exc.detail)}}, status_code=exc.status_code, headers={**(exc.headers or {}), **SECURITY_HEADERS, "content-security-policy": CSP_API})
        m = re.match(r"^/t/([^/]+)", request.url.path)
        t = ctx.catalog.tenant_by_slug(m.group(1)) if m and SLUG.match(m.group(1)) else None
        return W.render(request, "error.html", exc.status_code, t=t, heading=HEADINGS.get(exc.status_code, "Something went wrong"), message=str(exc.detail) if exc.status_code != 404 else "We couldn't find that page.")

    @app.exception_handler(RequestValidationError)
    async def on_validation(request: Request, exc: RequestValidationError):
        return await on_http(request, StarletteHTTPException(400, "Invalid request"))

    @app.exception_handler(Exception)
    async def on_error(request: Request, exc: Exception):
        # class only: messages may quote patient data
        log.error("internal_error route=%s error=%s", request.url.path.split("?")[0][:60], type(exc).__name__)
        if wants_json(request):
            return JSONResponse({"error": {"code": "internal_error", "message": "Something went wrong"}}, status_code=500, headers={**SECURITY_HEADERS, "content-security-policy": CSP_API})
        return W.render(request, "error.html", 500, heading="Something went wrong", message="We couldn't complete that. Nothing was changed that you need to redo; please try again.")

    # ---------------------------------------------------------------- static, health, home
    @app.get("/assets/app.css")
    def css():
        return FileResponse(STATIC / "app.css", media_type="text/css", headers={"cache-control": "no-store", **SECURITY_HEADERS})

    @app.get("/healthz")
    def healthz():
        try:
            ctx.db.get("SELECT 1 AS ok")
        except Exception as e:
            log.error("healthz_failed error=%s", type(e).__name__)
            return JSONResponse({"status": "unavailable"}, status_code=503, headers={"cache-control": "no-store"})
        return JSONResponse({"status": "ok"}, headers={"cache-control": "no-store"})

    @app.get("/")
    def home(request: Request):
        rows = ctx.db.all("SELECT id, slug, display_name FROM tenants WHERE status = 'active' ORDER BY display_name")
        if rows:                                          # the first screen is always sign in / sign up
            pick = next((r for r in rows if r["slug"] == ctx.default_tenant), None) or next((r for r in rows if W.demo({"id": r["id"]}, "staff")), None) or rows[0]
            return W.redirect(f"/t/{pick['slug']}/login")
        return W.render(request, "home.html", tenants=rows)

    @app.api_route("/internal/dispatch", methods=["GET", "POST"])
    def dispatch(request: Request):
        if not ctx.cron_secret:
            raise HTTPException(404, "Not found")
        given = request.headers.get("authorization", "")
        if not hmac.compare_digest(given.encode(), f"Bearer {ctx.cron_secret}".encode()):
            raise HTTPException(401, "Unauthorized")
        return JSONResponse(ctx.notifier.dispatch(limit=200), headers={"cache-control": "no-store"})

    pages_auth.register(app, W)
    pages_patient.register(app, W)
    pages_staff.register(app, W)
    pages_staff2.register(app, W)
    pages_account.register(app, W)
    register_admin_api(app, W)
    return app


def register_admin_api(app: FastAPI, W: Web) -> None:
    """Operator/tenant-admin JSON API (ADR-004): Bearer key bound to exactly one tenant; any failure is the same generic 401."""
    c = W.c
    idp = r"([A-Za-z0-9_-]{1,64})"

    def reply(status: int, body=None):
        if status == 204:
            return Response(status_code=204, headers={**SECURITY_HEADERS, "content-security-policy": CSP_API, "cache-control": "no-store"})
        return JSONResponse(body, status_code=status, headers={"cache-control": "no-store"})

    @app.api_route("/t/{slug}/api/admin/{sub:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def admin(slug: str, sub: str, request: Request):
        t = W.tenant(slug)
        W.allow("admin", W.client(request))
        m = re.match(r"^Bearer (\S+)$", request.headers.get("authorization", ""))
        if c.admin_keys.verify(m.group(1) if m else None) != t["id"]:
            raise HTTPException(401, "Unauthorized")
        M, q, tid = request.method, request.query_params, t["id"]
        body: dict = {}
        if M in ("POST", "PUT", "PATCH"):
            raw = await request.body()
            if len(raw) > 20_000:
                raise HTTPException(413, "request body too large")
            import json
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                raise HTTPException(400, "invalid JSON")
            if not isinstance(body, dict):
                raise HTTPException(400, "body must be an object")
        return await _run(lambda: handle(t, tid, M, sub.strip("/"), q, body, request))

    async def _run(fn):
        from starlette.concurrency import run_in_threadpool
        try:
            return await run_in_threadpool(fn)
        except StaffError as e:
            raise HTTPException(STATUS.get(e.code, 400), str(e))
        except AdminNotFoundError:
            raise HTTPException(404, "Not found")
        except AdminValidationError as e:
            raise HTTPException(400, str(e))

    def handle(t, tid, M, sub, q, b, request):
        a = c.admin
        mm = None

        def rx(p):
            nonlocal mm
            mm = re.fullmatch(p, sub)
            return mm
        if M == "GET" and sub == "clinics":
            return reply(200, {"clinics": a.list_clinics(tid)})
        if M == "POST" and sub == "clinics":
            return reply(201, a.create_clinic(tid, b))
        if M == "PATCH" and rx(f"clinics/{idp}"):
            return reply(200, a.update_clinic(tid, mm[1], b))
        if M == "PUT" and rx(f"clinics/{idp}/visit-types/{idp}"):
            if not isinstance(b.get("active"), bool):
                raise AdminValidationError("active must be true or false")
            a.set_clinic_visit_type(tid, mm[1], mm[2], b["active"])
            return reply(204)
        if M == "GET" and rx(f"providers/{idp}/clinics/{idp}/availability"):
            return reply(200, {"rules": a.get_availability(tid, mm[1], mm[2])})
        if M == "PUT" and rx(f"providers/{idp}/clinics/{idp}/availability"):
            a.set_availability(tid, mm[1], mm[2], b.get("rules"))
            return reply(200, {"rules": a.get_availability(tid, mm[1], mm[2])})
        if M == "POST" and rx(f"providers/{idp}/time-off"):
            return reply(201, {"id": a.add_time_off(tid, mm[1], str(b.get("starts_at")), str(b.get("ends_at")))})
        if M == "DELETE" and rx(r"time-off/(\d{1,12})"):
            a.remove_time_off(tid, int(mm[1]))
            return reply(204)
        if M == "POST" and sub == "staff":
            st = c.staff_accounts.create(tid, email=b.get("email"), name=b.get("name"), role=b.get("role"), password=b.get("password"), provider_id=b.get("provider_id"))
            c.audit.record(tid, "admin", "admin.staff_create", target_type="staff", target_id=st["id"])
            return reply(201, {"staff": st})
        if M == "GET" and sub == "staff":
            return reply(200, {"staff": c.staff_accounts.list(tid)})
        if M == "PATCH" and rx(f"staff/{idp}"):
            if not isinstance(b.get("active"), bool):
                raise AdminValidationError("active must be true or false")
            c.staff_accounts.set_active(tid, mm[1], b["active"])
            c.audit.record(tid, "admin", "admin.staff_activate" if b["active"] else "admin.staff_deactivate", target_type="staff", target_id=mm[1])
            return reply(204)
        if M == "PUT" and rx(f"staff/{idp}/password"):
            c.staff_accounts.set_password(tid, mm[1], str(b.get("password") or ""))
            c.audit.record(tid, "admin", "admin.staff_password_set", target_type="staff", target_id=mm[1])
            return reply(204)
        if M == "GET" and sub == "fhir/Appointment":
            rows = c.desk.range(tid, {"id": "admin", "name": "admin", "email": "", "role": "admin", "provider_id": None}, q.get("from", ""), q.get("to", ""))
            c.audit.record(tid, "admin", "export.fhir", detail={"count": len(rows)})
            proto = request.headers.get("x-forwarded-proto", "https")
            return JSONResponse(to_fhir(rows, f"{proto}://{request.headers.get('host')}/t/{t['slug']}/api/admin/fhir"), media_type="application/fhir+json", headers={"cache-control": "no-store"})
        if M == "GET" and sub == "audit":
            return reply(200, {"entries": c.audit.list(tid, limit=int(q.get("limit", 100)), before=int(q["before"]) if q.get("before") else None, action=q.get("action"), target_id=q.get("target_id"))})
        if M == "GET" and rx(f"clinics/{idp}/closures"):
            return reply(200, {"closures": a.list_closures(tid, mm[1])})
        if M == "POST" and rx(f"clinics/{idp}/closures"):
            return reply(201, a.add_closure(tid, mm[1], str(b.get("starts_at")), str(b.get("ends_at")), str(b.get("reason") or "")))
        if M == "DELETE" and rx(r"closures/(\d{1,12})"):
            a.remove_closure(tid, int(mm[1]))
            return reply(204)
        if M == "PATCH" and sub == "brand":
            return reply(200, {"brand": a.update_brand(tid, b)})
        if M == "PUT" and sub == "analytics":
            if not isinstance(b.get("enabled"), bool):
                raise AdminValidationError("enabled must be true or false")
            a.set_analytics(tid, b["enabled"])
            return reply(204)
        raise HTTPException(404, "Not found")
