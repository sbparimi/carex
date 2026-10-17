"""Staff accounts (front desk, provider, admin) and the staff desk: day schedule, status changes, cancel/reschedule, booking by phone, exports."""
from __future__ import annotations

import csv
import io
import re
import uuid
from datetime import datetime, timedelta
from typing import Callable

from .accounts import hash_password, normalize_email, password_problem, verify_password, _dummy
from .intake import Intake, IntakeError
from .scheduling import BookingNotFoundError, ReserveInput, Scheduling, SlotTakenError
from .util import iso, local_parts, ms, now as _now, parse, sha256, token as new_token

ABSOLUTE_MS, TOUCH_MS, MAX_FAILED, LOCK_MS = 12 * 3_600_000, 60_000, 5, 15 * 60_000
ROLES = ("front_desk", "provider", "admin")
_EMAIL = re.compile(r"[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}")
_PHONE = re.compile(r"[0-9+() .\-]{7,20}")
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


class StaffError(Exception):
    def __init__(self, code: str, message: str, fields: dict | None = None):
        super().__init__(message)
        self.code, self.fields = code, fields or {}


def _principal(r: dict) -> dict:
    return {"id": r["id"], "name": r["name"], "email": r["email"], "role": r["role"], "provider_id": r["provider_id"]}


class StaffAccounts:
    def __init__(self, db, clock: Callable[[], datetime] = _now):
        self.db, self.now = db, clock

    def create(self, tenant_id: str, *, email, name, role, password, provider_id=None) -> dict:
        f: dict[str, str] = {}
        em = normalize_email(email) if isinstance(email, str) else ""
        if not _EMAIL.fullmatch(em):
            f["email"] = "Enter a valid email address"
        nm = name.strip() if isinstance(name, str) else ""
        if not nm or len(nm) > 120:
            f["name"] = "Enter a name"
        if role not in ROLES:
            f["role"] = "Role must be front_desk, provider or admin"
        pw = password_problem(password, em)
        if pw:
            f["password"] = pw
        pid = None
        if role == "provider":
            if not provider_id or not self.db.get("SELECT 1 AS ok FROM providers WHERE tenant_id = ? AND id = ?", tenant_id, provider_id):
                f["provider_id"] = "Choose the provider this login belongs to"
            else:
                pid = provider_id
        if f:
            raise StaffError("invalid_input", "Please check the highlighted fields", f)
        sid = f"st_{uuid.uuid4()}"
        try:
            self.db.run("INSERT INTO staff_users (id, tenant_id, email, password_hash, name, role, provider_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
                        sid, tenant_id, em, hash_password(password), nm, role, pid, iso(self.now()))
        except Exception as e:
            if self.db.is_unique(e):
                raise StaffError("conflict", "A staff login with that email already exists")
            raise
        return {"id": sid, "name": nm, "email": em, "role": role, "provider_id": pid}

    def list(self, tenant_id: str) -> list[dict]:
        return [{**_principal(r), "active": r["active"] == 1} for r in self.db.all("SELECT id, email, name, role, provider_id, active FROM staff_users WHERE tenant_id = ? ORDER BY name, id", tenant_id)]

    def set_active(self, tenant_id: str, sid: str, active: bool) -> None:
        if self.db.run("UPDATE staff_users SET active = ? WHERE tenant_id = ? AND id = ?", 1 if active else 0, tenant_id, sid) == 0:
            raise StaffError("not_found", "Not found")
        if not active:
            self.db.run("DELETE FROM staff_sessions WHERE staff_id = ?", sid)

    def set_password(self, tenant_id: str, sid: str, password: str) -> None:
        p = password_problem(password)
        if p:
            raise StaffError("invalid_input", p, {"password": p})
        if self.db.run("UPDATE staff_users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE tenant_id = ? AND id = ?", hash_password(password), tenant_id, sid) == 0:
            raise StaffError("not_found", "Not found")
        self.db.run("DELETE FROM staff_sessions WHERE staff_id = ?", sid)

    def login(self, tenant_id: str, email_raw: str, password: str) -> tuple[dict, str]:
        em = normalize_email(email_raw) if isinstance(email_raw, str) else ""
        bad = StaffError("invalid_credentials", "Invalid email or password")
        u = None
        if isinstance(password, str) and len(password) <= 128:
            u = self.db.get("SELECT id, password_hash, name, role, provider_id, active, failed_logins, locked_until FROM staff_users WHERE tenant_id = ? AND email = ?", tenant_id, em)
        if not u:
            verify_password(str(password)[:128], _dummy())
            raise bad
        if u["locked_until"] and ms(u["locked_until"]) > ms(self.now()):
            raise StaffError("locked", "Too many failed attempts. Try again in a few minutes.")
        if not verify_password(password, u["password_hash"]) or u["active"] != 1:
            n = u["failed_logins"] + 1
            self.db.run("UPDATE staff_users SET failed_logins = ?, locked_until = ? WHERE id = ?", 0 if n >= MAX_FAILED else n, iso(self.now() + timedelta(milliseconds=LOCK_MS)) if n >= MAX_FAILED else None, u["id"])
            raise bad
        self.db.run("UPDATE staff_users SET failed_logins = 0, locked_until = NULL WHERE id = ?", u["id"])
        tok, t = new_token(), self.now()
        self.db.run("INSERT INTO staff_sessions (token_hash, staff_id, tenant_id, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)",
                    sha256(tok), u["id"], tenant_id, iso(t), iso(t + timedelta(milliseconds=ABSOLUTE_MS)), iso(t))
        return _principal({**u, "email": em}), tok

    def logout(self, tenant_id: str, token: str | None) -> None:
        if token:
            self.db.run("DELETE FROM staff_sessions WHERE token_hash = ? AND tenant_id = ?", sha256(token), tenant_id)

    def authenticate(self, tenant_id: str, token: str | None) -> dict | None:
        if not token or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            return None
        s = self.db.get("""SELECT s.staff_id, s.expires_at, s.last_seen_at, t.session_idle_minutes AS idle, u.email, u.name, u.role, u.provider_id, u.active
                             FROM staff_sessions s JOIN tenants t ON t.id = s.tenant_id JOIN staff_users u ON u.id = s.staff_id WHERE s.token_hash = ? AND s.tenant_id = ?""", sha256(token), tenant_id)
        if not s:
            return None
        now = ms(self.now())
        if s["active"] != 1 or ms(s["expires_at"]) <= now or now - ms(s["last_seen_at"]) > s["idle"] * 60_000:
            self.db.run("DELETE FROM staff_sessions WHERE token_hash = ?", sha256(token))
            return None
        if now - ms(s["last_seen_at"]) > TOUCH_MS:
            self.db.run("UPDATE staff_sessions SET last_seen_at = ? WHERE token_hash = ?", iso(self.now()), sha256(token))
        return {"id": s["staff_id"], "name": s["name"], "email": s["email"], "role": s["role"], "provider_id": s["provider_id"]}


