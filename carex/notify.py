"""Notifications: a transactional outbox written inside the booking transaction, and a dispatcher that sends due messages."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable

from .db import Conn
from .fmt import when
from .util import iso, ms, now as _now, parse

HOUR = 3_600_000
MAX_ATTEMPTS = 5
LEASE = timedelta(minutes=5)


@dataclass
class Channels:
    """Outbound channels. Either may be absent (not configured): the message is then skipped with a clear reason, never silently lost."""
    base_url: str = "http://localhost:8000"
    email: Callable[[str, str, str], None] | None = None     # (to, subject, text)
    sms: Callable[[str, str], None] | None = None            # (to, text)


def enqueue(tx: Conn, at: datetime, *, tenant_id: str, kind: str, dedupe: str, appointment_id: str | None = None, user_id: str | None = None,
            waitlist_id: int | None = None, send_after: datetime | None = None, direct: dict | None = None) -> None:
    """Queue an email and an SMS row inside the booking transaction (they commit or roll back together)."""
    d = direct or {}
    for channel in ("email", "sms"):
        tx.run("""INSERT INTO outbox (tenant_id, kind, channel, appointment_id, user_id, waitlist_id, send_after, created_at, dedupe_key, to_email, to_phone, to_name, to_sms_ok)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING""",
               tenant_id, kind, channel, appointment_id, user_id, waitlist_id, iso(send_after or at), iso(at), f"{dedupe}:{channel}",
               d.get("email"), d.get("phone"), d.get("name"), 1 if d.get("sms_ok") else 0)


def enqueue_reminders(tx: Conn, at: datetime, *, tenant_id: str, appointment_id: str, starts_at: str, user_id: str | None = None, direct: dict | None = None) -> None:
    """Reminders 24 h and 2 h before the CURRENT start time (a reschedule skips the old ones and queues new ones)."""
    start = ms(starts_at)
    for kind, lead in (("reminder_24h", 24 * HOUR), ("reminder_2h", 2 * HOUR)):
        when_ms = start - lead
        if when_ms <= ms(at):
            continue                                        # booked too close to the visit for this reminder
        enqueue(tx, at, tenant_id=tenant_id, kind=kind, appointment_id=appointment_id, user_id=user_id, direct=direct,
                send_after=parse(starts_at) - timedelta(milliseconds=lead), dedupe=f"{kind}:{appointment_id}:{starts_at}")


def skip_pending_reminders(tx: Conn, appointment_id: str) -> None:
    tx.run("UPDATE outbox SET status = 'skipped', last_error = 'superseded' WHERE appointment_id = ? AND status = 'pending' AND kind IN ('reminder_24h','reminder_2h')", appointment_id)


_SELECT = """
  SELECT o.id, o.tenant_id, o.kind, o.channel, o.appointment_id, o.waitlist_id, o.attempts,
         a.status AS a_status, a.manage_token, a.starts_at, a.modality, a.join_url, a.copay_cents, a.patient_first_name, a.cancel_reason, a.late_cancel,
         t.display_name AS tenant_name, t.slug, t.support_email, t.support_phone, t.policy_text, t.late_cancel_hours,
         COALESCE(c.name, wc.name) AS clinic_name, COALESCE(c.address, wc.address) AS address, COALESCE(c.time_zone, wc.time_zone) AS time_zone,
         COALESCE(v.label, wv.label) AS visit_label, COALESCE(p.display_name, wp.display_name) AS provider_name,
         COALESCE(u.email, o.to_email) AS email, COALESCE(u.phone, o.to_phone) AS phone, COALESCE(u.first_name, o.to_name) AS first_name,
         COALESCE(u.notify_email, 1) AS notify_email, COALESCE(u.notify_sms, o.to_sms_ok) AS notify_sms
    FROM outbox o
    JOIN tenants t ON t.id = o.tenant_id
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN appointments a ON a.id = o.appointment_id
    LEFT JOIN clinics c ON c.id = a.clinic_id LEFT JOIN visit_types v ON v.id = a.visit_type_id LEFT JOIN providers p ON p.id = a.provider_id
    LEFT JOIN waitlist w ON w.id = o.waitlist_id
    LEFT JOIN clinics wc ON wc.id = w.clinic_id LEFT JOIN visit_types wv ON wv.id = w.visit_type_id LEFT JOIN providers wp ON wp.id = w.provider_id"""


def render(r: dict, base_url: str) -> dict | None:
    """Plain-text message for one outbox row. Rendered at send time so it always shows the booking as it is NOW."""
    base = base_url.rstrip("/")
    manage = f"{base}/t/{r['slug']}/m/{r['manage_token']}" if r.get("manage_token") else f"{base}/t/{r['slug']}/appointments"
    where = f"Video visit{': ' + r['join_url'] if r['join_url'] else ''}" if r["modality"] == "telehealth" else f"{r['clinic_name']}, {r['address']}"
    sign = f"\n\n{r['tenant_name']}" + (f" · {r['support_phone']}" if r["support_phone"] else "") + (f" · {r['support_email']}" if r["support_email"] else "")
    hello = f"Hi {r['first_name'] or 'there'},"
    when_s = when(r["starts_at"], r["time_zone"]) if r["starts_at"] and r["time_zone"] else ""
    for_who = f" for {r['patient_first_name']}" if r["patient_first_name"] and r["patient_first_name"] != r["first_name"] else ""
    details = f"{r['visit_label']} with {r['provider_name']}{for_who}\n{when_s}\n{where}" if when_s else ""
    policy = f"\n\n{r['policy_text']}" if r["policy_text"] else f"\n\nPlease change or cancel at least {r['late_cancel_hours']} hours ahead so someone else can use the time."
    copay = f"\nExpected copay: ${r['copay_cents'] / 100:.2f}, due at the visit." if r["copay_cents"] else ""
    tn, vl, k = r["tenant_name"], r["visit_label"], r["kind"]
    if k == "confirmation":
        return {"subject": f"Appointment confirmed — {vl}", "text": f"{hello}\n\nYour appointment is confirmed.\n\n{details}{copay}\n\nManage it: {manage}{policy}\n\nThis is not for emergencies. In an emergency call 911.{sign}", "sms": f"{tn}: confirmed {vl}, {when_s}. Manage: {manage}"}
    if k == "reminder_24h":
        return {"subject": f"Reminder: appointment tomorrow — {vl}", "text": f"{hello}\n\nA reminder about your appointment in about 24 hours.\n\n{details}\n\nNeed to change it? {manage}{sign}", "sms": f"{tn} reminder: {vl} {when_s}. Manage: {manage}"}
    if k == "reminder_2h":
        return {"subject": f"Starting soon — {vl}", "text": f"{hello}\n\nYour appointment starts in about 2 hours.\n\n{details}{sign}", "sms": f"{tn}: {vl} starts in ~2 hours ({when_s})."}
    if k == "cancellation":
        late = f"\n\nThis was inside the {r['late_cancel_hours']}-hour cancellation window and may be recorded as a late cancellation." if r["late_cancel"] else ""
        return {"subject": f"Appointment cancelled — {vl}", "text": f"{hello}\n\nYour appointment has been cancelled.\n\n{details}{late}\n\nBook a new time: {manage}{sign}", "sms": f"{tn}: your {vl} on {when_s} is cancelled."}
    if k == "rescheduled":
        return {"subject": f"Appointment moved — {vl}", "text": f"{hello}\n\nYour appointment has a new time.\n\n{details}\n\nManage it: {manage}{sign}", "sms": f"{tn}: moved to {when_s}. Manage: {manage}"}
    if k == "waitlist_open":
        prov = f" with {r['provider_name']}" if r["provider_name"] else ""
        return {"subject": f"A time opened up — {vl}", "text": f"{hello}\n\nA {vl} slot just opened at {r['clinic_name']}{prov}. Times go quickly: {base}/t/{r['slug']}/{sign}", "sms": f"{tn}: a {vl} time opened at {r['clinic_name']}. Book: {base}/t/{r['slug']}/"}
    return None


class Notifier:
    def __init__(self, db, channels: Channels, clock: Callable[[], datetime] = _now):
        self.db, self.channels, self.now = db, channels, clock

    def dispatch(self, limit: int = 100, appointment_id: str | None = None) -> dict:
        """Sends due messages. Safe to run from several workers at once: each row is leased before it is sent."""
        res = {"sent": 0, "skipped": 0, "failed": 0, "retried": 0}
        now_iso = iso(self.now())
        extra = "AND o.appointment_id = ?" if appointment_id else ""
        params = [now_iso] + ([appointment_id] if appointment_id else []) + [limit]
        due = self.db.all(f"{_SELECT} WHERE o.status = 'pending' AND o.send_after <= ? {extra} ORDER BY o.id LIMIT ?", *params)
        for r in due:
            lease = iso(self.now() + LEASE)
            if self.db.run("UPDATE outbox SET attempts = attempts + 1, send_after = ? WHERE id = ? AND status = 'pending' AND send_after <= ?", lease, r["id"], now_iso) == 0:
                continue                                   # another worker has it
            skip = self._skip_reason(r)
            if skip:
                self._finish(r["id"], "skipped", skip); res["skipped"] += 1; continue
            try:
                msg = render(r, self.channels.base_url)
                if not msg:
                    self._finish(r["id"], "skipped", "no_template"); res["skipped"] += 1; continue
                if r["channel"] == "email":
                    self.channels.email(r["email"], msg["subject"], msg["text"])
                else:
                    self.channels.sms(r["phone"], msg["sms"])
                self._finish(r["id"], "sent"); res["sent"] += 1
            except Exception as e:  # noqa: BLE001 - a vendor failure must not stop the batch
                reason = (str(e) or "send_failed")[:200]
                if r["attempts"] + 1 >= MAX_ATTEMPTS:
                    self._finish(r["id"], "failed", reason); res["failed"] += 1
                else:
                    self.db.run("UPDATE outbox SET last_error = ?, send_after = ? WHERE id = ?", reason,
                                iso(self.now() + timedelta(minutes=r["attempts"] * 5 + 1)), r["id"]); res["retried"] += 1
        return res

    def _skip_reason(self, r: dict) -> str | None:
        if r["channel"] == "email" and (not self.channels.email or r["notify_email"] != 1 or not r["email"]):
            return "email_not_configured" if not self.channels.email else "recipient_opted_out"
        if r["channel"] == "sms" and (not self.channels.sms or r["notify_sms"] != 1 or not r["phone"]):
            return "sms_not_configured" if not self.channels.sms else "recipient_not_opted_in"
        if r["kind"] in ("reminder_24h", "reminder_2h"):
            if r["a_status"] != "confirmed":
                return "appointment_not_confirmed"
            if not r["starts_at"] or ms(r["starts_at"]) <= ms(self.now()):
                return "appointment_started"
        return None

    def _finish(self, id_: int, status: str, err: str | None = None) -> None:
        self.db.run("UPDATE outbox SET status = ?, last_error = ?, sent_at = ? WHERE id = ?", status, err, iso(self.now()), id_)
