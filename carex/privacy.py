"""A patient's own data: a download of everything held about them, an activity history from the audit trail, and account erasure.
Erasure removes the person from the account and from every appointment while keeping the anonymous visit record the practice needs for its own books."""
from __future__ import annotations

import json
import secrets
from datetime import datetime
from typing import Callable

from .util import iso, now as _now


class Privacy:
    def __init__(self, db, sched, audit, clock: Callable[[], datetime] = _now):
        self.db, self.sched, self.audit, self.now = db, sched, audit, clock

    def export(self, tenant_id: str, user_id: str) -> dict:
        u = self.db.get("SELECT id, email, first_name, last_name, date_of_birth, phone, access_type, notify_email, notify_sms, created_at FROM users WHERE tenant_id = ? AND id = ?", tenant_id, user_id)
        if not u:
            return {}
        appts = self.db.all("""SELECT a.id, a.starts_at, a.ends_at, a.status, a.modality, a.reason, a.copay_cents, a.patient_first_name, a.patient_last_name, a.created_at, c.name AS clinic, v.label AS visit, p.display_name AS provider
                                 FROM appointments a JOIN clinics c ON c.id = a.clinic_id JOIN visit_types v ON v.id = a.visit_type_id JOIN providers p ON p.id = a.provider_id
                                WHERE a.tenant_id = ? AND a.user_id = ? ORDER BY a.starts_at""", tenant_id, user_id)
        return {"exported_at": iso(self.now()), "account": u,
                "people": self.db.all("SELECT id, relationship, first_name, last_name, date_of_birth FROM patients WHERE tenant_id = ? AND user_id = ?", tenant_id, user_id),
                "appointments": appts,
                "waiting_list": self.db.all("SELECT clinic_id, visit_type_id, status, created_at FROM waitlist WHERE tenant_id = ? AND user_id = ?", tenant_id, user_id),
                "consents": self.db.all("SELECT kind, version, accepted_at FROM consent_records WHERE tenant_id = ? AND user_id = ?", tenant_id, user_id),
                "activity": self.activity(tenant_id, user_id, 500)}

    def export_json(self, tenant_id: str, user_id: str) -> str:
        return json.dumps(self.export(tenant_id, user_id), indent=2, default=str)

    LABELS = {"booking.create": "You booked an appointment", "booking.cancel": "You cancelled an appointment", "booking.reschedule": "You changed an appointment time", "booking.list": "You viewed your appointments",
              "booking.cancel_by_link": "An appointment was cancelled from an emailed link", "account.export": "You downloaded your data", "account.login": "You signed in", "user.login": "You signed in"}

    def activity(self, tenant_id: str, user_id: str, limit: int = 100) -> list[dict]:
        """Who touched this person's record, newest first: their own actions and any staff action on their appointments."""
        own = self.db.all("SELECT at, actor_type, action FROM audit_log WHERE tenant_id = ? AND actor_id = ? ORDER BY id DESC LIMIT ?", tenant_id, user_id, limit)
        staff = self.db.all("""SELECT l.at, l.actor_type, l.action FROM audit_log l JOIN appointments a ON a.id = l.target_id
                                WHERE l.tenant_id = ? AND l.actor_type = 'staff' AND l.target_type = 'appointment' AND a.user_id = ? ORDER BY l.id DESC LIMIT ?""", tenant_id, user_id, limit)
        out = [{"at": r["at"], "by": "You" if r["actor_type"] == "user" else "Clinic staff", "what": self.LABELS.get(r["action"], r["action"].replace(".", " ").replace("_", " ").capitalize())} for r in own + staff]
        return sorted(out, key=lambda r: r["at"], reverse=True)[:limit]

    def erase(self, tenant_id: str, user_id: str) -> bool:
        # Transition to pending under a row lock. Scheduling.reserve locks the same
        # row before creating an appointment, so either a booking commits first and
        # is included below, or closure commits first and the booking is rejected.
        with self.db.tx() as tx:
            u = tx.get(f"SELECT closure_status FROM users WHERE tenant_id = ? AND id = ?{tx.for_update}", tenant_id, user_id)
            if not u:
                return False
            if u["closure_status"] == "erased":
                return True
            if u["closure_status"] == "active":
                tx.run("UPDATE users SET closure_status = 'pending' WHERE tenant_id = ? AND id = ?", tenant_id, user_id)
                self.audit.record(tenant_id, "system", "account.erase_requested", target_type="user", target_id=user_id, db=tx)

        # Cancellation is intentionally resumable. Each cancellation is atomic and
        # idempotent; a failure leaves closure_status='pending' and blocks new bookings.
        now = iso(self.now())
        upcoming = self.db.all("SELECT id FROM appointments WHERE tenant_id = ? AND user_id = ? AND status = 'confirmed' AND starts_at > ? ORDER BY starts_at, id", tenant_id, user_id, now)
        for appointment in upcoming:
            self.sched.cancel(tenant_id, appointment["id"], "Account closure requested", "system")

        # Final anonymisation and completion audit are one transaction. Re-check under
        # lock so a retry or concurrent closure cannot partially erase the account.
        with self.db.tx() as tx:
            u = tx.get(f"SELECT closure_status FROM users WHERE tenant_id = ? AND id = ?{tx.for_update}", tenant_id, user_id)
            if not u:
                return False
            if u["closure_status"] == "erased":
                return True
            if u["closure_status"] != "pending":
                raise RuntimeError("Account closure state changed; retry the request")
            remaining = tx.get("SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND user_id = ? AND status = 'confirmed' AND starts_at > ?", tenant_id, user_id, now)
            if remaining and int(remaining["n"]) > 0:
                raise RuntimeError("Account closure is pending: upcoming appointments remain")
            tx.run("UPDATE appointments SET patient_first_name = 'Former', patient_last_name = 'Patient', patient_email = NULL, patient_phone = NULL, patient_dob = NULL, reason = NULL, accommodations = NULL, referral_ref = NULL, join_url = NULL, manage_token = NULL, user_id = NULL, patient_id = NULL WHERE tenant_id = ? AND user_id = ?", tenant_id, user_id)
            tx.run("UPDATE outbox SET to_email = NULL, to_phone = NULL, to_name = NULL, status = CASE WHEN status = 'pending' THEN 'skipped' ELSE status END, last_error = CASE WHEN status = 'pending' THEN 'account_erased' ELSE last_error END, user_id = NULL WHERE tenant_id = ? AND user_id = ?", tenant_id, user_id)
            tx.run("DELETE FROM waitlist WHERE tenant_id = ? AND user_id = ?", tenant_id, user_id)
            tx.run("DELETE FROM consent_records WHERE tenant_id = ? AND user_id = ?", tenant_id, user_id)
            tx.run("DELETE FROM sessions WHERE user_id = ?", user_id)
            tx.run("DELETE FROM password_resets WHERE user_id = ?", user_id)
            tx.run("DELETE FROM mfa_challenges WHERE user_id = ?", user_id)
            tx.run("UPDATE patients SET first_name = 'Former', last_name = 'Patient', date_of_birth = '1900-01-01' WHERE tenant_id = ? AND user_id = ?", tenant_id, user_id)
            tx.run("UPDATE users SET email = ?, password_hash = ?, first_name = 'Former', last_name = 'Patient', date_of_birth = '1900-01-01', phone = '', notify_email = 0, notify_sms = 0, locked_until = '9999-12-31T00:00:00Z', closure_status = 'erased' WHERE tenant_id = ? AND id = ?",
                   f"erased+{secrets.token_hex(8)}@erased.invalid", "!" + secrets.token_hex(16), tenant_id, user_id)
            self.audit.record(tenant_id, "system", "account.erased", target_type="user", target_id=user_id, db=tx)
        return True