_SELECT = """SELECT a.id, a.starts_at, a.ends_at, a.status, a.clinic_id, c.name AS clinic_name, c.time_zone, v.label AS visit_label, a.provider_id, p.display_name AS provider_name,
    a.patient_first_name, a.patient_last_name, a.patient_dob, u.date_of_birth AS u_dob, pt.date_of_birth AS pt_dob, a.patient_phone, a.patient_email, a.reason, a.modality, a.join_url, a.copay_cents,
    a.accommodations, a.interpreter_language, a.referral_ref, a.booked_by, a.late_cancel, a.cancel_reason, a.user_id
  FROM appointments a JOIN clinics c ON c.id = a.clinic_id JOIN visit_types v ON v.id = a.visit_type_id JOIN providers p ON p.id = a.provider_id
  LEFT JOIN users u ON u.id = a.user_id LEFT JOIN patients pt ON pt.id = a.patient_id"""


def to_row(r: dict) -> dict:
    return {"id": r["id"], "starts_at": r["starts_at"], "ends_at": r["ends_at"], "time_zone": r["time_zone"], "status": r["status"], "clinic_id": r["clinic_id"], "clinic_name": r["clinic_name"],
            "visit_label": r["visit_label"], "provider_id": r["provider_id"], "provider_name": r["provider_name"], "patient_name": f"{r['patient_first_name']} {r['patient_last_name']}".strip(),
            "patient_dob": r["patient_dob"] or r["pt_dob"] or r["u_dob"], "phone": r["patient_phone"], "email": r["patient_email"], "reason": r["reason"], "modality": r["modality"],
            "join_url": r["join_url"], "copay_cents": r["copay_cents"], "accommodations": r["accommodations"], "interpreter_language": r["interpreter_language"],
            "referral_ref": r["referral_ref"], "booked_by": r["booked_by"], "late_cancel": r["late_cancel"] == 1, "cancel_reason": r["cancel_reason"], "has_account": bool(r["user_id"])}


