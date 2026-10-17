"""Shared web plumbing: templates, security headers, forms, client identity, rate limits, sessions."""
from __future__ import annotations

import zlib

import logging
import re
from pathlib import Path
from urllib.parse import parse_qs

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import fmt
from .context import Ctx
from .ratelimit import RateLimiter
from .states import US_STATES as STATES56
from .triage import CRISIS, NOTICE

log = logging.getLogger("carex.web")
HERE = Path(__file__).parent
COOKIE, STAFF_COOKIE = "carex_session", "carex_staff"
SESSION_SECONDS, STAFF_SECONDS = 24 * 3600, 12 * 3600
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_BODY = 20_000
US_STATES = ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())

SECURITY_HEADERS = {"x-content-type-options": "nosniff", "referrer-policy": "same-origin", "x-frame-options": "DENY", "cross-origin-opener-policy": "same-origin",
                    "permissions-policy": "geolocation=(), camera=(), microphone=()"}
# The pages use no script and no inline style: the policy forbids both.
CSP_PAGE = "default-src 'none'; style-src 'self'; img-src 'self' https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
CSP_API = "default-src 'none'; frame-ancestors 'none'"


class Redirect(Exception):
    def __init__(self, location: str):
        self.location = location


def money(cents) -> str:
    return f"${(cents or 0) / 100:,.2f}"


def ink_for(hex_color: str) -> str:
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    lum = 0.2126 * (r / 255) ** 2.2 + 0.7152 * (g / 255) ** 2.2 + 0.0722 * (b / 255) ** 2.2
    return "#000000" if lum > 0.35 else "#ffffff"


async def form(request: Request) -> dict:
    """urlencoded form body as {name: value}; repeated names become lists under `name` + `_all`. Size-limited."""
    if int(request.headers.get("content-length") or 0) > MAX_BODY:
        raise HTTPException(413, "Request too large")
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "Request too large")
    out: dict = {}
    for k, v in parse_qs(body.decode("utf-8", "replace"), keep_blank_values=True).items():
        out[k] = v[0]
        out[k + "_all"] = v
    return out


def s(f: dict, k: str, mx: int = 500) -> str:
    return str(f.get(k) or "").strip()[:mx]


