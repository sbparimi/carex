"""Booking service: eligibility re-checked server-side and tenant-scoped, intake enforced, idempotent by key (the database is the source of truth),
an account's own bookings (view / cancel / reschedule) with ownership enforced."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Callable

from .intake import Intake, IntakeError
from .scheduling import (BookingNotFoundError, ChangeWindowClosedError, IdempotencyConflictError, ReserveInput, Scheduling, SlotTakenError)
from .util import MINUTE, ms, now as _now


class DomainError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


_KEY = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class BookingService:
    def __init__(self, catalog, sched: Scheduling, intake: Intake, clock: Callable[[], datetime] = _now, change_notice_minutes: int = 120):
        self.catalog, self.sched, self.intake, self.now, self.notice = catalog, sched, intake, clock, change_notice_minutes

    # ---- an account's own bookings
    def list(self, tenant_id: str, user_id: str) -> list[dict]:
        return [m for b in self.sched.list_for_user(tenant_id, user_id) if (m := self._managed(tenant_id, b))]

    def managed(self, tenant_id: str, user_id: str, booking_id: str) -> dict | None:
        b = self._owned(tenant_id, user_id, booking_id)
        return self._managed(tenant_id, b) if b else None

    def cancel(self, tenant_id: str, user_id: str, booking_id: str, reason: str | None = None) -> dict:
        try:
            if not self._owned(tenant_id, user_id, booking_id):
                raise BookingNotFoundError("Booking not found")
            return self._require(tenant_id, self.sched.cancel(tenant_id, booking_id, reason or "", "patient"))
        except Exception as e:
            raise self._map(e)

    def reschedule(self, tenant_id: str, user_id: str, booking_id: str, slot_id: str) -> dict:
        try:
            if not self._owned(tenant_id, user_id, booking_id):
                raise BookingNotFoundError("Booking not found")
            return {"status": "rescheduled", "appointment": self._require(tenant_id, self.sched.reschedule(tenant_id, booking_id, slot_id))}
        except SlotTakenError:
            b = self.sched.get_booking(tenant_id, booking_id)
            alts = self.sched.list_slots(tenant_id, b["clinic_id"], b["service_id"], b["provider_id"]) if b else []
            return {"status": "slot_unavailable", "message": "That time is no longer available. Your current appointment is unchanged; please pick another time.", "alternatives": alts[:5]}
        except Exception as e:
            raise self._map(e)

    def _owned(self, tenant_id, user_id, booking_id):
        b = self.sched.get_booking(tenant_id, booking_id)
        return b if b and b.get("user_id") == user_id else None

    def _managed(self, tenant_id: str, b: dict) -> dict | None:
        d = self.catalog.describe(tenant_id, b["clinic_id"], b["service_id"], b["provider_id"])
        if not d:
            return None
        can = b["status"] == "confirmed" and ms(b["starts_at"]) - ms(self.now()) >= self.notice * MINUTE
        summary = {**d, "starts_at": b["starts_at"], "ends_at": b["ends_at"], "time_zone": d["clinic"]["time_zone"]}
        for k in ("modality", "join_url", "copay_cents", "patient_name", "reason"):
            if b.get(k) is not None:
                summary[k] = b[k]
        return {"booking_id": b["booking_id"], "status": b["status"], "summary": summary, "can_change": can, "change_notice_minutes": self.notice}

    def _require(self, tenant_id, b):
        m = self._managed(tenant_id, b)
        if not m:
            raise DomainError("not_found", "not found")
        return m

    def _map(self, e: Exception) -> Exception:
        if isinstance(e, BookingNotFoundError):
            return DomainError("not_found", "not found")
        if isinstance(e, ChangeWindowClosedError):
            return DomainError("change_window_closed", f"Appointments can only be changed at least {self.notice} minutes before they start. Please contact the clinic.")
        return e

    # ---- search
    def slots(self, tenant_id: str, clinic_id: str, service_id: str, provider_id: str, user_id: str | None = None, patient_id: str | None = None) -> list[dict]:
        if not self.catalog.eligible(tenant_id, clinic_id, service_id, provider_id):
            return []
        return self.sched.list_slots(tenant_id, clinic_id, service_id, provider_id, user_id, patient_id)

    def first_available(self, tenant_id: str, clinic_id: str, service_id: str, user_id: str, patient_id: str | None = None, limit: int = 6) -> list[dict]:
        """'Any provider': the soonest openings across every eligible provider, soonest first."""
        out = []
        for p in self.catalog.providers(tenant_id, clinic_id, service_id):
            if not p["accepting_new"]:
                continue
            for s in self.sched.list_slots(tenant_id, clinic_id, service_id, p["id"], user_id, patient_id)[:limit]:
                out.append({**s, "provider_name": p["display_name"]})
        return sorted(out, key=lambda s: (s["starts_at"], s["provider_id"]))[:limit]

    # ---- create
    def create(self, tenant_id: str, user: dict, req: dict, key: str) -> dict:
        """`user` is the signed-in profile. Contact details come from it, never from the request. Returns an outcome dict (status confirmed | slot_unavailable | failed)."""
        if not _KEY.match(key or ""):
            raise DomainError("invalid_request", "Idempotency-Key header is required (8-64 URL-safe characters)")
        for f in ("clinic_id", "service_id", "provider_id", "slot_id"):
            if not isinstance(req.get(f), str) or not req[f]:
                raise DomainError("invalid_request", "invalid booking request")
        elig = self.catalog.eligible(tenant_id, req["clinic_id"], req["service_id"], req["provider_id"])
        if not elig:
            raise DomainError("not_found", "selection is not available")
        try:
            dec = self.intake.prepare(tenant_id, user["id"], req)
        except IntakeError as e:
            return {"status": "failed", "code": e.code, "message": str(e), "retryable": False}
        pid = dec["patient_id"]
        prior = self.sched.lookup_by_key(tenant_id, key)
        if not prior:
            offered = self.sched.list_slots(tenant_id, req["clinic_id"], req["service_id"], req["provider_id"], user["id"], pid)
            if not any(s["id"] == req["slot_id"] for s in offered):
                return self._unavailable(offered)
        try:
            rec = self.sched.reserve(ReserveInput(tenant_id, req["clinic_id"], req["service_id"], req["provider_id"], req["slot_id"], key,
                                                  dec["patient_first_name"], dec["patient_last_name"], user["email"], user["phone"], user_id=user["id"], intake=dec,
                                                  sms_ok=False))
        except IdempotencyConflictError:
            raise DomainError("idempotency_conflict", "this Idempotency-Key was used with a different request")
        except SlotTakenError:
            return self._unavailable(self.sched.list_slots(tenant_id, req["clinic_id"], req["service_id"], req["provider_id"], user["id"], pid))
        if rec["status"] != "confirmed":
            return {"status": "failed", "code": "booking_cancelled", "message": "This booking was cancelled. Please start a new booking.", "retryable": False}
        summary = {**elig, "starts_at": rec["starts_at"], "ends_at": rec["ends_at"], "time_zone": elig["clinic"]["time_zone"], "modality": dec["modality"], "copay_cents": dec["copay_cents"],
                   "patient_name": f"{dec['patient_first_name']} {dec['patient_last_name']}"}
        if dec["modality"] == "telehealth" and dec.get("video_join_base"):
            summary["join_url"] = f"{dec['video_join_base'].rstrip('/')}/{rec['booking_id']}"
        if dec.get("reason"):
            summary["reason"] = dec["reason"]
        return {"status": "confirmed", "booking_id": rec["booking_id"], "summary": summary}

    @staticmethod
    def _unavailable(alts: list[dict]) -> dict:
        return {"status": "slot_unavailable", "message": "That time is no longer available. Your other choices are kept; please pick another time.", "alternatives": alts[:5]}
