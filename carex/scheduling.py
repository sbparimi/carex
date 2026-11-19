"""CareX-native scheduling engine (ADR-002, ADR-005). Every query is bound-parameter and tenant-scoped; writers are serialised per provider."""
from __future__ import annotations

import secrets

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable

from . import waitlist
from .db import Conn
from .notify import enqueue, enqueue_reminders, skip_pending_reminders
from .util import DAY, MINUTE, age_on, booking_reference, from_ms, iso, local_parts, ms, now as _now, sha256, zoned_to_utc


class SlotTakenError(Exception): ...
class IdempotencyConflictError(Exception): ...
class BookingNotFoundError(Exception): ...
class ChangeWindowClosedError(Exception): ...


@dataclass
class ReserveInput:
    tenant_id: str
    clinic_id: str
    service_id: str
    provider_id: str
    slot_id: str
    idempotency_key: str
    first_name: str
    last_name: str
    email: str | None = None
    phone: str | None = None
    user_id: str | None = None
    intake: dict | None = None
    booked_by: str = "patient"
    staff_id: str | None = None
    patient_dob: str | None = None
    sms_ok: bool = False


_MANAGE_COLS = ("id, tenant_id, clinic_id, visit_type_id, provider_id, starts_at, ends_at, status, user_id, modality, join_url, copay_cents, patient_first_name, "
                "patient_last_name, reason, patient_email, patient_phone, contact_sms_ok")


def slot_id_for(tenant_id: str, provider_id: str, start_ms: int) -> str:
    d = from_ms(start_ms)
    return f"{tenant_id}:{provider_id}:{d:%Y%m%dT%H%M}"


def request_hash(i: ReserveInput) -> str:
    it = i.intake
    canon = json.dumps([i.tenant_id, i.user_id, i.clinic_id, i.service_id, i.provider_id, i.slot_id, i.first_name, i.last_name, i.email, i.phone,
                        [it.get("patient_id"), it.get("reason"), it.get("modality"), it.get("patient_state"), it.get("referral_ref")] if it else None], separators=(",", ":"))
    return sha256(canon)


def who_of(r: dict) -> dict | None:
    """Who gets messages about an appointment: the account, or the contact details staff recorded for a phone/walk-in patient."""
    if r.get("user_id"):
        return {"user_id": r["user_id"]}
    if not r.get("patient_email") and not r.get("patient_phone"):
        return None
    return {"direct": {"email": r.get("patient_email"), "phone": r.get("patient_phone"), "name": r.get("patient_first_name") or "", "sms_ok": r.get("contact_sms_ok") == 1}}


def to_record(r: dict) -> dict:
    return {"booking_id": r["id"], "tenant_id": r["tenant_id"], "slot_id": slot_id_for(r["tenant_id"], r["provider_id"], ms(r["starts_at"])),
            "idempotency_key": r["idempotency_key"], "starts_at": r["starts_at"], "ends_at": r["ends_at"], "status": r["status"]}


def to_managed(r: dict) -> dict:
    out = {"booking_id": r["id"], "tenant_id": r["tenant_id"], "clinic_id": r["clinic_id"], "service_id": r["visit_type_id"], "provider_id": r["provider_id"],
           "starts_at": r["starts_at"], "ends_at": r["ends_at"], "status": r["status"]}
    if r.get("user_id"):
        out["user_id"] = r["user_id"]
    if r.get("modality"):
        out["modality"] = r["modality"]
    if r.get("join_url"):
        out["join_url"] = r["join_url"]
    if r.get("copay_cents"):
        out["copay_cents"] = r["copay_cents"]
    if r.get("patient_first_name"):
        out["patient_name"] = f"{r['patient_first_name']} {r.get('patient_last_name') or ''}".strip()
    if r.get("reason"):
        out["reason"] = r["reason"]
    return out