class Web:
    def __init__(self, ctx: Ctx):
        self.c = ctx
        self.env = Environment(loader=FileSystemLoader(str(HERE / "templates")), autoescape=select_autoescape(["html"]), trim_blocks=True, lstrip_blocks=True)
        self.env.filters["money"] = money
        self.env.globals.update(day_label=fmt.day_label, time_label=fmt.time_label, when=fmt.when, NOTICE=NOTICE, CRISIS=CRISIS, TAGLINE="Care, booked in a moment.", US_STATES=US_STATES, clock=fmt.clock, day_parts=fmt.day_parts, zone_name=fmt.zone_name, STATES56=STATES56, tint_of=lambda key: zlib.crc32(str(key).encode()) % 8)
        self.lim = {"read": RateLimiter(300, 60_000), "write": RateLimiter(90, 60_000), "auth": RateLimiter(30, 60_000), "login_id": RateLimiter(10, 60_000), "admin": RateLimiter(60, 60_000)}

    # ---- request identity and limits
    def client(self, request: Request) -> str:
        if self.c.trust_proxy:
            fwd = request.headers.get("x-real-ip") or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            if fwd:
                return fwd
        return request.client.host if request.client else "unknown"

    def allow(self, which: str, key: str) -> None:
        r = self.lim[which].check(key)
        if not r["allowed"]:
            raise HTTPException(429, "Too many requests. Please wait a moment and try again.", headers={"retry-after": str(r["retry_after"])})

    # ---- tenants and sessions
    def tenant(self, slug: str) -> dict:
        if not SLUG.match(slug):
            raise HTTPException(404, "Not found")
        t = self.c.catalog.tenant_by_slug(slug)
        if not t:
            raise HTTPException(404, "Not found")
        return t

    def user(self, request: Request, t: dict) -> dict | None:
        return self.c.accounts.authenticate(t["id"], request.cookies.get(COOKIE))

    def need_user(self, request: Request, t: dict) -> dict:
        u = self.user(request, t)
        if not u:
            raise Redirect(f"/t/{t['slug']}/login")
        return u

    def staff(self, request: Request, t: dict) -> dict | None:
        return self.c.staff_accounts.authenticate(t["id"], request.cookies.get(STAFF_COOKIE))

    def need_staff(self, request: Request, t: dict, *roles: str) -> dict:
        st = self.staff(request, t)
        if not st:
            raise Redirect(f"/t/{t['slug']}/staff/login")
        if roles and st["role"] not in roles:
            raise HTTPException(403, "You don't have access to this")
        return st

    def audit(self, request: Request, t: dict, actor_type: str, action: str, actor_id: str | None = None, **kw) -> None:
        self.c.audit.record(t["id"], actor_type, action, actor_id=actor_id, ip=self.client(request), **kw)

    # ---- responses
    def demo(self, t: dict | None, kind: str) -> dict | None:
        """Demo sign-in details, only for databases loaded with `seed-demo` (the demo user exists). Real databases never match."""
        if not t:
            return None
        from .seed_demo import DEMO_PASSWORD, DEMO_PATIENTS, DEMO_STAFF
        rows = DEMO_STAFF if kind == "staff" else DEMO_PATIENTS
        for r in rows:
            if r["tenant_id"] != t["id"]:
                continue
            table = "staff_users" if kind == "staff" else "users"
            if self.c.db.get(f"SELECT 1 AS ok FROM {table} WHERE tenant_id = ? AND email = ?", t["id"], r["email"]):
                return {"email": r["email"], "password": DEMO_PASSWORD}
        return None

    def visit_colors(self, t: dict | None) -> dict:
        """Each visit type of an organisation gets its own colour (0-9), stable and the same on every screen: its card, dates, times and appointments."""
        if not t:
            return {}
        rows = self.c.db.all("SELECT id FROM visit_types WHERE tenant_id = ? ORDER BY id", t["id"])
        return {r["id"]: i % 10 for i, r in enumerate(rows)}

    def render(self, request: Request, name: str, status: int = 200, t: dict | None = None, **ctx) -> HTMLResponse:
        if name.startswith(("book_", "appointments", "manage", "video_room", "reschedule", "staff_day", "staff_reschedule", "staff_book")):
            ctx["vtc"] = self.visit_colors(t)
        ctx.setdefault("guest_nav", name.startswith("book_") and not ctx.get("user") and not ctx.get("staff"))
        if name in ("login.html", "staff_login.html") and "demo" not in ctx:
            ctx["demo"] = self.demo(t, "staff" if name == "staff_login.html" else "patient")
        html = self.env.get_template(name).render(request=request, t=t, slug=t["slug"] if t else None, brand=t["brand"] if t else {"display_name": "CareX"}, **ctx)
        return HTMLResponse(html, status_code=status, headers={**SECURITY_HEADERS, "content-security-policy": CSP_PAGE, "cache-control": "no-store"})

    def set_cookie(self, resp: Response, name: str, value: str | None, slug: str, seconds: int, samesite: str = "lax") -> None:
        resp.set_cookie(name, value or "", max_age=seconds if value else 0, path=f"/t/{slug}", httponly=True, samesite=samesite, secure=self.c.secure_cookies)

    @staticmethod
    def safe_next(slug: str, nxt: str | None) -> str:
        """Where to go after signing in: only a page inside this organisation's patient area, never another site."""
        n = (nxt or "")[:600]
        ok = n.startswith(f"/t/{slug}/") and "//" not in n[1:] and "\\" not in n and "\r" not in n and "\n" not in n and ":" not in n.split("?")[0]
        return n if ok else ""

    def redirect(self, url: str) -> RedirectResponse:
        return RedirectResponse(url, status_code=303, headers={**SECURITY_HEADERS, "cache-control": "no-store"})

    def notify_now(self, appointment_id: str) -> None:
        """Best effort: the outbox retries later if sending fails here."""
        try:
            self.c.notifier.dispatch(appointment_id=appointment_id)
        except Exception as e:
            log.warning("dispatch_failed %s", type(e).__name__)
