"""Waitlist: patients ask to be told when an earlier time opens."""
from __future__ import annotations

from datetime import datetime
from typing import Callable

from .db import Conn
from .notify import enqueue
from .util import iso, ms, now as _now

MAX_ACTIVE = 10
NOTIFY_PER_OPENING = 3
COLS = "id, patient_id, clinic_id, visit_type_id, provider_id, status, created_at"


class WaitlistError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _entry(r: dict) -> dict:
    return {"id": int(r["id"]), "patient_id": r["patient_id"], "clinic_id": r["clinic_id"], "service_id": r["visit_type_id"], "provider_id": r["provider_id"], "status": r["status"], "created_at": r["created_at"]}


class Waitlist:
    def __init__(self, db, clock: Callable[[], datetime] = _now):
        self.db, self.now = db, clock

    def join(self, tenant_id: str, user_id: str, clinic_id: str, service_id: str, provider_id: str | None = None, patient_id: str | None = None) -> dict:
        db = self.db
        if not db.get("""SELECT 1 AS ok FROM clinic_visit_types cv JOIN clinics c ON c.id = cv.clinic_id AND c.tenant_id = cv.tenant_id AND c.status = 'active' AND c.bookable = 1
                          WHERE cv.tenant_id = ? AND cv.clinic_id = ? AND cv.visit_type_id = ? AND cv.active = 1""", tenant_id, clinic_id, service_id):
            raise WaitlistError("not_found", "That visit isn't available at this clinic.")
        if provider_id and not db.get("SELECT 1 AS ok FROM provider_eligibility WHERE tenant_id = ? AND clinic_id = ? AND visit_type_id = ? AND provider_id = ? AND active = 1", tenant_id, clinic_id, service_id, provider_id):
            raise WaitlistError("not_found", "That provider doesn't see this visit type here.")
        if patient_id and not db.get("SELECT 1 AS ok FROM patients WHERE tenant_id = ? AND user_id = ? AND id = ?", tenant_id, user_id, patient_id):
            raise WaitlistError("not_found", "We couldn't find that person on your account.")
        dup = db.get(f"""SELECT {COLS} FROM waitlist WHERE tenant_id = ? AND user_id = ? AND clinic_id = ? AND visit_type_id = ? AND COALESCE(provider_id,'') = ?
                          AND COALESCE(patient_id,'') = ? AND status IN ('active','notified')""", tenant_id, user_id, clinic_id, service_id, provider_id or "", patient_id or "")
        if dup:
            return _entry(dup)
        n = db.get("SELECT COUNT(*) AS n FROM waitlist WHERE tenant_id = ? AND user_id = ? AND status IN ('active','notified')", tenant_id, user_id)
        if int(n["n"]) >= MAX_ACTIVE:
            raise WaitlistError("too_many", "You can wait for up to 10 openings at a time.")
        row = db.get("INSERT INTO waitlist (tenant_id, user_id, patient_id, clinic_id, visit_type_id, provider_id, created_at) VALUES (?,?,?,?,?,?,?) RETURNING " + COLS,
                     tenant_id, user_id, patient_id, clinic_id, service_id, provider_id, iso(self.now()))
        return _entry(row)

    def list(self, tenant_id: str, user_id: str) -> list[dict]:
        rows = self.db.all("""SELECT w.id, w.patient_id, w.clinic_id, w.visit_type_id, w.provider_id, w.status, w.created_at, c.name AS clinic_name, v.label AS visit_label, p.display_name AS provider_name
                                FROM waitlist w JOIN clinics c ON c.id = w.clinic_id JOIN visit_types v ON v.id = w.visit_type_id LEFT JOIN providers p ON p.id = w.provider_id
                               WHERE w.tenant_id = ? AND w.user_id = ? AND w.status IN ('active','notified') ORDER BY w.created_at, w.id""", tenant_id, user_id)
        return [{**_entry(r), "clinic_name": r["clinic_name"], "visit_label": r["visit_label"], "provider_name": r["provider_name"]} for r in rows]

    def leave(self, tenant_id: str, user_id: str, id_: int) -> bool:
        return self.db.run("UPDATE waitlist SET status = 'cancelled' WHERE tenant_id = ? AND user_id = ? AND id = ? AND status IN ('active','notified')", tenant_id, user_id, id_) > 0


def notify_opening(tx: Conn, at: datetime, *, tenant_id: str, clinic_id: str, service_id: str, provider_id: str, starts_at: str) -> None:
    """Called inside the cancel/reschedule transaction when a time frees up: tells the longest-waiting people, once per opening."""
    if ms(starts_at) <= ms(at) + 60 * 60_000:
        return                                              # too close to be bookable anyway
    waiting = tx.all("""SELECT id, user_id FROM waitlist WHERE tenant_id = ? AND clinic_id = ? AND visit_type_id = ? AND status = 'active' AND (provider_id IS NULL OR provider_id = ?)
                         ORDER BY created_at, id LIMIT ?""", tenant_id, clinic_id, service_id, provider_id, NOTIFY_PER_OPENING)
    for w in waiting:
        enqueue(tx, at, tenant_id=tenant_id, kind="waitlist_open", user_id=w["user_id"], waitlist_id=w["id"], dedupe=f"wl:{w['id']}:{starts_at}")
        tx.run("UPDATE waitlist SET status = 'notified', notified_at = ? WHERE id = ?", iso(at), w["id"])


def mark_booked(tx: Conn, tenant_id: str, user_id: str, clinic_id: str, service_id: str) -> None:
    """Booking the same clinic and visit type satisfies the person's waitlist entries."""
    tx.run("UPDATE waitlist SET status = 'booked' WHERE tenant_id = ? AND user_id = ? AND clinic_id = ? AND visit_type_id = ? AND status IN ('active','notified')", tenant_id, user_id, clinic_id, service_id)
