"""Patient pages: booking steps, my appointments, family members, waiting list, reminder choices."""
from __future__ import annotations

import zlib

import secrets

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse

from .booking import DomainError
from .fmt import clock, day_label, day_parts, time_label
from .intake import IntakeError
from .states import US_STATES as STATES56
from .util import iso
from .waitlist import WaitlistError
from .web import ID, Web, form, ink_for, s


def group_days(slots: list[dict], limit: int = 200) -> list[dict]:
    days: list[dict] = []
    for sl in slots[:limit]:
        lab = day_label(sl["starts_at"], sl["time_zone"])
        if not days or days[-1]["label"] != lab:
            days.append({"label": lab, "slots": []})
        days[-1]["slots"].append({"id": sl["id"], "time": time_label(sl["starts_at"], sl["time_zone"])})
    return days


def peek_days(slots: list[dict], full: bool = False, days: int = 3, per_day: int = 8) -> dict:
    """Groups open times by clinic-local date. The overview shows the next few days; `full` shows everything the engine offers."""
    out: list[dict] = []
    for sl in slots:
        parts = day_parts(sl["starts_at"], sl["time_zone"])
        if not out or out[-1]["full"] != parts["full"]:
            if not full and len(out) >= days:
                break
            out.append({**parts, "slots": [], "hidden": 0})
        if full or len(out[-1]["slots"]) < per_day:
            out[-1]["slots"].append({"id": sl["id"], "time": clock(sl["starts_at"], sl["time_zone"])})
        else:
            out[-1]["hidden"] += 1
    first = None
    if slots:
        parts = day_parts(slots[0]["starts_at"], slots[0]["time_zone"])
        first = {**parts, "id": slots[0]["id"], "time": clock(slots[0]["starts_at"], slots[0]["time_zone"]), "starts": slots[0]["starts_at"]}
    return {"days": out, "more": (not full) and len(slots) > sum(len(d["slots"]) for d in out), "first": first}