class Scheduling:
    def __init__(self, db, clock: Callable[[], datetime] = _now, horizon_days: int = 14, min_lead_minutes: int = 60, min_change_notice_minutes: int = 120):
        self.db, self.now = db, clock
        self.horizon_days, self.min_lead, self.min_notice = horizon_days, min_lead_minutes, min_change_notice_minutes

    # ---- reads
    def list_slots(self, tenant_id, clinic_id, service_id, provider_id, user_id=None, patient_id=None) -> list[dict]:
        return [c["slot"] for c in self.candidates(self.db, dict(tenant_id=tenant_id, clinic_id=clinic_id, service_id=service_id, provider_id=provider_id, user_id=user_id, patient_id=patient_id))]

    def lookup_by_key(self, tenant_id: str, key: str) -> dict | None:
        r = self._find_by_key(self.db, tenant_id, key)
        return to_record(r) if r else None

    def get_booking(self, tenant_id: str, booking_id: str) -> dict | None:
        r = self._find_managed(self.db, tenant_id, booking_id)
        return to_managed(r) if r else None

    def list_for_user(self, tenant_id: str, user_id: str) -> list[dict]:
        rows = self.db.all(f"SELECT {_MANAGE_COLS} FROM appointments WHERE tenant_id = ? AND user_id = ? ORDER BY starts_at, id", tenant_id, user_id)
        return [to_managed(r) for r in rows]

    # ---- writes
    def reserve(self, i: ReserveInput) -> dict:
        h = request_hash(i)
        try:
            return self._reserve_once(i, h)
        except Exception as e:
            if self.db.is_unique(e, "appointments_idem"):    # lost a race on the same key: replay the winner's result
                row = self._find_by_key(self.db, i.tenant_id, i.idempotency_key)
                if row and row["request_hash"] == h:
                    return to_record(row)
                if row:
                    raise IdempotencyConflictError("Idempotency-Key was reused for a different request")
            raise

    def _reserve_once(self, i: ReserveInput, h: str) -> dict:
        with self.db.tx() as tx:
            existing = self._find_by_key(tx, i.tenant_id, i.idempotency_key)
            if existing:
                if existing["request_hash"] != h:
                    raise IdempotencyConflictError("Idempotency-Key was reused for a different request")
                return to_record(existing)
            if i.user_id:
                account = tx.get(f"SELECT closure_status FROM users WHERE tenant_id = ? AND id = ?{tx.for_update}", i.tenant_id, i.user_id)
                if not account or account["closure_status"] != "active":
                    raise BookingNotFoundError("This account is not available for booking")
            tx.lock(f"{i.tenant_id}:{i.provider_id}")        # overlapping (not just identical) slots can never both commit
            q = dict(tenant_id=i.tenant_id, clinic_id=i.clinic_id, service_id=i.service_id, provider_id=i.provider_id, user_id=i.user_id,
                     patient_id=(i.intake or {}).get("patient_id") or None, dob=i.patient_dob, require_user=not i.staff_id)
            cand = next((c for c in self.candidates(tx, q) if c["slot"]["id"] == i.slot_id), None)
            if not cand:
                raise SlotTakenError("Slot is not available")
            slot, it, nowd = cand["slot"], i.intake or {}, self.now()
            bid = booking_reference()
            join = None
            if it.get("modality") == "telehealth" and it.get("video_join_base"):
                join = f"{it['video_join_base'].rstrip('/')}/{bid}"
            try:
                tx.run("""INSERT INTO appointments (id, tenant_id, clinic_id, visit_type_id, provider_id, starts_at, ends_at, status, idempotency_key, request_hash,
                            patient_first_name, patient_last_name, patient_email, patient_phone, created_at, user_id, resource_id,
                            patient_id, reason, modality, patient_state, interpreter_language, accommodations, referral_ref, copay_cents, join_url,
                            booked_by, booked_by_staff_id, patient_dob, contact_sms_ok, manage_token)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                       bid, i.tenant_id, i.clinic_id, i.service_id, i.provider_id, slot["starts_at"], slot["ends_at"], "confirmed", i.idempotency_key, h,
                       i.first_name, i.last_name, i.email, i.phone, iso(nowd), i.user_id, cand["resource_id"],
                       it.get("patient_id") or None, it.get("reason"), it.get("modality") or "in_person", it.get("patient_state"), it.get("interpreter_language"),
                       it.get("accommodations"), it.get("referral_ref"), it.get("copay_cents") or 0, join,
                       i.booked_by, i.staff_id, i.patient_dob, 1 if i.sms_ok else 0, secrets.token_urlsafe(18))
                if it.get("consent_version") and (i.user_id or i.staff_id):
                    tx.run("INSERT INTO consent_records (tenant_id, user_id, patient_id, kind, version, accepted_at, appointment_id, recorded_by) VALUES (?,?,?,?,?,?,?,?)",
                           i.tenant_id, i.user_id, it.get("patient_id") or None, "treatment_verbal" if i.staff_id else "treatment", it["consent_version"], iso(nowd), bid, i.staff_id)
            except Exception as e:
                if tx.is_unique(e, "appointments_slot") or tx.is_unique(e, "appointments_resource_slot"):
                    raise SlotTakenError("Slot is not available")
                raise
            direct = None
            if not i.user_id and (i.email or i.phone):
                direct = {"email": i.email, "phone": i.phone, "name": i.first_name, "sms_ok": bool(i.sms_ok)}
            if i.user_id or direct:
                enqueue(tx, nowd, tenant_id=i.tenant_id, kind="confirmation", appointment_id=bid, dedupe=f"confirmation:{bid}", user_id=i.user_id, direct=direct)
                enqueue_reminders(tx, nowd, tenant_id=i.tenant_id, appointment_id=bid, starts_at=slot["starts_at"], user_id=i.user_id, direct=direct)
            if i.user_id:
                waitlist.mark_booked(tx, i.tenant_id, i.user_id, i.clinic_id, i.service_id)
            return {"booking_id": bid, "tenant_id": i.tenant_id, "slot_id": i.slot_id, "idempotency_key": i.idempotency_key,
                    "starts_at": slot["starts_at"], "ends_at": slot["ends_at"], "status": "confirmed"}

    def _assert_change_allowed(self, row: dict) -> None:
        if ms(row["starts_at"]) - ms(self.now()) < self.min_notice * MINUTE:
            raise ChangeWindowClosedError("Too close to the appointment time to change it online")

    def cancel(self, tenant_id: str, booking_id: str, reason: str | None = None, by: str = "patient") -> dict:
        with self.db.tx() as tx:
            row = self._find_managed(tx, tenant_id, booking_id, lock=True)
            if not row:
                raise BookingNotFoundError("Booking not found")
            if row["status"] == "cancelled":
                return to_managed(row)
            if by != "staff":
                self._assert_change_allowed(row)
            nowd = self.now()
            pol = tx.get("SELECT late_cancel_hours FROM tenants WHERE id = ?", tenant_id)
            hours = pol["late_cancel_hours"] if pol and pol["late_cancel_hours"] is not None else 24
            late = 1 if ms(row["starts_at"]) - ms(nowd) < hours * 3_600_000 else 0
            ts = iso(nowd)
            tx.run("UPDATE appointments SET status = 'cancelled', cancelled_at = ?, updated_at = ?, cancel_reason = ?, cancelled_by = ?, late_cancel = ? WHERE id = ? AND tenant_id = ?",
                   ts, ts, (reason or "")[:200] or None, by, late, booking_id, tenant_id)
            skip_pending_reminders(tx, booking_id)
            who = who_of(row)
            if who:
                enqueue(tx, nowd, tenant_id=tenant_id, kind="cancellation", appointment_id=booking_id, dedupe=f"cancellation:{booking_id}", **who)
            waitlist.notify_opening(tx, nowd, tenant_id=tenant_id, clinic_id=row["clinic_id"], service_id=row["visit_type_id"], provider_id=row["provider_id"], starts_at=row["starts_at"])
            return to_managed({**row, "status": "cancelled"})

    def reschedule(self, tenant_id: str, booking_id: str, new_slot_id: str, by: str = "patient", provider_id: str | None = None) -> dict:
        with self.db.tx() as tx:
            row = self._find_managed(tx, tenant_id, booking_id, lock=True)
            if not row or row["status"] != "confirmed":
                raise BookingNotFoundError("Booking not found")
            if by != "staff":
                self._assert_change_allowed(row)
            new_provider = provider_id or row["provider_id"]            # a different provider is allowed at the same clinic for the same visit type
            for key in sorted({row["provider_id"], new_provider}):
                tx.lock(f"{tenant_id}:{key}")
            q = dict(tenant_id=tenant_id, clinic_id=row["clinic_id"], service_id=row["visit_type_id"], provider_id=new_provider, user_id=row.get("user_id"), require_user=False)
            cand = next((c for c in self.candidates(tx, q, row["id"]) if c["slot"]["id"] == new_slot_id), None)
            if not cand:
                raise SlotTakenError("Slot is not available")
            slot = cand["slot"]
            if slot["starts_at"] == row["starts_at"] and new_provider == row["provider_id"]:
                return to_managed(row)
            nowd = self.now()
            try:
                tx.run("UPDATE appointments SET starts_at = ?, ends_at = ?, resource_id = ?, provider_id = ?, updated_at = ?, reschedule_count = reschedule_count + 1 WHERE id = ? AND tenant_id = ?",
                       slot["starts_at"], slot["ends_at"], cand["resource_id"], new_provider, iso(nowd), booking_id, tenant_id)
            except Exception as e:
                if tx.is_unique(e, "appointments_slot") or tx.is_unique(e, "appointments_resource_slot"):
                    raise SlotTakenError("Slot is not available")
                raise
            skip_pending_reminders(tx, booking_id)
            who = who_of(row)
            if who:
                enqueue(tx, nowd, tenant_id=tenant_id, kind="rescheduled", appointment_id=booking_id, dedupe=f"rescheduled:{booking_id}:{slot['starts_at']}", **who)
                enqueue_reminders(tx, nowd, tenant_id=tenant_id, appointment_id=booking_id, starts_at=slot["starts_at"], **who)
            waitlist.notify_opening(tx, nowd, tenant_id=tenant_id, clinic_id=row["clinic_id"], service_id=row["visit_type_id"], provider_id=row["provider_id"], starts_at=row["starts_at"])
            return to_managed({**row, "starts_at": slot["starts_at"], "ends_at": slot["ends_at"], "provider_id": new_provider})

    # ---- internals
    def _find_managed(self, db: Conn, tenant_id: str, booking_id: str, lock: bool = False) -> dict | None:
        return db.get(f"SELECT {_MANAGE_COLS} FROM appointments WHERE tenant_id = ? AND id = ?{db.for_update if lock else ''}", tenant_id, booking_id)

    def _find_by_key(self, db: Conn, tenant_id: str, key: str) -> dict | None:
        return db.get("SELECT id, tenant_id, provider_id, starts_at, ends_at, idempotency_key, request_hash, status FROM appointments WHERE tenant_id = ? AND idempotency_key = ?", tenant_id, key)

    def candidates(self, db: Conn, q: dict, exclude_booking_id: str | None = None) -> list[dict]:
        """The bookable candidates for (tenant, clinic, service, provider), each with the room it would hold.
        Rules: per-visit lead and horizon, working hours minus time off, clinic closures, other appointments and visit buffers,
        resource availability, and (when a signed-in user or date of birth is known) age and new/established limits."""
        t, ex = q["tenant_id"], exclude_booking_id or ""
        clinic = db.get("SELECT time_zone FROM clinics WHERE id = ? AND tenant_id = ? AND status = 'active' AND bookable = 1", q["clinic_id"], t)
        v = db.get("""SELECT duration_min, min_lead_minutes, horizon_days, buffer_before_min, buffer_after_min, min_age, max_age, new_patients, resource_kind
                        FROM visit_types WHERE id = ? AND tenant_id = ? AND status = 'active'""", q["service_id"], t)
        if not clinic or not v:
            return []
        if not db.get("SELECT 1 AS ok FROM providers WHERE id = ? AND tenant_id = ? AND status = 'active'", q["provider_id"], t):
            return []
        if not db.get("SELECT 1 AS ok FROM clinic_visit_types WHERE tenant_id = ? AND clinic_id = ? AND visit_type_id = ? AND active = 1", t, q["clinic_id"], q["service_id"]):
            return []
        if not db.get("SELECT 1 AS ok FROM provider_eligibility WHERE tenant_id = ? AND clinic_id = ? AND visit_type_id = ? AND provider_id = ? AND active = 1", t, q["clinic_id"], q["service_id"], q["provider_id"]):
            return []
        if not self._patient_may_book(db, q, v):
            return []
        rules = db.all("SELECT weekday, start_minute, end_minute FROM availability_rules WHERE tenant_id = ? AND provider_id = ? AND clinic_id = ?", t, q["provider_id"], q["clinic_id"])
        if not rules:
            return []
        tz = clinic["time_zone"]
        horizon = v["horizon_days"] if v["horizon_days"] is not None else self.horizon_days
        now_ms = ms(self.now())
        earliest = now_ms + (v["min_lead_minutes"] if v["min_lead_minutes"] is not None else self.min_lead) * MINUTE
        latest = now_ms + horizon * DAY
        dur = v["duration_min"] * MINUTE
        before, after = v["buffer_before_min"] * MINUTE, v["buffer_after_min"] * MINUTE

        obstacles = []   # (raw_start, raw_end, padded_start, padded_end)
        for r in db.all("""SELECT a.starts_at, a.ends_at, v.buffer_before_min AS bb, v.buffer_after_min AS ba FROM appointments a JOIN visit_types v ON v.id = a.visit_type_id
                            WHERE a.tenant_id = ? AND a.provider_id = ? AND a.status <> 'cancelled' AND a.id <> ?""", t, q["provider_id"], ex):
            rs, re_ = ms(r["starts_at"]), ms(r["ends_at"])
            obstacles.append((rs, re_, rs - r["bb"] * MINUTE, re_ + r["ba"] * MINUTE))
        blocks = [(ms(r["starts_at"]), ms(r["ends_at"])) for r in db.all("SELECT starts_at, ends_at FROM time_off WHERE tenant_id = ? AND provider_id = ?", t, q["provider_id"])]
        blocks += [(ms(r["starts_at"]), ms(r["ends_at"])) for r in db.all("SELECT starts_at, ends_at FROM clinic_closures WHERE tenant_id = ? AND clinic_id = ?", t, q["clinic_id"])]

        resources = []
        if v["resource_kind"]:
            for r in db.all("SELECT id FROM clinic_resources WHERE tenant_id = ? AND clinic_id = ? AND kind = ? AND active = 1 ORDER BY id", t, q["clinic_id"], v["resource_kind"]):
                busy = [(ms(b["starts_at"]), ms(b["ends_at"])) for b in db.all("SELECT starts_at, ends_at FROM appointments WHERE tenant_id = ? AND resource_id = ? AND status <> 'cancelled' AND id <> ?", t, r["id"], ex)]
                resources.append((r["id"], busy))
            if not resources:
                return []

        today = local_parts(from_ms(now_ms), tz)
        base = datetime(today["year"], today["month"], today["day"], tzinfo=timezone.utc)
        by_start: dict[int, dict] = {}
        for i in range(horizon + 2):
            day = base + timedelta(days=i)
            weekday = (day.weekday() + 1) % 7        # 0 = Sunday
            for rule in rules:
                if rule["weekday"] != weekday:
                    continue
                m = rule["start_minute"]
                while m + v["duration_min"] <= rule["end_minute"]:
                    start = zoned_to_utc(day.year, day.month, day.day, m, tz)
                    m += v["duration_min"]
                    if start is None:
                        continue
                    s = ms(start)
                    e = s + dur
                    if s < earliest or s >= latest or s in by_start:
                        continue
                    if any(s < be and e > bs for bs, be in blocks):
                        continue
                    ps, pe = s - before, e + after
                    if any((s < o[3] and e > o[2]) or (ps < o[1] and pe > o[0]) for o in obstacles):
                        continue
                    rid = None
                    if v["resource_kind"]:
                        rid = next((r[0] for r in resources if not any(s < be and e > bs for bs, be in r[1])), None)
                        if rid is None:
                            continue
                    by_start[s] = {"resource_id": rid, "slot": {"id": slot_id_for(t, q["provider_id"], s), "provider_id": q["provider_id"], "clinic_id": q["clinic_id"],
                                                                  "service_id": q["service_id"], "starts_at": iso(from_ms(s)), "ends_at": iso(from_ms(e)), "time_zone": tz}}
        return [by_start[k] for k in sorted(by_start)]

    def _patient_may_book(self, db: Conn, q: dict, v: dict) -> bool:
        """Age and new/established limits. With no signed-in user the listing is shown unfiltered, but a booking (require_user) is refused."""
        restricted = v["min_age"] is not None or v["max_age"] is not None or v["new_patients"] != "any"
        if not restricted:
            return True
        uid, pid, dob = q.get("user_id"), q.get("patient_id"), q.get("dob")
        if not uid and dob:                       # staff booking: age rules apply to the stated date of birth
            age = age_on(dob, self.now())
            return not ((v["min_age"] is not None and age < v["min_age"]) or (v["max_age"] is not None and age > v["max_age"]))
        if not uid:
            return not q.get("require_user")
        if pid:
            u = db.get("SELECT date_of_birth FROM patients WHERE id = ? AND tenant_id = ? AND user_id = ?", pid, q["tenant_id"], uid)
        else:
            u = db.get("SELECT date_of_birth FROM users WHERE id = ? AND tenant_id = ?", uid, q["tenant_id"])
        if not u:
            return False
        if v["min_age"] is not None or v["max_age"] is not None:
            age = age_on(u["date_of_birth"], self.now())
            if v["min_age"] is not None and age < v["min_age"]:
                return False
            if v["max_age"] is not None and age > v["max_age"]:
                return False
        if v["new_patients"] != "any":
            if pid:
                seen = db.get("SELECT 1 AS ok FROM appointments WHERE tenant_id = ? AND patient_id = ? AND status IN ('arrived','completed') LIMIT 1", q["tenant_id"], pid)
            else:
                seen = db.get("SELECT 1 AS ok FROM appointments WHERE tenant_id = ? AND user_id = ? AND status IN ('arrived','completed') LIMIT 1", q["tenant_id"], uid)
            if v["new_patients"] == "new_only" and seen:
                return False
            if v["new_patients"] == "established_only" and not seen:
                return False
        return True
