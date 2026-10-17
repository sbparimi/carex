"""Staff console: sign-in, day schedule, status changes, cancel / reschedule, booking by phone, hours, time off, closures, CSV export."""
from __future__ import annotations

import hashlib
from datetime import timedelta
from urllib.parse import quote

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response

from .admin import AdminNotFoundError, AdminValidationError
from .intake import CONSENT_TEXT, INTERPRETER_LANGUAGES
from .pages_patient import group_days
from .staff import StaffError, to_csv
from .util import iso, local_parts, now as _now, parse, zoned_to_utc
from .web import CSP_API, ID, SECURITY_HEADERS, STAFF_COOKIE, STAFF_SECONDS, Web, form, s

WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
LABELS = {"arrived": "Check in", "completed": "Complete", "no_show": "No-show", "confirmed": "Undo"}
TRANSITIONS = {"confirmed": ["arrived", "completed", "no_show"], "arrived": ["completed", "confirmed"], "completed": ["arrived"], "no_show": ["confirmed"], "cancelled": []}
STATUS = {"invalid_input": 400, "invalid_credentials": 401, "locked": 423, "forbidden": 403, "not_found": 404, "conflict": 409}


def hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def register(app: FastAPI, W: Web) -> None:
    c = W.c
    P = "/t/{slug}/staff"
    W.env.globals["hhmm"] = hhmm

    def bad_id(*vals):
        if not all(isinstance(v, str) and ID.match(v) for v in vals):
            raise HTTPException(400, "Invalid request")

    def back_to(slug: str, f: dict, default: str | None = None) -> str:
        b = s(f, "back", 300)
        return b if b.startswith(f"/t/{slug}/staff") and "//" not in b and "\n" not in b else (default or f"/t/{slug}/staff")

    def fail(e: StaffError):
        raise HTTPException(STATUS.get(e.code, 400), str(e))

    def local_to_utc(value: str, tz: str) -> str:
        """datetime-local text (YYYY-MM-DDTHH:MM) in the clinic's time zone → UTC ISO."""
        try:
            d = parse(value[:16] + ":00Z")
        except Exception:
            raise AdminValidationError("enter valid start and end times")
        u = zoned_to_utc(d.year, d.month, d.day, d.hour * 60 + d.minute, tz)
        if not u:
            raise AdminValidationError("that local time does not exist (daylight saving gap)")
        return iso(u)

    # ------------------------------------------------------------------ sign-in
    @app.get(P + "/login")
    def login_page(slug: str, request: Request):
        t = W.tenant(slug)
        if W.staff(request, t):
            return W.redirect(f"/t/{slug}/staff")
        return W.render(request, "staff_login.html", t=t)

    @app.post(P + "/login")
    def login(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        W.allow("auth", W.client(request))
        email = s(f, "email", 254).lower()
        W.allow("login_id", f"staff:{t['id']}:{email}")
        try:
            st, token = c.staff_accounts.login(t["id"], email, f.get("password") or "")
        except StaffError as e:
            W.audit(request, t, "anonymous", "staff.login_failed", detail={"email": hashlib.sha256(email.encode()).hexdigest()[:12]})
            return W.render(request, "staff_login.html", STATUS.get(e.code, 401), t=t, error=str(e), email=email)
        W.audit(request, t, "staff", "staff.login", actor_id=st["id"])
        r = W.redirect(f"/t/{slug}/staff")
        W.set_cookie(r, STAFF_COOKIE, token, slug, STAFF_SECONDS, samesite="strict")
        return r

    @app.post(P + "/logout")
    def logout(slug: str, request: Request):
        t = W.tenant(slug)
        st = W.staff(request, t)
        c.staff_accounts.logout(t["id"], request.cookies.get(STAFF_COOKIE))
        if st:
            W.audit(request, t, "staff", "staff.logout", actor_id=st["id"])
        r = W.redirect(f"/t/{slug}/staff/login")
        W.set_cookie(r, STAFF_COOKIE, None, slug, 0, samesite="strict")
        return r

    # ------------------------------------------------------------------ day schedule
    @app.get(P)
    def day(slug: str, request: Request, date: str = "", clinic: str = "", provider: str = "", n: str = ""):
        t = W.tenant(slug)
        st = W.need_staff(request, t)
        cat = c.desk.catalog(t["id"], st)
        if not date:
            tz = (cat["clinics"][0]["time_zone"] if cat["clinics"] else "UTC")
            l = local_parts(c.clock(), tz)
            date = f"{l['year']:04d}-{l['month']:02d}-{l['day']:02d}"
        clinic, provider = clinic if ID.match(clinic or "") else "", provider if ID.match(provider or "") else ""
        try:
            rows = c.desk.schedule(t["id"], st, date, clinic or None, provider or None)
        except StaffError as e:
            fail(e)
        W.audit(request, t, "staff", "schedule.view", actor_id=st["id"], detail={"date": date, "count": len(rows)})
        d = parse(date + "T00:00:00Z")
        provs = {p["id"]: p for cl in cat["clinics"] for p in cl["providers"]}
        back = f"/t/{slug}/staff?date={date}&clinic={quote(clinic)}&provider={quote(provider)}"
        notices = {"done": ("Updated.", True), "moved": ("Appointment moved.", True), "booked": ("Appointment booked.", True),  "cancelled": ("Appointment cancelled.", True)}
        msg, ok = notices.get(n, ("", True))
        return W.render(request, "staff_day.html", t=t, staff=st, nav="day", cat=cat, rows=rows, date=date, clinic=clinic, provider=provider, providers=list(provs.values()),
                        prev=(d - timedelta(days=1)).date().isoformat(), next=(d + timedelta(days=1)).date().isoformat(), back=back, transitions=TRANSITIONS, labels=LABELS, notice=msg, notice_ok=ok)

    @app.post(P + "/appointments/{aid}/status")
    def set_status(slug: str, aid: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t)
        bad_id(aid)
        status = s(f, "status", 20)
        if st["role"] == "provider" and status not in ("arrived", "completed"):
            raise HTTPException(403, "Providers can mark visits arrived or completed")
        try:
            row = c.desk.set_status(t["id"], st, aid, status)
        except StaffError as e:
            fail(e)
        W.audit(request, t, "staff", "appointment.status", actor_id=st["id"], target_type="appointment", target_id=aid, detail={"status": row["status"]})
        return W.redirect(back_to(slug, f))

    @app.post(P + "/appointments/{aid}/cancel")
    def cancel(slug: str, aid: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        bad_id(aid)
        try:
            c.desk.cancel(t["id"], st, aid, s(f, "reason", 200))
        except StaffError as e:
            fail(e)
        W.audit(request, t, "staff", "staff.booking_cancel", actor_id=st["id"], target_type="appointment", target_id=aid)
        W.notify_now(aid)
        return W.redirect(back_to(slug, f))

    def resched_ctx(t, st, aid, error=""):
        r = c.desk.get(t["id"], st, aid)
        r["date"] = f"{(l := local_parts(parse(r['starts_at']), r['time_zone']))['year']:04d}-{l['month']:02d}-{l['day']:02d}"
        svc = c.db.get("SELECT visit_type_id FROM appointments WHERE tenant_id = ? AND id = ?", t["id"], aid)["visit_type_id"]
        days = group_days(c.desk.slots(t["id"], st, r["clinic_id"], svc, r["provider_id"]))
        return dict(t=t, staff=st, nav="day", r=r, days=days, error=error)

    @app.get(P + "/appointments/{aid}/reschedule")
    def resched_page(slug: str, aid: str, request: Request):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        bad_id(aid)
        try:
            return W.render(request, "staff_reschedule.html", **resched_ctx(t, st, aid))
        except StaffError as e:
            fail(e)

    @app.post(P + "/appointments/{aid}/reschedule")
    def resched(slug: str, aid: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        bad_id(aid)
        try:
            c.desk.reschedule(t["id"], st, aid, s(f, "slot", 120))
        except StaffError as e:
            if e.code == "conflict":
                return W.render(request, "staff_reschedule.html", 409, **resched_ctx(t, st, aid, str(e)))
            fail(e)
        W.audit(request, t, "staff", "staff.booking_reschedule", actor_id=st["id"], target_type="appointment", target_id=aid)
        W.notify_now(aid)
        return W.redirect(f"/t/{slug}/staff?n=moved")

    # ------------------------------------------------------------------ book on behalf of a phone / walk-in patient
    def book_ctx(t, st, q: dict, v: dict, **extra):
        cat = c.desk.catalog(t["id"], st)
        cl = next((x for x in cat["clinics"] if x["id"] == q.get("clinic")), None)
        ctx = dict(t=t, staff=st, nav="sbook", cat=cat, stage=1, cl=cl, v=v, error=None)
        if not cl:
            return ctx
        ctx["stage"] = 2
        service = q.get("service") if q.get("service") in {x["id"] for x in cl["visit_types"]} else ""
        if not service:
            return {**ctx, **extra}
        ctx.update(stage=3, service=service, provs=[p for p in cl["providers"] if service in p["visit_type_ids"]])
        provider = q.get("provider") if q.get("provider") in {p["id"] for p in ctx["provs"]} else ""
        if not provider:
            return {**ctx, **extra}
        vt = c.catalog.eligible(t["id"], cl["id"], service, provider)
        if not vt:
            return {**ctx, **extra}
        ctx.update(stage=4, provider=provider, provider_name=vt["provider"]["display_name"], visit_label=vt["visit_type"]["label"], modality=vt["visit_type"]["modality"],
                   requires_referral=vt["visit_type"]["requires_referral"], days=group_days(c.desk.slots(t["id"], st, cl["id"], service, provider)),
                   languages=INTERPRETER_LANGUAGES, consent_text=CONSENT_TEXT)
        return {**ctx, **extra}

    def empty_book_v():
        return {"slot_id": "", "first_name": "", "last_name": "", "date_of_birth": "", "phone": "", "email": "", "sms_ok": False, "reason": "",
                "modality": "", "patient_state": "", "referral_ref": "", "interpreter_language": "", "accommodations": "", "consent_attested": False}

    @app.get(P + "/book")
    def book_page(slug: str, request: Request, clinic: str = "", service: str = "", provider: str = ""):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        return W.render(request, "staff_book.html", **book_ctx(t, st, {"clinic": clinic, "service": service, "provider": provider}, empty_book_v()))

    @app.post(P + "/book")
    def book(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        W.allow("write", W.client(request))
        v = {"slot_id": s(f, "slot_id", 120), "first_name": s(f, "first_name", 80), "last_name": s(f, "last_name", 80), "date_of_birth": s(f, "date_of_birth", 10), "phone": s(f, "phone", 30),
             "email": s(f, "email", 254), "sms_ok": bool(f.get("sms_ok")), "reason": s(f, "reason", 300), "modality": s(f, "modality", 20),
             "patient_state": s(f, "patient_state", 2), "referral_ref": s(f, "referral_ref", 80), "interpreter_language": s(f, "interpreter_language", 60),
             "accommodations": s(f, "accommodations", 300), "consent_attested": bool(f.get("consent_attested"))}
        q = {"clinic": s(f, "clinic_id", 64), "service": s(f, "service_id", 64), "provider": s(f, "provider_id", 64)}
        body = {"clinic_id": q["clinic"], "service_id": q["service"], "provider_id": q["provider"], "slot_id": v["slot_id"], "first_name": v["first_name"], "last_name": v["last_name"],
                "date_of_birth": v["date_of_birth"], "phone": v["phone"], "email": v["email"], "sms_ok": v["sms_ok"], "reason": v["reason"],
                "modality": v["modality"], "patient_state": v["patient_state"], "referral_ref": v["referral_ref"], "interpreter_language": v["interpreter_language"],
                "accommodations": v["accommodations"], "consent_attested": v["consent_attested"]}
        try:
            row = c.desk.book(t["id"], st, body)
        except StaffError as e:
            status = 409 if e.code == "conflict" else 400
            if e.code == "forbidden":
                raise HTTPException(403, str(e))
            return W.render(request, "staff_book.html", status, **book_ctx(t, st, q, v, error=str(e)))
        W.audit(request, t, "staff", "staff.booking_create", actor_id=st["id"], target_type="appointment", target_id=row["id"])
        W.notify_now(row["id"])
        l = local_parts(parse(row["starts_at"]), row["time_zone"])
        return W.redirect(f"/t/{slug}/staff?date={l['year']:04d}-{l['month']:02d}-{l['day']:02d}&n=booked")

    # ------------------------------------------------------------------ hours, time off, closures
    def own(st, provider_id):
        if st["role"] == "provider" and st["provider_id"] != provider_id:
            raise HTTPException(403, "You can only change your own schedule")

    @app.get(P + "/hours")
    def hours(slug: str, request: Request, clinic: str = "", provider: str = "", n: str = ""):
        t = W.tenant(slug)
        st = W.need_staff(request, t)
        cat = c.desk.catalog(t["id"], st)
        if not cat["clinics"]:
            raise HTTPException(404, "No clinics")
        cl = next((x for x in cat["clinics"] if x["id"] == clinic), cat["clinics"][0])
        pr = next((p for p in cl["providers"] if p["id"] == provider), cl["providers"][0] if cl["providers"] else None)
        rules = timeoff = []
        if pr:
            rules = c.admin.get_availability(t["id"], pr["id"], cl["id"])
            timeoff = c.admin.list_time_off(t["id"], pr["id"])
        closures = c.admin.list_closures(t["id"], cl["id"]) if st["role"] != "provider" else []
        notices = {"saved": ("Saved.", True), "bad": ("That didn't look right. Check the times and try again.", False), "closed": ("Clinic closed for that period.", True)}
        msg, ok = notices.get(n.split(":")[0], ("", True))
        if n.startswith("closed:") and n[7:].isdigit():
            msg = f"Clinic closed for that period. {int(n[7:])} existing appointment(s) fall inside it: move them from the schedule."
        back = f"/t/{slug}/staff/hours?clinic={cl['id']}&provider={pr['id'] if pr else ''}"
        return W.render(request, "staff_hours.html", t=t, staff=st, nav="hours", cat=cat, clinic=cl, provider=pr, rules=rules, timeoff=timeoff, closures=closures, weekdays=WEEKDAYS,
                        notice=msg, notice_ok=ok, back=back)

    def hours_redirect(slug, f, n):
        return W.redirect(f"/t/{slug}/staff/hours?clinic={quote(s(f, 'clinic', 64))}&provider={quote(s(f, 'provider', 64))}&n={n}")

    def minute(v: str) -> int:
        h, m = v.split(":")[:2]
        return int(h) * 60 + int(m)

    @app.post(P + "/hours/add")
    def hours_add(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        clinic, provider = s(f, "clinic", 64), s(f, "provider", 64)
        bad_id(clinic, provider)
        try:
            rules = c.admin.get_availability(t["id"], provider, clinic)
            rules.append({"weekday": int(s(f, "weekday", 2)), "start_minute": minute(s(f, "start", 5)), "end_minute": minute(s(f, "end", 5))})
            c.admin.set_availability(t["id"], provider, clinic, rules)
        except (AdminValidationError, ValueError):
            return hours_redirect(slug, f, "bad")
        except AdminNotFoundError:
            raise HTTPException(404, "Not found")
        W.audit(request, t, "staff", "schedule.hours_change", actor_id=st["id"], target_type="provider", target_id=provider)
        return hours_redirect(slug, f, "saved")

    @app.post(P + "/hours/remove")
    def hours_remove(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        clinic, provider = s(f, "clinic", 64), s(f, "provider", 64)
        bad_id(clinic, provider)
        try:
            rules = c.admin.get_availability(t["id"], provider, clinic)
            i = int(s(f, "index", 4))
            if 0 <= i < len(rules):
                del rules[i]
            c.admin.set_availability(t["id"], provider, clinic, rules)
        except (AdminValidationError, ValueError):
            return hours_redirect(slug, f, "bad")
        except AdminNotFoundError:
            raise HTTPException(404, "Not found")
        W.audit(request, t, "staff", "schedule.hours_change", actor_id=st["id"], target_type="provider", target_id=provider)
        return hours_redirect(slug, f, "saved")

    def clinic_tz(t, clinic):
        cl = c.catalog.clinic(t["id"], clinic) or c.db.get("SELECT time_zone FROM clinics WHERE tenant_id = ? AND id = ?", t["id"], clinic)
        if not cl:
            raise HTTPException(404, "Not found")
        return cl["time_zone"]

    @app.post(P + "/time-off/add")
    def time_off_add(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t)
        clinic, provider = s(f, "clinic", 64), s(f, "provider", 64)
        bad_id(clinic, provider)
        own(st, provider)
        try:
            tz = clinic_tz(t, clinic)
            c.admin.add_time_off(t["id"], provider, local_to_utc(s(f, "starts", 16), tz), local_to_utc(s(f, "ends", 16), tz))
        except AdminValidationError:
            return hours_redirect(slug, f, "bad")
        except AdminNotFoundError:
            raise HTTPException(404, "Not found")
        W.audit(request, t, "staff", "schedule.time_off_add", actor_id=st["id"], target_type="provider", target_id=provider)
        return hours_redirect(slug, f, "saved")

    @app.post(P + "/time-off/{tid}/remove")
    def time_off_remove(slug: str, tid: int, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        try:
            c.admin.remove_time_off(t["id"], tid)
        except AdminNotFoundError:
            raise HTTPException(404, "Not found")
        W.audit(request, t, "staff", "schedule.time_off_remove", actor_id=st["id"])
        return W.redirect(back_to(slug, f, f"/t/{slug}/staff/hours"))

    @app.post(P + "/closures/add")
    def closure_add(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        clinic = s(f, "clinic", 64)
        bad_id(clinic)
        try:
            tz = clinic_tz(t, clinic)
            r = c.admin.add_closure(t["id"], clinic, local_to_utc(s(f, "starts", 16), tz), local_to_utc(s(f, "ends", 16), tz), s(f, "reason", 120))
        except AdminValidationError:
            return hours_redirect(slug, f, "bad")
        except AdminNotFoundError:
            raise HTTPException(404, "Not found")
        W.audit(request, t, "staff", "schedule.closure_add", actor_id=st["id"], target_type="clinic", target_id=clinic, detail={"affected": r["affected_appointments"]})
        return hours_redirect(slug, f, f"closed:{r['affected_appointments']}")

    @app.post(P + "/closures/{zid}/remove")
    def closure_remove(slug: str, zid: int, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        try:
            c.admin.remove_closure(t["id"], zid)
        except AdminNotFoundError:
            raise HTTPException(404, "Not found")
        W.audit(request, t, "staff", "schedule.closure_remove", actor_id=st["id"])
        return W.redirect(back_to(slug, f, f"/t/{slug}/staff/hours"))

    # ------------------------------------------------------------------ export
    @app.get(P + "/export.csv")
    def export(slug: str, request: Request, frm: str = "", to: str = ""):
        t = W.tenant(slug)
        st = W.need_staff(request, t, "front_desk", "admin")
        q = request.query_params
        frm, to = q.get("from", ""), q.get("to", "")
        try:
            rows = c.desk.range(t["id"], st, frm, to)
        except StaffError as e:
            fail(e)
        W.audit(request, t, "staff", "export.csv", actor_id=st["id"], detail={"from": frm, "to": to, "count": len(rows)})
        return Response(to_csv(rows), media_type="text/csv; charset=utf-8", headers={**SECURITY_HEADERS, "content-security-policy": CSP_API, "cache-control": "no-store",
                                                                                      "content-disposition": f'attachment; filename="appointments-{frm}-to-{to}.csv"'})
