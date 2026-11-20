"""Versioned JSON API for patient, provider and operational workflows.

All routes are tenant-scoped under /t/{slug}/api/v1. Browser pages remain unchanged.
Authentication uses the existing opaque CareX session tokens as Bearer tokens.
"""
from __future__ import annotations

import json
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .accounts import AccountError
from .booking import DomainError
from .intake import IntakeError
from .staff import StaffError
from .waitlist import WaitlistError
from .web import SECURITY_HEADERS, CSP_API


def register_api_v1(app: FastAPI, W) -> None:
    c = W.c
    prefix = "/t/{slug}/api/v1"

    def tenant(slug):
        t = W.tenant(slug)
        return t, t["id"]

    def body_dict(request_body):
        if not isinstance(request_body, dict):
            raise HTTPException(400, "JSON object required")
        return request_body

    async def body(request: Request):
        try:
            raw = await request.body()
            if len(raw) > 20000:
                raise HTTPException(413, "request body too large")
            return body_dict(json.loads(raw or b"{}"))
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(400, "invalid JSON")

    def bearer(request: Request):
        value = request.headers.get("authorization", "")
        m = re.fullmatch(r"Bearer\s+(\S+)", value, re.I)
        return m.group(1) if m else None

    def patient(request, tid):
        u = c.accounts.authenticate(tid, bearer(request))
        if not u:
            raise HTTPException(401, "Bearer token is missing, invalid or expired")
        return u

    def staff(request, tid):
        s = c.staff_accounts.authenticate(tid, bearer(request))
        if not s:
            raise HTTPException(401, "Bearer token is missing, invalid or expired")
        return s

    def api_error(e):
        if isinstance(e, AccountError):
            code = {"invalid_credentials": 401, "locked": 423, "email_taken": 409, "invalid_input": 400}.get(e.code, 400)
            raise HTTPException(code, str(e))
        if isinstance(e, StaffError):
            code = {"invalid_credentials": 401, "locked": 423, "forbidden": 403, "not_found": 404, "conflict": 409}.get(e.code, 400)
            raise HTTPException(code, str(e))
        if isinstance(e, DomainError):
            code = {"not_found": 404, "change_window_closed": 409, "idempotency_conflict": 409, "invalid_request": 400}.get(e.code, 409)
            raise HTTPException(code, str(e))
        if isinstance(e, IntakeError):
            raise HTTPException(422, {"code": e.code, "message": str(e)})
        if isinstance(e, WaitlistError):
            raise HTTPException(409, {"code": e.code, "message": str(e)})
        raise e

    @app.get(prefix + "/health")
    def health(slug: str):
        t, tid = tenant(slug)
        c.db.get("SELECT 1 AS ok")
        return {"status": "ok", "tenant": t["slug"], "api_version": "v1"}

    # Public discovery and booking prerequisites
    @app.get(prefix + "/practice-types")
    def practice_types(slug: str):
        _, tid = tenant(slug)
        return {"practice_types": c.catalog.practice_types(tid)}

    @app.get(prefix + "/clinics")
    def clinics(slug: str, q: str = "", state: str = "", practice_type: str = "", limit: int = 40):
        _, tid = tenant(slug)
        return {"clinics": c.catalog.search_clinics(tid, q, state.upper(), min(max(limit, 1), 100), practice_type)}

    @app.get(prefix + "/clinics/{clinic_id}")
    def clinic(slug: str, clinic_id: str):
        _, tid = tenant(slug)
        result = c.catalog.clinic(tid, clinic_id)
        if not result:
            raise HTTPException(404, "Clinic not found")
        return result

    @app.get(prefix + "/clinics/{clinic_id}/visit-types")
    def visit_types(slug: str, clinic_id: str):
        _, tid = tenant(slug)
        if not c.catalog.clinic(tid, clinic_id):
            raise HTTPException(404, "Clinic not found")
        return {"visit_types": c.catalog.visit_types(tid, clinic_id)}

    @app.get(prefix + "/clinics/{clinic_id}/providers")
    def providers(slug: str, clinic_id: str, visit_type_id: str):
        _, tid = tenant(slug)
        return {"providers": c.catalog.providers(tid, clinic_id, visit_type_id)}

    @app.get(prefix + "/clinics/{clinic_id}/plans")
    def plans(slug: str, clinic_id: str):
        _, tid = tenant(slug)
        if not c.catalog.clinic(tid, clinic_id):
            raise HTTPException(404, "Clinic not found")
        return {"plans": c.catalog.clinic_plans(tid, clinic_id)}

    @app.get(prefix + "/availability")
    def availability(slug: str, clinic_id: str, visit_type_id: str, provider_id: str, request: Request):
        _, tid = tenant(slug)
        u = c.accounts.authenticate(tid, bearer(request))
        if not c.catalog.eligible(tid, clinic_id, visit_type_id, provider_id):
            raise HTTPException(404, "Selection not found")
        slots = c.booking.slots(tid, clinic_id, visit_type_id, provider_id, u["id"] if u else None)
        return {"slots": slots}

    @app.get(prefix + "/intake/config")
    def intake_config(slug: str):
        _, tid = tenant(slug)
        return c.intake.config(tid)

    # Patient identity and account lifecycle
    @app.get(prefix + "/accounts/access-options")
    def access_options(slug: str, q: str = ""):
        _, tid = tenant(slug)
        return {"employers": c.accounts.employers(tid, q), "insurers": c.accounts.insurers(tid)}

    @app.post(prefix + "/auth/signup", status_code=201)
    async def signup(slug: str, request: Request):
        _, tid = tenant(slug)
        b = await body(request)
        try:
            profile, token = c.accounts.signup(tid, email=b.get("email"), password=b.get("password"),
                first_name=b.get("first_name"), last_name=b.get("last_name"), date_of_birth=b.get("date_of_birth"),
                phone=b.get("phone"), access_type=b.get("access_type"), access_id=b.get("access_id"))
            return {"profile": profile, "access_token": token, "token_type": "Bearer"}
        except Exception as e:
            api_error(e)

    @app.post(prefix + "/auth/login")
    async def login(slug: str, request: Request):
        _, tid = tenant(slug)
        b = await body(request)
        try:
            result = c.accounts.begin_login(tid, b.get("email"), b.get("password"))
            if result.get("mfa"):
                return JSONResponse({"mfa_required": True, "challenge": result["mfa"]["challenge"]}, status_code=202)
            return {"profile": result["profile"], "access_token": result["token"], "token_type": "Bearer"}
        except Exception as e:
            api_error(e)

    @app.post(prefix + "/auth/mfa/verify")
    async def verify_mfa(slug: str, request: Request):
        _, tid = tenant(slug)
        b = await body(request)
        try:
            profile, token = c.accounts.verify_login(tid, b.get("challenge"), b.get("code"))
            return {"profile": profile, "access_token": token, "token_type": "Bearer"}
        except Exception as e:
            api_error(e)

    @app.get(prefix + "/auth/me")
    def me(slug: str, request: Request):
        _, tid = tenant(slug)
        return {"profile": patient(request, tid)}

    @app.post(prefix + "/auth/logout")
    def logout(slug: str, request: Request):
        _, tid = tenant(slug)
        token = bearer(request)
        if not token:
            raise HTTPException(401, "Bearer token required")
        c.accounts.logout(tid, token)
        return JSONResponse({}, status_code=204)

    @app.get(prefix + "/patients")
    def patients(slug: str, request: Request):
        _, tid = tenant(slug)
        u = patient(request, tid)
        return {"patients": c.intake.list(tid, u["id"])}

    @app.post(prefix + "/patients", status_code=201)
    async def add_patient(slug: str, request: Request):
        _, tid = tenant(slug); u = patient(request, tid); b = await body(request)
        try:
            return c.intake.add_dependent(tid, u["id"], b.get("relationship"), b.get("first_name"), b.get("last_name"), b.get("date_of_birth"))
        except Exception as e:
            api_error(e)

    @app.delete(prefix + "/patients/{patient_id}", status_code=204)
    def remove_patient(slug: str, patient_id: str, request: Request):
        _, tid = tenant(slug); u = patient(request, tid)
        try:
            if not c.intake.remove_dependent(tid, u["id"], patient_id):
                raise HTTPException(404, "Patient not found")
            return JSONResponse({}, status_code=204)
        except Exception as e:
            api_error(e)

    # Patient appointment lifecycle
    @app.post(prefix + "/appointments", status_code=201)
    async def create_appointment(slug: str, request: Request):
        _, tid = tenant(slug); u = patient(request, tid); b = await body(request)
        key = request.headers.get("Idempotency-Key", "")
        try:
            outcome = c.booking.create(tid, u, b, key)
            if outcome.get("status") == "confirmed":
                return JSONResponse(outcome, status_code=201)
            if outcome.get("status") == "slot_unavailable":
                return JSONResponse(outcome, status_code=409)
            return JSONResponse(outcome, status_code=422)
        except Exception as e:
            api_error(e)

    @app.get(prefix + "/appointments")
    def list_appointments(slug: str, request: Request):
        _, tid = tenant(slug); u = patient(request, tid)
        return {"appointments": c.booking.list(tid, u["id"])}

    @app.get(prefix + "/appointments/{appointment_id}")
    def get_appointment(slug: str, appointment_id: str, request: Request):
        _, tid = tenant(slug); u = patient(request, tid)
        item = c.booking.managed(tid, u["id"], appointment_id)
        if not item:
            raise HTTPException(404, "Appointment not found")
        return item

    @app.post(prefix + "/appointments/{appointment_id}/cancel")
    async def cancel_appointment(slug: str, appointment_id: str, request: Request):
        _, tid = tenant(slug); u = patient(request, tid); b = await body(request)
        try:
            item = c.booking.cancel(tid, u["id"], appointment_id, b.get("reason"))
            W.notify_now(appointment_id)
            return item
        except Exception as e:
            api_error(e)

    @app.post(prefix + "/appointments/{appointment_id}/reschedule")
    async def reschedule_appointment(slug: str, appointment_id: str, request: Request):
        _, tid = tenant(slug); u = patient(request, tid); b = await body(request)
        try:
            result = c.booking.reschedule(tid, u["id"], appointment_id, b.get("slot_id", ""), b.get("provider_id"))
            if result.get("status") == "slot_unavailable":
                return JSONResponse(result, status_code=409)
            W.notify_now(appointment_id)
            return result
        except Exception as e:
            api_error(e)

    @app.patch(prefix + "/notifications/preferences")
    async def notification_preferences(slug: str, request: Request):
        _, tid = tenant(slug); u = patient(request, tid); b = await body(request)
        if "email" not in b and "sms" not in b:
            raise HTTPException(400, "email and/or sms preference required")
        if any(k in b and not isinstance(b[k], bool) for k in ("email", "sms")):
            raise HTTPException(400, "preferences must be booleans")
        c.accounts.set_notify(tid, u["id"], b.get("email"), b.get("sms"))
        return {"updated": True, "email": b.get("email", bool(u.get("notify_email"))), "sms": b.get("sms", bool(u.get("notify_sms")))}

    @app.get(prefix + "/waitlist")
    def waitlist(slug: str, request: Request):
        _, tid = tenant(slug); u = patient(request, tid)
        return {"entries": c.waitlist.list(tid, u["id"])}

    @app.post(prefix + "/waitlist", status_code=201)
    async def join_waitlist(slug: str, request: Request):
        _, tid = tenant(slug); u = patient(request, tid); b = await body(request)
        try:
            return c.waitlist.join(tid, u["id"], b.get("clinic_id"), b.get("visit_type_id"), b.get("provider_id"), b.get("patient_id"))
        except Exception as e:
            api_error(e)

    @app.delete(prefix + "/waitlist/{entry_id}", status_code=204)
    def leave_waitlist(slug: str, entry_id: int, request: Request):
        _, tid = tenant(slug); u = patient(request, tid)
        if not c.waitlist.leave(tid, u["id"], entry_id):
            raise HTTPException(404, "Waitlist entry not found")
        return JSONResponse({}, status_code=204)

    # Provider / front-desk workflow
    @app.post(prefix + "/staff/auth/login")
    async def staff_login(slug: str, request: Request):
        _, tid = tenant(slug); b = await body(request)
        try:
            profile, token = c.staff_accounts.login(tid, b.get("email"), b.get("password"))
            return {"profile": profile, "access_token": token, "token_type": "Bearer"}
        except Exception as e:
            api_error(e)

    @app.get(prefix + "/staff/auth/me")
    def staff_me(slug: str, request: Request):
        _, tid = tenant(slug)
        return {"profile": staff(request, tid)}

    @app.post(prefix + "/staff/auth/logout")
    def staff_logout(slug: str, request: Request):
        _, tid = tenant(slug); token = bearer(request)
        if not token:
            raise HTTPException(401, "Bearer token required")
        c.staff_accounts.logout(tid, token)
        return JSONResponse({}, status_code=204)

    @app.get(prefix + "/staff/catalog")
    def staff_catalog(slug: str, request: Request):
        _, tid = tenant(slug); s = staff(request, tid)
        return c.desk.catalog(tid, s)

    @app.get(prefix + "/staff/appointments")
    def staff_appointments(slug: str, request: Request, date: str, clinic_id: str = "", provider_id: str = ""):
        _, tid = tenant(slug); s = staff(request, tid)
        try:
            return {"appointments": c.desk.schedule(tid, s, date, clinic_id or None, provider_id or None)}
        except Exception as e:
            api_error(e)

    @app.get(prefix + "/staff/appointments/{appointment_id}")
    def staff_get_appointment(slug: str, appointment_id: str, request: Request):
        _, tid = tenant(slug); s = staff(request, tid)
        try:
            return c.desk.get(tid, s, appointment_id)
        except Exception as e:
            api_error(e)

    @app.patch(prefix + "/staff/appointments/{appointment_id}/status")
    async def staff_status(slug: str, appointment_id: str, request: Request):
        _, tid = tenant(slug); s = staff(request, tid); b = await body(request)
        status = b.get("status")
        if s["role"] == "provider" and status not in ("arrived", "completed"):
            raise HTTPException(403, "Providers can mark visits arrived or completed")
        try:
            result = c.desk.set_status(tid, s, appointment_id, status)
            if status == "completed":
                # Completion is recorded in the appointment lifecycle. No completion message is generated by the existing notification templates.
                pass
            return result
        except Exception as e:
            api_error(e)

    @app.post(prefix + "/staff/appointments/{appointment_id}/cancel")
    async def staff_cancel(slug: str, appointment_id: str, request: Request):
        _, tid = tenant(slug); s = staff(request, tid); b = await body(request)
        try:
            result = c.desk.cancel(tid, s, appointment_id, b.get("reason", ""))
            W.notify_now(appointment_id)
            return result
        except Exception as e:
            api_error(e)

    @app.post(prefix + "/staff/appointments/{appointment_id}/reschedule")
    async def staff_reschedule(slug: str, appointment_id: str, request: Request):
        _, tid = tenant(slug); s = staff(request, tid); b = await body(request)
        try:
            return c.desk.reschedule(tid, s, appointment_id, b.get("slot_id", ""))
        except Exception as e:
            api_error(e)

    # Tenant administration API already exists; keep its /api/admin routes separate.