def register(app: FastAPI, W: Web) -> None:
    c = W.c
    P = "/t/{slug}"

    def bad_id(*vals):
        if not all(isinstance(v, str) and ID.match(v) for v in vals):
            raise HTTPException(400, "Invalid request")

    @app.get("/t/{slug}/brand.css")
    def brand_css(slug: str):
        t = W.tenant(slug)
        col = t["brand"]["primary_color"]
        css = f":root {{ --brand: {col}; --brand-ink: {ink_for(col)}; }}\n"
        return PlainTextResponse(css, media_type="text/css", headers={"cache-control": "no-store"})

    @app.get(P + "/")
    def root(slug: str, request: Request):
        t = W.tenant(slug)
        return W.redirect(f"/t/{slug}/book" if W.user(request, t) else f"/t/{slug}/login")

    # ------------------------------------------------------------------ booking steps
    @app.get(P + "/book")
    def book(slug: str, request: Request, state: str = "", notice: str = ""):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        state = state.upper()[:2]
        known = dict(STATES56)
        clinics = c.catalog.clinics(t["id"], state) if state in known else []        # headquarters first, then prominent, then the other locations
        return W.render(request, "book_state.html", t=t, user=u, nav="book", states=STATES56, state=state if state in known else "", state_name=known.get(state, ""),
                        clinics=clinics, notice=notice[:120] if notice else "")

    @app.get(P + "/book/visit")
    def book_visit(slug: str, request: Request, clinic: str = ""):
        t = W.tenant(slug)
        W.need_user(request, t)
        bad_id(clinic)
        return W.redirect(f"/t/{slug}/book/provider?clinic={clinic}")

    @app.get(P + "/book/provider")
    def book_provider(slug: str, request: Request, clinic: str = "", service: str = "", provider: str = "", joined: str = "", notice: str = ""):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        bad_id(clinic, *([service] if service else []))
        cl = c.catalog.clinic(t["id"], clinic)
        if not cl:
            raise HTTPException(404, "Not found")
        visits = c.catalog.visit_types(t["id"], clinic)
        # Soonest opening first: visit types are ordered by their earliest open time, and the default is the one that can be seen soonest.
        soonest: dict[str, dict] = {}
        for v in visits:
            best = None
            for pv in c.catalog.providers(t["id"], clinic, v["id"]):
                sl = c.booking.slots(t["id"], clinic, v["id"], pv["id"], u["id"])
                if sl and (best is None or sl[0]["starts_at"] < best["starts_at"]):
                    best = sl[0]
            if best:
                soonest[v["id"]] = {**day_parts(best["starts_at"], best["time_zone"]), "time": clock(best["starts_at"], best["time_zone"]), "starts_at": best["starts_at"]}
        visits = sorted(visits, key=lambda v: (soonest[v["id"]]["starts_at"] if v["id"] in soonest else "9", v["label"]))
        visit = next((v for v in visits if v["id"] == service), None)          # nothing is shown until a visit type is chosen
        if service and not visit:
            raise HTTPException(404, "Not found")
        providers, cards = [], []
        if visit:
            providers = c.catalog.providers(t["id"], clinic, visit["id"])
            if provider:
                bad_id(provider)
                if not any(x["id"] == provider for x in providers):
                    raise HTTPException(404, "Not found")
            for p in providers:
                if provider and p["id"] != provider:
                    continue
                slots = c.booking.slots(t["id"], clinic, visit["id"], p["id"], u["id"])
                cards.append({"p": p, **peek_days(slots, full=bool(provider))})
            cards.sort(key=lambda x: x["first"]["starts"] if x.get("first") else "9")
        firsts = [(x["first"]["starts"], x["first"], x["p"]) for x in cards if x.get("first")]
        nxt = None
        if firsts:
            _, f, p = min(firsts, key=lambda z: z[0])
            nxt = {**f, "provider": p}
        return W.render(request, "book_provider.html", t=t, user=u, nav="book", clinic=cl, visits=visits, visit=visit, cards=cards, only=provider, joined=bool(joined), notice=notice[:120],
                        any_open=any(x["days"] for x in cards), nxt=nxt, soonest=soonest, overall=min(soonest.values(), key=lambda z: z["starts_at"], default=None), n_providers=len(providers), tint=W.env.globals["tint_of"](cl["id"]))

    def details_ctx(t, u, clinic, service, provider, slot_id, v, **extra):
        elig = c.catalog.eligible(t["id"], clinic, service, provider)
        if not elig:
            raise HTTPException(404, "Not found")
        slot = next((sl for sl in c.booking.slots(t["id"], clinic, service, provider, u["id"]) if sl["id"] == slot_id), None)
        cfg = c.intake.config(t["id"])
        pv = c.intake.preview(t["id"], u["id"], clinic, service)
        cfg["coverage_notice"] = ({"covered": True, "text": f"Covered by your plan. Expected copay: ${pv['copay_cents'] / 100:,.2f}, due at the visit." if pv["copay_cents"] else "Covered by your plan. No copay expected."}
                                  if pv["covered"] else {"covered": False, "text": pv.get("reason", "This visit isn't covered by your plan.")})
        return slot, dict(t=t, user=u, nav="book", clinic=elig["clinic"], visit=elig["visit_type"], provider=elig["provider"], slot=slot, cfg=cfg, patients=c.intake.list(t["id"], u["id"]), v=v, **extra)

    REASONS = ["Check-up", "New concern", "Follow-up", "Prescription refill", "Pain or injury", "Something else"]

    def empty_v():
        return {"patient_id": "", "reason": "", "reason_pick": "", "reason_text": "", "modality": "", "patient_state": "", "referral_ref": "", "interpreter_language": "", "accommodations": "", "consent": ""}

    def values(f: dict) -> dict:
        pick = s(f, "reason_pick", 40)
        pick = pick if pick in REASONS else ""
        text = s(f, "reason_text", 300)
        given = s(f, "reason", 300)                       # review/confirm pass the combined reason
        if given and not pick and not text:
            text = given
        reason = f"{pick}: {text}" if pick and text else (pick or text)
        return {"patient_id": s(f, "patient_id", 80), "reason": reason[:300], "reason_pick": pick, "reason_text": text,
                "modality": s(f, "modality", 20), "patient_state": s(f, "patient_state", 2), "referral_ref": s(f, "referral_ref", 80), "interpreter_language": s(f, "interpreter_language", 60),
                "accommodations": s(f, "accommodations", 300), "consent": s(f, "consent", 40)}

    def build_req(f: dict, v: dict) -> dict:
        return {"clinic_id": s(f, "clinic", 64), "service_id": s(f, "service", 64), "provider_id": s(f, "provider", 64), "slot_id": s(f, "slot", 120), "patient_id": v["patient_id"] or None,
                "reason": v["reason"] or None, "modality": v["modality"] or None, "patient_state": v["patient_state"] or None,
                "referral_ref": v["referral_ref"] or None, "interpreter_language": v["interpreter_language"] or None, "accommodations": v["accommodations"] or None, "consent_version": v["consent"] or None}

    @app.get(P + "/book/details")
    def details(slug: str, request: Request, clinic: str = "", service: str = "", provider: str = "", slot: str = "", choice: str = ""):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        if choice and "|" in choice:
            provider, slot = choice.split("|", 1)
            return W.redirect(f"/t/{slug}/book/details?clinic={clinic}&service={service}&provider={provider}&slot={slot}")
        bad_id(clinic, service, provider)
        sl, ctx = details_ctx(t, u, clinic, service, provider, slot, empty_v(), reasons=REASONS)
        if not sl:
            return W.redirect(f"/t/{slug}/book/provider?clinic={clinic}&service={service}&provider={provider}&notice=That time is no longer available. Please pick another.")
        return W.render(request, "book_details.html", **ctx)

    def redisplay(request, t, u, f, v, error=None, status=422):
        clinic, service, provider = s(f, "clinic", 64), s(f, "service", 64), s(f, "provider", 64)
        bad_id(clinic, service, provider)
        sl, ctx = details_ctx(t, u, clinic, service, provider, s(f, "slot", 120), v, error=error, reasons=REASONS)
        if not sl:
            return W.redirect(f"/t/{t['slug']}/book/provider?clinic={clinic}&service={service}&provider={provider}&notice=That time is no longer available. Please pick another.")
        return W.render(request, "book_details.html", status, **ctx)

    @app.post(P + "/book/details")
    def details_post(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        return redisplay(request, t, u, f, values(f), status=200)

    @app.post(P + "/book/review")
    def review(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        W.allow("write", W.client(request))
        v = values(f)
        try:
            if any(s(f, k) for k in ("dep_relationship", "dep_first_name", "dep_last_name", "dep_date_of_birth")):
                pt = c.intake.add_dependent(t["id"], u["id"], s(f, "dep_relationship", 20), s(f, "dep_first_name", 80), s(f, "dep_last_name", 80), s(f, "dep_date_of_birth", 10))
                W.audit(request, t, "user", "patient.add", actor_id=u["id"], target_type="patient", target_id=pt["id"])
                v["patient_id"] = pt["id"]
            req = build_req(f, v)
            dec = c.intake.prepare(t["id"], u["id"], req)
        except IntakeError as e:
            return redisplay(request, t, u, f, v, error=str(e))
        sl, ctx = details_ctx(t, u, req["clinic_id"], req["service_id"], req["provider_id"], req["slot_id"], v)
        if not sl:
            return W.redirect(f"/t/{slug}/book/provider?clinic={req['clinic_id']}&service={req['service_id']}&provider={req['provider_id']}&notice=That time is no longer available. Please pick another.")
        hidden = [("clinic", req["clinic_id"]), ("service", req["service_id"]), ("provider", req["provider_id"]), ("slot", req["slot_id"]), ("patient_id", dec["patient_id"]), ("reason", v["reason"]),
                  ("modality", v["modality"]), ("patient_state", v["patient_state"]), ("referral_ref", v["referral_ref"]), ("interpreter_language", v["interpreter_language"]),
                  ("accommodations", v["accommodations"]), ("consent", v["consent"]), ("key", secrets.token_urlsafe(16))]
        return W.render(request, "book_review.html", t=t, user=u, nav="book", clinic=ctx["clinic"], visit=ctx["visit"], provider=ctx["provider"], slot=sl, dec=dec, hidden=hidden, notice_minutes=c.booking.notice)

    @app.post(P + "/book/confirm")
    def confirm(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        W.allow("write", W.client(request))
        v = values(f)
        req = build_req(f, v)
        bad_id(req["clinic_id"], req["service_id"], req["provider_id"])
        try:
            o = c.booking.create(t["id"], u, req, s(f, "key", 64))
        except DomainError as e:
            raise HTTPException({"not_found": 404, "idempotency_conflict": 422}.get(e.code, 400), str(e))
        if o["status"] == "confirmed":
            W.audit(request, t, "user", "booking.create", actor_id=u["id"], target_type="appointment", target_id=o["booking_id"])
            W.notify_now(o["booking_id"])
        status = {"confirmed": 201, "slot_unavailable": 409}.get(o["status"], 503 if o.get("retryable") else 409)
        return W.render(request, "book_result.html", status, t=t, user=u, nav="book", o=o, clinic_id=req["clinic_id"], service_id=req["service_id"])

    # ------------------------------------------------------------------ waiting list
    @app.post(P + "/waitlist/join")
    def wl_join(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        W.allow("write", W.client(request))
        clinic, service, provider = s(f, "clinic_id", 64), s(f, "service_id", 64), s(f, "provider_id", 64)
        bad_id(clinic, service)
        try:
            c.waitlist.join(t["id"], u["id"], clinic, service, provider or None)
        except WaitlistError as e:
            return W.redirect(f"/t/{slug}/book/provider?clinic={clinic}&service={service}&notice={e}")
        return W.redirect(f"/t/{slug}/book/provider?clinic={clinic}&service={service}&joined=1")

    @app.post(P + "/waitlist/{wid}/leave")
    def wl_leave(slug: str, wid: int, request: Request):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        c.waitlist.leave(t["id"], u["id"], wid)
        return W.redirect(f"/t/{slug}/appointments?n=left")

    # ------------------------------------------------------------------ my appointments
    NOTICES = {"cancelled": ("Your appointment was cancelled.", True), "moved": ("Your appointment was moved.", True), "left": ("You left the waiting list.", True),
               "saved": ("Your reminder choices were saved.", True), "added": ("Family member added.", True), "removed": ("Family member removed.", True),
               "late": ("That appointment can no longer be changed online. Please call the clinic.", False), "inuse": ("This person has upcoming appointments. Cancel them first.", False),
               "bad": ("We could not add that person. Check the details and try again.", False)}

    @app.get(P + "/appointments")
    def appointments(slug: str, request: Request, n: str = ""):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        W.audit(request, t, "user", "booking.list", actor_id=u["id"])
        items = c.booking.list(t["id"], u["id"])
        now = iso(c.clock())
        upcoming = [a for a in items if a["status"] in ("confirmed", "arrived") and a["summary"]["ends_at"] > now]
        past = sorted((a for a in items if a not in upcoming), key=lambda a: a["summary"]["starts_at"], reverse=True)[:30]
        msg, ok = NOTICES.get(n, ("", True))
        return W.render(request, "appointments.html", t=t, user=u, nav="appts", upcoming=upcoming, past=past, waitlist=c.waitlist.list(t["id"], u["id"]),
                        patients=c.intake.list(t["id"], u["id"]), notice=msg, notice_ok=ok)

    @app.post(P + "/appointments/{bid}/cancel")
    def cancel(slug: str, bid: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        W.allow("write", W.client(request))
        try:
            c.booking.cancel(t["id"], u["id"], bid, s(f, "reason", 200))
        except DomainError as e:
            if e.code == "change_window_closed":
                return W.redirect(f"/t/{slug}/appointments?n=late")
            raise HTTPException(404, "Not found")
        W.audit(request, t, "user", "booking.cancel", actor_id=u["id"], target_type="appointment", target_id=bid)
        W.notify_now(bid)
        return W.redirect(f"/t/{slug}/appointments?n=cancelled")

    @app.get(P + "/appointments/{bid}/reschedule")
    def resched_page(slug: str, bid: str, request: Request, error: str = ""):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        a = c.booking.managed(t["id"], u["id"], bid)
        if not a:
            raise HTTPException(404, "Not found")
        if not a["can_change"]:
            return W.redirect(f"/t/{slug}/appointments?n=late")
        sm = a["summary"]
        days = group_days(c.booking.slots(t["id"], sm["clinic"]["id"], sm["visit_type"]["id"], sm["provider"]["id"], u["id"]))
        return W.render(request, "reschedule.html", t=t, user=u, nav="appts", a=a, days=days, error=error[:200])

    @app.post(P + "/appointments/{bid}/reschedule")
    def resched(slug: str, bid: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        W.allow("write", W.client(request))
        try:
            o = c.booking.reschedule(t["id"], u["id"], bid, s(f, "slot", 120))
        except DomainError as e:
            if e.code == "change_window_closed":
                return W.redirect(f"/t/{slug}/appointments?n=late")
            raise HTTPException(404, "Not found")
        if o["status"] == "slot_unavailable":
            return W.redirect(f"/t/{slug}/appointments/{bid}/reschedule?error=That time is no longer available. Your appointment is unchanged; please pick another.")
        W.audit(request, t, "user", "booking.reschedule", actor_id=u["id"], target_type="appointment", target_id=bid)
        W.notify_now(bid)
        return W.redirect(f"/t/{slug}/appointments?n=moved")

    @app.post(P + "/notifications")
    def notifications(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        c.accounts.set_notify(t["id"], u["id"], email=bool(f.get("email")), sms=bool(f.get("sms")))
        return W.redirect(f"/t/{slug}/appointments?n=saved")

    @app.post(P + "/patients/add")
    def add_patient(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        W.allow("write", W.client(request))
        try:
            pt = c.intake.add_dependent(t["id"], u["id"], s(f, "relationship", 20), s(f, "first_name", 80), s(f, "last_name", 80), s(f, "date_of_birth", 10))
        except IntakeError as e:
            return W.redirect(f"/t/{slug}/appointments?n=bad")
        W.audit(request, t, "user", "patient.add", actor_id=u["id"], target_type="patient", target_id=pt["id"])
        return W.redirect(f"/t/{slug}/appointments?n=added")

    @app.post(P + "/patients/{pid}/remove")
    def remove_patient(slug: str, pid: str, request: Request):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        bad_id(pid)
        try:
            ok = c.intake.remove_dependent(t["id"], u["id"], pid)
        except IntakeError:
            return W.redirect(f"/t/{slug}/appointments?n=inuse")
        if not ok:
            raise HTTPException(404, "Not found")
        W.audit(request, t, "user", "patient.remove", actor_id=u["id"], target_type="patient", target_id=pid)
        return W.redirect(f"/t/{slug}/appointments?n=removed")