TRANSITIONS = {"confirmed": ["arrived", "completed", "no_show"], "arrived": ["completed", "confirmed"], "completed": ["arrived"], "no_show": ["confirmed"], "cancelled": []}


def _local_date(iso_s: str, tz: str) -> str:
    l = local_parts(parse(iso_s), tz)
    return f"{l['year']:04d}-{l['month']:02d}-{l['day']:02d}"


def _valid_date(s: str) -> bool:
    try:
        return bool(_DATE.fullmatch(s)) and parse(s + "T00:00:00Z") is not None
    except ValueError:
        return False


class StaffDesk:
    def __init__(self, db, sched: Scheduling, intake: Intake, clock: Callable[[], datetime] = _now):
        self.db, self.sched, self.intake, self.now = db, sched, intake, clock

    @staticmethod
    def _scope(staff: dict) -> tuple[str, list]:
        return (" AND a.provider_id = ?", [staff["provider_id"]]) if staff["role"] == "provider" else ("", [])

    def catalog(self, tenant_id: str, staff: dict) -> dict:
        clinics = self.db.all("SELECT id, name, time_zone, state_code FROM clinics WHERE tenant_id = ? AND status = 'active' ORDER BY name, id", tenant_id)
        links = self.db.all("""SELECT e.clinic_id, e.visit_type_id, v.label, v.duration_min, e.provider_id, p.display_name FROM provider_eligibility e
                                 JOIN clinic_visit_types cv ON cv.clinic_id = e.clinic_id AND cv.visit_type_id = e.visit_type_id AND cv.active = 1
                                 JOIN visit_types v ON v.id = e.visit_type_id AND v.status = 'active' JOIN providers p ON p.id = e.provider_id AND p.status = 'active'
                                WHERE e.tenant_id = ? AND e.active = 1 ORDER BY v.label, p.display_name""", tenant_id)
        out = []
        for c in clinics:
            ls = [l for l in links if l["clinic_id"] == c["id"]]
            vts = {l["visit_type_id"]: {"id": l["visit_type_id"], "label": l["label"], "duration_min": l["duration_min"]} for l in ls}
            pr = {}
            for l in ls:
                if staff["role"] == "provider" and l["provider_id"] != staff["provider_id"]:
                    continue
                pr.setdefault(l["provider_id"], {"id": l["provider_id"], "display_name": l["display_name"], "visit_type_ids": []})["visit_type_ids"].append(l["visit_type_id"])
            out.append({"id": c["id"], "name": c["name"], "time_zone": c["time_zone"], "state_code": c["state_code"], "visit_types": list(vts.values()), "providers": list(pr.values())})
        return {"staff": staff, "clinics": out}

    def schedule(self, tenant_id: str, staff: dict, date: str, clinic_id: str | None = None, provider_id: str | None = None) -> list[dict]:
        """One local day at one clinic (or all of a provider's clinics), soonest first. `date` is YYYY-MM-DD in the clinic's own time zone."""
        if not _valid_date(date):
            raise StaffError("invalid_input", "date must be YYYY-MM-DD")
        sql, params = self._scope(staff)
        day = parse(date + "T00:00:00Z")
        rows = self.db.all(f"{_SELECT} WHERE a.tenant_id = ? AND a.starts_at >= ? AND a.starts_at < ?{' AND a.clinic_id = ?' if clinic_id else ''}{' AND a.provider_id = ?' if provider_id else ''}{sql} ORDER BY a.starts_at, a.id",
                           tenant_id, iso(day - timedelta(days=1)), iso(day + timedelta(days=2)), *([clinic_id] if clinic_id else []), *([provider_id] if provider_id else []), *params)
        return [to_row(r) for r in rows if _local_date(r["starts_at"], r["time_zone"]) == date]

    def _load(self, tenant_id: str, staff: dict, aid: str, lock: bool = False, db=None) -> dict:
        db = db or self.db
        sql, params = self._scope(staff)
        r = db.get(f"{_SELECT} WHERE a.tenant_id = ? AND a.id = ?{sql}{' FOR UPDATE OF a' if lock and db.kind == 'pg' else ''}", tenant_id, aid, *params)
        if not r:
            raise StaffError("not_found", "Not found")
        return r

    def get(self, tenant_id: str, staff: dict, aid: str) -> dict:
        return to_row(self._load(tenant_id, staff, aid))

    def set_status(self, tenant_id: str, staff: dict, aid: str, status: str) -> dict:
        with self.db.tx() as tx:
            r = self._load(tenant_id, staff, aid, True, tx)
            if r["status"] == status:
                return to_row(r)
            if status not in TRANSITIONS.get(r["status"], []):
                raise StaffError("conflict", f"An appointment that is {r['status'].replace('_', ' ')} can't be marked {status.replace('_', ' ')}")
            if status == "no_show" and ms(r["starts_at"]) > ms(self.now()):
                raise StaffError("conflict", "An appointment can only be marked no-show after its start time")
            ts = iso(self.now())
            tx.run("UPDATE appointments SET status = ?, status_changed_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?", status, ts, ts, tenant_id, aid)
            return to_row({**r, "status": status})

    def cancel(self, tenant_id: str, staff: dict, aid: str, reason: str = "") -> dict:
        r = self._load(tenant_id, staff, aid)
        if r["status"] not in ("confirmed", "cancelled"):
            raise StaffError("conflict", "Only an upcoming appointment can be cancelled")
        try:
            self.sched.cancel(tenant_id, aid, (reason or "")[:200], "staff")
        except BookingNotFoundError:
            raise StaffError("not_found", "Not found")
        return self.get(tenant_id, staff, aid)

    def reschedule(self, tenant_id: str, staff: dict, aid: str, slot_id: str) -> dict:
        self._load(tenant_id, staff, aid)
        try:
            self.sched.reschedule(tenant_id, aid, slot_id, "staff")
        except SlotTakenError:
            raise StaffError("conflict", "That time is no longer available")
        except BookingNotFoundError:
            raise StaffError("not_found", "Not found")
        return self.get(tenant_id, staff, aid)

    def slots(self, tenant_id: str, staff: dict, clinic_id: str, service_id: str, provider_id: str) -> list[dict]:
        if staff["role"] == "provider" and provider_id != staff["provider_id"]:
            raise StaffError("forbidden", "Not allowed")
        return self.sched.list_slots(tenant_id, clinic_id, service_id, provider_id)

    def book(self, tenant_id: str, staff: dict, b: dict) -> dict:
        """Book a phone or walk-in patient who has no account. Same safety rules as self-service; the staff member attests the screening was read and verbal consent given."""
        if staff["role"] == "provider":
            raise StaffError("forbidden", "Providers can't book on behalf of patients")
        for k in ("clinic_id", "service_id", "provider_id"):
            if not isinstance(b.get(k), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", b[k]):
                raise StaffError("invalid_input", "Choose a clinic, visit type, provider and time")
        if not isinstance(b.get("slot_id"), str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,120}", b["slot_id"]):
            raise StaffError("invalid_input", "Choose a clinic, visit type, provider and time")
        f: dict[str, str] = {}
        first, last = str(b.get("first_name") or "").strip(), str(b.get("last_name") or "").strip()
        if not first or len(first) > 80:
            f["first_name"] = "Enter a first name"
        if not last or len(last) > 80:
            f["last_name"] = "Enter a last name"
        phone, email = str(b.get("phone") or "").strip(), str(b.get("email") or "").strip().lower()
        if phone and not _PHONE.fullmatch(phone):
            f["phone"] = "Enter a valid phone number"
        if email and (not _EMAIL.fullmatch(email) or len(email) > 254):
            f["email"] = "Enter a valid email address"
        if not phone and not email:
            f["phone"] = "Enter a phone number or an email so we can reach the patient"
        dob = str(b.get("date_of_birth") or "")
        if dob and (not _valid_date(dob) or parse(dob + "T00:00:00Z") > self.now()):
            f["date_of_birth"] = "Enter a valid date of birth"
        if b.get("patient_state") and not re.fullmatch(r"[A-Z]{2}", str(b["patient_state"])):
            f["patient_state"] = "Enter a two-letter state code"
        if f:
            raise StaffError("invalid_input", next(iter(f.values())), f)
        req = {"clinic_id": b["clinic_id"], "service_id": b["service_id"], "provider_id": b["provider_id"], "slot_id": b["slot_id"], "reason": b.get("reason") if isinstance(b.get("reason"), str) else None,
               "red_flags": [str(x) for x in b["red_flags"]] if isinstance(b.get("red_flags"), list) else None, "modality": b.get("modality") if b.get("modality") in ("in_person", "telehealth") else None,
               "patient_state": b.get("patient_state") or None, "interpreter_language": b.get("interpreter_language") or None, "accommodations": b.get("accommodations") or None,
               "referral_ref": b.get("referral_ref") or None, "consent_attested": b.get("consent_attested") is True}
        try:
            dec = self.intake.prepare_for_staff(tenant_id, {"first_name": first, "last_name": last, "date_of_birth": dob or None}, req)
        except IntakeError as e:
            raise StaffError("conflict" if e.code == "emergency_redirect" else "invalid_input", str(e), {e.code: str(e)})
        try:
            rec = self.sched.reserve(ReserveInput(tenant_id, req["clinic_id"], req["service_id"], req["provider_id"], req["slot_id"], f"staff-{uuid.uuid4()}", first, last, email or None, phone or None,
                                                  intake=dec, booked_by="staff", staff_id=staff["id"], patient_dob=dob or None, sms_ok=b.get("sms_ok") is True))
        except SlotTakenError:
            raise StaffError("conflict", "That time is no longer available")
        return self.get(tenant_id, staff, rec["booking_id"])

    def range(self, tenant_id: str, staff: dict, frm: str, to: str) -> list[dict]:
        if not (_valid_date(frm) and _valid_date(to)) or to < frm:
            raise StaffError("invalid_input", "from and to must be dates (YYYY-MM-DD)")
        if (parse(to + "T00:00:00Z") - parse(frm + "T00:00:00Z")).days > 92:
            raise StaffError("invalid_input", "Choose a range of at most 92 days")
        sql, params = self._scope(staff)
        rows = self.db.all(f"{_SELECT} WHERE a.tenant_id = ? AND a.starts_at >= ? AND a.starts_at < ?{sql} ORDER BY a.starts_at, a.id",
                           tenant_id, iso(parse(frm + "T00:00:00Z") - timedelta(days=1)), iso(parse(to + "T00:00:00Z") + timedelta(days=2)), *params)
        return [to_row(r) for r in rows if frm <= _local_date(r["starts_at"], r["time_zone"]) <= to]


def to_csv(rows: list[dict]) -> str:
    """Spreadsheet-safe CSV: values that start with = + - @ or a tab/CR are prefixed with an apostrophe so they can't run as formulas."""
    def cell(v):
        s = "" if v is None else str(v)
        return "'" + s if s and s[0] in "=+-@\t\r" else s
    def when(iso_s, tz):
        l = local_parts(parse(iso_s), tz)
        return f"{l['year']:04d}-{l['month']:02d}-{l['day']:02d}", f"{l['minute_of_day'] // 60:02d}:{l['minute_of_day'] % 60:02d}"
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(["Reference", "Date", "Start", "End", "Time zone", "Clinic", "Visit", "Provider", "Patient", "Phone", "Email", "Status", "Format", "Copay", "Booked by", "Late cancel"])
    for r in rows:
        d, s = when(r["starts_at"], r["time_zone"])
        _, e = when(r["ends_at"], r["time_zone"])
        w.writerow([cell(x) for x in (r["id"], d, s, e, r["time_zone"], r["clinic_name"], r["visit_label"], r["provider_name"], r["patient_name"], r["phone"], r["email"], r["status"],
                                      r["modality"], f"{r['copay_cents'] / 100:.2f}", r["booked_by"], "yes" if r["late_cancel"] else "")])
    return out.getvalue()


def to_fhir(rows: list[dict], base_url: str) -> dict:
    """FHIR R4 Appointment bundle (minimal profile: no identifiers beyond display names and the CareX reference)."""
    st = {"confirmed": "booked", "arrived": "arrived", "completed": "fulfilled", "no_show": "noshow", "cancelled": "cancelled"}
    entries = []
    for r in rows:
        res = {"resourceType": "Appointment", "id": r["id"], "identifier": [{"system": "urn:carex:appointment-reference", "value": r["id"]}], "status": st.get(r["status"], "booked"),
               "start": r["starts_at"], "end": r["ends_at"], "minutesDuration": round((ms(r["ends_at"]) - ms(r["starts_at"])) / 60_000),
               "serviceType": [{"text": r["visit_label"]}], "appointmentType": {"text": "Video visit" if r["modality"] == "telehealth" else "In person"},
               "participant": [{"actor": {"display": r["patient_name"], "type": "Patient"}, "status": "accepted"}, {"actor": {"display": r["provider_name"], "type": "Practitioner"}, "status": "accepted"},
                               {"actor": {"display": r["clinic_name"], "type": "Location"}, "status": "accepted"}]}
        if r["reason"]:
            res["reasonCode"] = [{"text": r["reason"]}]
        if r["cancel_reason"]:
            res["cancelationReason"] = {"text": r["cancel_reason"]}
        entries.append({"fullUrl": f"{base_url.rstrip('/')}/Appointment/{r['id']}", "resource": res})
    return {"resourceType": "Bundle", "type": "searchset", "total": len(rows), "entry": entries}
