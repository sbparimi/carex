"""More staff tools: a calendar grid, the waiting list, insights, practice setup and share links (QR codes)."""
from __future__ import annotations

import io
from datetime import timedelta
from urllib.parse import quote

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response

from .admin import AdminNotFoundError, AdminValidationError
from .states import US_STATES
from .util import local_parts, parse
from .web import ID, Web, form, s

FIRST_HOUR, LAST_HOUR = 6, 21           # the grid shows 06:00 to 21:00 in quarter-hour rows


def register(app: FastAPI, W: Web) -> None:
    c = W.c
    P = "/t/{slug}/staff"

    def bad_id(*vals):
        if not all(isinstance(v, str) and ID.match(v) for v in vals):
            raise HTTPException(400, "Invalid request")

    def base_url(request: Request, slug: str) -> str:
        import os
        configured = os.environ.get("APP_BASE_URL") or (("https://" + os.environ["VERCEL_PROJECT_PRODUCTION_URL"]) if os.environ.get("VERCEL_PROJECT_PRODUCTION_URL") else "")
        return f"{(configured or str(request.base_url)).rstrip('/')}/t/{slug}"

    def pick_list(clinics: list[dict], selected: str) -> list[dict]:
        """The first 80 clinics for a drop-down, plus the selected one so the page always shows what it is filtered on."""
        out = clinics[:80]
        if selected and not any(x["id"] == selected for x in out):
            out = out + [x for x in clinics if x["id"] == selected]
        return out

    # ------------------------------------------------------------------ calendar grid
    @app.get(P + "/calendar")
    def calendar(slug: str, request: Request, date: str = "", clinic: str = ""):
        t = W.tenant(slug)
        st = W.need_staff(request, t)
        cat = c.desk.catalog(t["id"], st)
        cl = next((x for x in cat["clinics"] if x["id"] == clinic), None) or (cat["clinics"][0] if cat["clinics"] else None)
        if not cl:
            raise HTTPException(404, "Not found")
        if not date:
            l = local_parts(c.clock(), cl["time_zone"])
            date = f"{l['year']:04d}-{l['month']:02d}-{l['day']:02d}"
        rows = [r for r in c.desk.schedule(t["id"], st, date, cl["id"]) if r["status"] != "cancelled"]
        cols = {p["id"]: i + 1 for i, p in enumerate(cl["providers"][:12])}
        blocks = []
        for r in rows:
            if r["provider_id"] not in cols:
                continue
            a, b = local_parts(parse(r["starts_at"]), r["time_zone"])["minute_of_day"], local_parts(parse(r["ends_at"]), r["time_zone"])["minute_of_day"]
            s0 = (a // 60 - FIRST_HOUR) * 4 + (a % 60) // 15
            span = max(1, min(16, (b - a + 14) // 15))
            if s0 < 0 or s0 >= (LAST_HOUR - FIRST_HOUR) * 4:
                continue
            blocks.append({**r, "row": s0 + 2, "span": span, "col": cols[r["provider_id"]] + 1, "start_label": f"{(a // 60) % 12 or 12}:{a % 60:02d} {'AM' if a < 720 else 'PM'}"})
        hours = [{"row": (h - FIRST_HOUR) * 4 + 2, "label": f"{h % 12 or 12} {'AM' if h < 12 else 'PM'}"} for h in range(FIRST_HOUR, LAST_HOUR)]
        d = parse(date + "T00:00:00Z")
        W.audit(request, t, "staff", "calendar.view", actor_id=st["id"], detail={"date": date, "count": len(blocks)})
        return W.render(request, "staff_calendar.html", t=t, staff=st, nav="cal", cat=cat, pick=pick_list(cat["clinics"], cl["id"]), cl=cl, date=date, blocks=blocks, hours=hours, provs=cl["providers"][:12], ncols=min(len(cl["providers"]), 12),
                        prev=(d - timedelta(days=1)).date().isoformat(), next=(d + timedelta(days=1)).date().isoformat(), skipped=len(cl["providers"]) - 12 if len(cl["providers"]) > 12 else 0)

    # ------------------------------------------------------------------ waiting list
    @app.get(P + "/waitlist")
    def waitlist(slug: str, request: Request, clinic: str = "", n: str = ""):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        clinic = clinic if ID.match(clinic or "") else ""
        rows = c.insights.waitlist(t["id"], clinic or None)
        W.audit(request, t, "staff", "waitlist.view", actor_id=st["id"], detail={"count": len(rows)})
        return W.render(request, "staff_waitlist.html", t=t, staff=st, nav="wl", rows=rows, clinic=clinic, clinics=pick_list(c.desk.catalog(t["id"], st)["clinics"], clinic), notice="Removed from the waiting list." if n == "removed" else "")

    @app.post(P + "/waitlist/{wid}/remove")
    def waitlist_remove(slug: str, wid: int, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        W.allow("write", W.client(request))
        if not c.insights.remove_waitlist(t["id"], wid):
            raise HTTPException(404, "Not found")
        W.audit(request, t, "staff", "waitlist.remove", actor_id=st["id"], target_type="waitlist", target_id=str(wid))
        return W.redirect(f"/t/{slug}/staff/waitlist?n=removed")

    # ------------------------------------------------------------------ insights
    @app.get(P + "/insights")
    def insights(slug: str, request: Request, days: int = 30, clinic: str = ""):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        days = days if days in (7, 30, 90) else 30
        clinic = clinic if ID.match(clinic or "") else ""
        cats = c.desk.catalog(t["id"], st)["clinics"]
        if clinic and not any(x["id"] == clinic for x in cats):
            clinic = ""
        m = c.insights.summary(t["id"], days, clinic or None)
        W.audit(request, t, "staff", "insights.view", actor_id=st["id"])
        return W.render(request, "staff_insights.html", t=t, staff=st, nav="ins", m=m, days=days, clinic=clinic, clinics=pick_list(cats, clinic))

    # ------------------------------------------------------------------ practice setup
    SETUP_NOTES = {"brand": "Branding saved.", "clinic": "Clinic added. It stays hidden from patients until you switch it on.", "toggled": "Clinic updated.", "details": "Clinic details saved."}

    @app.get(P + "/setup")
    def setup(slug: str, request: Request, state: str = "", n: str = "", error: str = ""):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "admin")
        state = state.upper()[:2]
        known = dict(US_STATES)
        state = state if state in known else (c.db.get("SELECT state_code FROM clinics WHERE tenant_id = ? ORDER BY sort_order, name LIMIT 1", t["id"]) or {}).get("state_code", "")
        clinics = c.db.all("""SELECT id, name, city, address, state_code, time_zone, status, bookable, phone, hours_text, about, image_url, tier FROM clinics WHERE tenant_id = ? AND state_code = ? ORDER BY sort_order, name""", t["id"], state)
        tenant = c.db.get("SELECT display_name, primary_color, logo_url, support_email, support_phone FROM tenants WHERE id = ?", t["id"])
        return W.render(request, "staff_setup.html", t=t, staff=st, nav="setup", state=state, states=US_STATES, clinics=clinics, tenant=tenant, notice=SETUP_NOTES.get(n, ""), error=error[:200])

    def setup_back(slug, state, n="", error=""):
        return W.redirect(f"/t/{slug}/staff/setup?state={quote(state)}" + (f"&n={n}" if n else "") + (f"&error={quote(error)}" if error else ""))

    @app.post(P + "/setup/brand")
    def setup_brand(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "admin")
        W.allow("write", W.client(request))
        patch = {"display_name": s(f, "display_name", 80), "primary_color": s(f, "primary_color", 7), "logo_url": s(f, "logo_url", 500) or None,
                 "support_email": s(f, "support_email", 254) or None, "support_phone": s(f, "support_phone", 30) or None}
        try:
            c.admin.update_brand(t["id"], patch)
        except AdminValidationError as e:
            return setup_back(slug, s(f, "state", 2), error=str(e))
        W.audit(request, t, "staff", "setup.brand", actor_id=st["id"])
        return setup_back(slug, s(f, "state", 2), "brand")

    @app.post(P + "/setup/clinic")
    def setup_clinic(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "admin")
        W.allow("write", W.client(request))
        try:
            new = c.admin.create_clinic(t["id"], {"name": s(f, "name", 120), "city": s(f, "city", 120), "address": s(f, "address", 200), "state_code": s(f, "state_code", 2).upper(), "time_zone": s(f, "time_zone", 60)})
        except AdminValidationError as e:
            return setup_back(slug, s(f, "state_code", 2).upper(), error=str(e))
        W.audit(request, t, "staff", "setup.clinic_create", actor_id=st["id"], target_type="clinic", target_id=new["id"])
        return setup_back(slug, new["state_code"], "clinic")

    @app.post(P + "/setup/clinic/{cid}")
    def setup_clinic_update(slug: str, cid: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "admin")
        W.allow("write", W.client(request))
        bad_id(cid)
        state = s(f, "state", 2)
        try:
            if s(f, "op", 12) == "details":
                c.admin.update_clinic_details(t["id"], cid, {k: s(f, k, 400) for k in ("phone", "hours_text", "about", "image_url")})
                note = "details"
            else:
                on = s(f, "op", 12) == "on"
                c.admin.update_clinic(t["id"], cid, {"status": "active" if on else "inactive", "bookable": on})
                note = "toggled"
        except AdminNotFoundError:
            raise HTTPException(404, "Not found")
        except AdminValidationError as e:
            return setup_back(slug, state, error=str(e))
        W.audit(request, t, "staff", "setup.clinic_update", actor_id=st["id"], target_type="clinic", target_id=cid)
        return setup_back(slug, state, note)

    # ------------------------------------------------------------------ share links and QR codes
    @app.get(P + "/share")
    def share(slug: str, request: Request, state: str = "", clinic: str = ""):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        state = state.upper()[:2]
        known = dict(US_STATES)
        state = state if state in known else "CA"
        clinics = c.catalog.clinics(t["id"], state)
        sel = next((x for x in clinics if x["id"] == clinic), None)
        base = base_url(request, slug)
        link = f"{base}/book/provider?clinic={sel['id']}" if sel else f"{base}/book"
        return W.render(request, "staff_share.html", t=t, staff=st, nav="share", state=state, states=US_STATES, clinics=clinics, sel=sel, link=link, clinic=sel["id"] if sel else "",
                        snippet=f'<a href="{link}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#151515;color:#fff;text-decoration:none;font:600 16px sans-serif">Book a visit</a>')

    @app.get("/t/{slug}/qr.svg")
    def qr(slug: str, request: Request, clinic: str = ""):
        t = W.tenant(slug)
        W.allow("read", W.client(request))
        try:
            import segno
        except ImportError:
            raise HTTPException(404, "Not found")
        if clinic:
            bad_id(clinic)
            if not c.catalog.clinic(t["id"], clinic):
                raise HTTPException(404, "Not found")
        link = f"{base_url(request, slug)}/book/provider?clinic={clinic}" if clinic else f"{base_url(request, slug)}/book"
        buf = io.BytesIO()
        segno.make(link, error="m").save(buf, kind="svg", scale=6, border=2, dark="#151515", xmldecl=False, svgns=True)
        return Response(buf.getvalue(), media_type="image/svg+xml", headers={"cache-control": "public, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'"})
