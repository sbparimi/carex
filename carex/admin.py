"""Tenant-scoped configuration changes (ADR-004). Every statement filters on tenant_id; a row of another tenant is indistinguishable from a missing one."""
from __future__ import annotations

import csv
import io
import re
import secrets
from datetime import datetime
from typing import Callable
from zoneinfo import ZoneInfo

from .util import iso, now as _now, parse, sha256


class AdminNotFoundError(Exception): ...
class AdminValidationError(Exception): ...


def _bad(m: str):
    raise AdminValidationError(m)


def _text(v, name: str, mx: int = 120) -> str:
    if isinstance(v, str) and v.strip() and len(v.strip()) <= mx:
        return v.strip()
    _bad(f"{name} is required (max {mx} characters)")


def _tz(tz) -> str:
    try:
        if isinstance(tz, str) and "/" in tz:
            ZoneInfo(tz)
            return tz
    except Exception:
        pass
    _bad("time_zone must be an IANA name")


def _instant(s) -> datetime:
    try:
        return parse(s)
    except Exception:
        _bad("enter valid start and end times")


class Admin:
    def __init__(self, db, clock: Callable[[], datetime] = _now, audit=None):
        self.db, self.now, self.audit = db, clock, audit

    def _tenant(self, t):
        if not self.db.get("SELECT 1 AS ok FROM tenants WHERE id = ?", t):
            raise AdminNotFoundError()

    def _clinic(self, t, c):
        if not self.db.get("SELECT 1 AS ok FROM clinics WHERE tenant_id = ? AND id = ?", t, c):
            raise AdminNotFoundError()

    def _provider(self, t, p):
        if not self.db.get("SELECT 1 AS ok FROM providers WHERE tenant_id = ? AND id = ?", t, p):
            raise AdminNotFoundError()

    # ---- brand and analytics
    def update_brand(self, tenant_id: str, patch: dict, actor_id: str | None = None) -> dict:
        self._tenant(tenant_id)
        sets, args = [], []
        if "display_name" in patch:
            sets.append("display_name = ?"); args.append(_text(patch["display_name"], "display_name", 80))
        if "primary_color" in patch:
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", str(patch["primary_color"])):
                _bad("primary_color must be #rrggbb")
            sets.append("primary_color = ?"); args.append(patch["primary_color"])
        if "logo_url" in patch:
            if patch["logo_url"] is not None and not re.fullmatch(r"https://\S{1,500}", str(patch["logo_url"])):
                _bad("logo_url must be an https URL")
            sets.append("logo_url = ?"); args.append(patch["logo_url"])
        if "support_email" in patch:
            if patch["support_email"] is not None and not re.fullmatch(r"[^\s@]{1,64}@[^\s@]{1,255}", str(patch["support_email"])):
                _bad("support_email is invalid")
            sets.append("support_email = ?"); args.append(patch["support_email"])
        if "support_phone" in patch:
            if patch["support_phone"] is not None and not re.fullmatch(r"[0-9+()\-. ]{5,30}", str(patch["support_phone"])):
                _bad("support_phone is invalid")
            sets.append("support_phone = ?"); args.append(patch["support_phone"])
        with self.db.tx() as tx:
            if sets:
                tx.run(f"UPDATE tenants SET {', '.join(sets)} WHERE id = ?", *args, tenant_id)
            if self.audit and actor_id:
                self.audit.record(tenant_id, "staff", "setup.brand", actor_id=actor_id, db=tx)
            r = tx.get("SELECT display_name, primary_color, logo_url, support_email, support_phone FROM tenants WHERE id = ?", tenant_id)
        return {k: v for k, v in r.items() if v is not None}

    def set_analytics(self, tenant_id: str, enabled: bool) -> None:
        self._tenant(tenant_id)
        self.db.run("UPDATE tenants SET analytics_enabled = ? WHERE id = ?", 1 if enabled else 0, tenant_id)

    # ---- clinics
    def list_clinics(self, tenant_id: str) -> list[dict]:
        self._tenant(tenant_id)
        return [{**r, "bookable": r["bookable"] == 1} for r in self.db.all("SELECT id, name, city, address, state_code, time_zone, status, bookable FROM clinics WHERE tenant_id = ? ORDER BY name, id", tenant_id)]

    def create_clinic(self, tenant_id: str, c: dict, actor_id: str | None = None) -> dict:
        """New clinics start inactive and not bookable: nothing becomes visible to patients until an admin activates it."""
        self._tenant(tenant_id)
        name, city, addr = _text(c.get("name"), "name"), _text(c.get("city"), "city"), _text(c.get("address"), "address", 200)
        if not re.fullmatch(r"[A-Z]{2}", str(c.get("state_code"))):
            _bad("state_code must be two capital letters")
        tz = _tz(c.get("time_zone"))
        cid = "cl-" + secrets.token_hex(5)
        with self.db.tx() as tx:
            tx.run("INSERT INTO clinics (id, tenant_id, name, city, address, state_code, time_zone, status, bookable) VALUES (?,?,?,?,?,?,?,'inactive',0)", cid, tenant_id, name, city, addr, c["state_code"], tz)
            if self.audit and actor_id:
                self.audit.record(tenant_id, "staff", "setup.clinic_create", actor_id=actor_id, target_type="clinic", target_id=cid, db=tx)
        return {"id": cid, "name": name, "city": city, "address": addr, "state_code": c["state_code"], "time_zone": tz, "status": "inactive", "bookable": False}

    IMPORT_COLUMNS = ("name", "city", "address", "state", "time_zone", "phone", "hours", "about", "photo_url")
    IMPORT_MAX_ROWS = 500

    def import_clinics(self, tenant_id: str, text: str, commit: bool = True, actor_id: str | None = None) -> dict:
        """Reads pasted CSV (header row: name, city, address, state, time_zone, then optional phone, hours, about, photo_url).

        All or nothing: when any row is wrong nothing is saved and every problem is listed with its line number. Imported clinics start hidden,
        like clinics added one by one, so nothing reaches patients until someone switches it on. Existing name+address pairs are skipped, so a re-upload is safe."""
        self._tenant(tenant_id)
        text = (text or "").replace("\ufeff", "").strip()
        if not text:
            _bad("paste the CSV, starting with the header row")
        sample = text.splitlines()[0]
        delim = ";" if sample.count(";") > sample.count(",") and sample.count(";") > sample.count("\t") else ("\t" if sample.count("\t") > sample.count(",") else ",")
        rows = list(csv.reader(io.StringIO(text), delimiter=delim))
        head = [h.strip().lower().replace(" ", "_") for h in rows[0]]
        alias = {"timezone": "time_zone", "zone": "time_zone", "state_code": "state", "opening_hours": "hours", "hours_text": "hours", "image_url": "photo_url", "photo": "photo_url", "street": "address", "phone_number": "phone"}
        head = [alias.get(h, h) for h in head]
        missing = [k for k in ("name", "city", "address", "state", "time_zone") if k not in head]
        if missing:
            _bad("the header row is missing: " + ", ".join(missing))
        body = [r for r in rows[1:] if any(c.strip() for c in r)]
        if not body:
            _bad("there are no clinic rows under the header")
        if len(body) > self.IMPORT_MAX_ROWS:
            _bad(f"at most {self.IMPORT_MAX_ROWS} clinics per import")
        have = {(r["name"].strip().lower(), r["address"].strip().lower()) for r in self.db.all("SELECT name, address FROM clinics WHERE tenant_id = ?", tenant_id)}
        good, errors, skipped, seen = [], [], 0, set()
        for i, r in enumerate(body, start=2):
            d = {h: (r[j].strip() if j < len(r) else "") for j, h in enumerate(head)}
            try:
                state = d["state"].upper()
                if not re.fullmatch(r"[A-Z]{2}", state):
                    _bad("state must be two letters, like TX")
                row = {"name": _text(d["name"], "name"), "city": _text(d["city"], "city"), "address": _text(d["address"], "address", 200), "state_code": state, "time_zone": _tz(d["time_zone"]),
                       "phone": d.get("phone", ""), "hours": d.get("hours", ""), "about": d.get("about", ""), "photo": d.get("photo_url", "")}
                if row["phone"] and not re.fullmatch(r"[0-9+()\-. ]{5,30}", row["phone"]):
                    _bad("phone is invalid")
                if len(row["hours"]) > 200 or len(row["about"]) > 400:
                    _bad("hours or notes are too long")
                if row["photo"] and not re.fullmatch(r"https://\S{1,500}", row["photo"]):
                    _bad("photo must be an https URL")
            except AdminValidationError as e:
                errors.append({"line": i, "problem": str(e)})
                continue
            key = (row["name"].lower(), row["address"].lower())
            if key in have or key in seen:
                skipped += 1
                continue
            seen.add(key)
            good.append(row)
        if errors:
            return {"created": 0, "skipped": skipped, "errors": errors[:50], "more_errors": max(0, len(errors) - 50)}
        if commit:
            with self.db.tx() as tx:
                for g in good:
                    tx.run("""INSERT INTO clinics (id, tenant_id, name, city, address, state_code, time_zone, status, bookable, phone, hours_text, about, image_url)
                              VALUES (?,?,?,?,?,?,?,'inactive',0,?,?,?,?)""", "cl-" + secrets.token_hex(5), tenant_id, g["name"], g["city"], g["address"], g["state_code"], g["time_zone"],
                           g["phone"] or None, g["hours"] or None, g["about"] or None, g["photo"] or None)
                if self.audit and actor_id:
                    self.audit.record(tenant_id, "staff", "setup.import_clinics", actor_id=actor_id,
                                      detail={"created": len(good), "skipped": skipped, "errors": 0}, db=tx)
        return {"created": len(good), "skipped": skipped, "errors": [], "more_errors": 0, "committed": commit}

    def update_clinic(self, tenant_id: str, clinic_id: str, p: dict, actor_id: str | None = None) -> dict:
        self._clinic(tenant_id, clinic_id)
        sets, args = [], []
        for k, mx in (("name", 120), ("city", 120), ("address", 200)):
            if k in p:
                sets.append(f"{k} = ?"); args.append(_text(p[k], k, mx))
        if "time_zone" in p:
            sets.append("time_zone = ?"); args.append(_tz(p["time_zone"]))
        if "status" in p:
            if p["status"] not in ("active", "inactive"):
                _bad("status must be active or inactive")
            sets.append("status = ?"); args.append(p["status"])
        if "bookable" in p:
            if not isinstance(p["bookable"], bool):
                _bad("bookable must be true or false")
            sets.append("bookable = ?"); args.append(1 if p["bookable"] else 0)
        with self.db.tx() as tx:
            if sets:
                tx.run(f"UPDATE clinics SET {', '.join(sets)} WHERE tenant_id = ? AND id = ?", *args, tenant_id, clinic_id)
            clinic = tx.get("SELECT id, name, city, address, state_code, time_zone, status, bookable FROM clinics WHERE tenant_id = ? AND id = ?", tenant_id, clinic_id)
            n = tx.get("SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND clinic_id = ? AND status = 'confirmed' AND starts_at > ?", tenant_id, clinic_id, iso(self.now()))
            if self.audit and actor_id:
                self.audit.record(tenant_id, "staff", "setup.clinic_update", actor_id=actor_id, target_type="clinic", target_id=clinic_id, db=tx)
        clinic["bookable"] = clinic["bookable"] == 1
        return {**clinic, "affected_future_appointments": int(n["n"])}

    def update_clinic_details(self, tenant_id: str, clinic_id: str, p: dict, actor_id: str | None = None) -> None:
        """What patients see on the clinic page: phone, opening hours, a short note (parking, access) and an optional https photo."""
        self._clinic(tenant_id, clinic_id)
        phone, hours, about, img = ((p.get(k) or "").strip() for k in ("phone", "hours_text", "about", "image_url"))
        if phone and not re.fullmatch(r"[0-9+()\-. ]{5,30}", phone):
            _bad("phone is invalid")
        if len(hours) > 200 or len(about) > 400:
            _bad("hours or notes are too long")
        if img and not re.fullmatch(r"https://\S{1,500}", img):
            _bad("photo must be an https URL")
        with self.db.tx() as tx:
            tx.run("UPDATE clinics SET phone = ?, hours_text = ?, about = ?, image_url = ? WHERE tenant_id = ? AND id = ?", phone or None, hours or None, about or None, img or None, tenant_id, clinic_id)
            if self.audit and actor_id:
                self.audit.record(tenant_id, "staff", "setup.clinic_update", actor_id=actor_id, target_type="clinic", target_id=clinic_id, db=tx)

    def set_clinic_visit_type(self, tenant_id: str, clinic_id: str, visit_type_id: str, active: bool) -> None:
        self._clinic(tenant_id, clinic_id)
        if not self.db.get("SELECT 1 AS ok FROM visit_types WHERE tenant_id = ? AND id = ?", tenant_id, visit_type_id):
            raise AdminNotFoundError()
        self.db.run("INSERT INTO clinic_visit_types (tenant_id, clinic_id, visit_type_id, active) VALUES (?,?,?,?) ON CONFLICT(clinic_id, visit_type_id) DO UPDATE SET active = excluded.active",
                    tenant_id, clinic_id, visit_type_id, 1 if active else 0)

    # ---- availability and time off
    def get_availability(self, tenant_id: str, provider_id: str, clinic_id: str) -> list[dict]:
        self._provider(tenant_id, provider_id); self._clinic(tenant_id, clinic_id)
        return self.db.all("SELECT weekday, start_minute, end_minute FROM availability_rules WHERE tenant_id = ? AND provider_id = ? AND clinic_id = ? ORDER BY weekday, start_minute", tenant_id, provider_id, clinic_id)

    def set_availability(self, tenant_id: str, provider_id: str, clinic_id: str, rules: list[dict], actor_id: str | None = None) -> None:
        """Replaces the whole weekly schedule in one transaction; invalid input changes nothing."""
        self._provider(tenant_id, provider_id); self._clinic(tenant_id, clinic_id)
        if not isinstance(rules, list) or len(rules) > 70:
            _bad("rules must be a list of at most 70 entries")
        for r in rules:
            if not isinstance(r, dict) or not all(isinstance(r.get(k), int) and not isinstance(r.get(k), bool) for k in ("weekday", "start_minute", "end_minute")):
                _bad("rule fields must be integers")
            if r["weekday"] < 0 or r["weekday"] > 6:
                _bad("weekday must be 0-6")
            if r["start_minute"] < 0 or r["end_minute"] > 1440 or r["end_minute"] <= r["start_minute"]:
                _bad("a rule must end after it starts, within one day")
        s = sorted(rules, key=lambda r: (r["weekday"], r["start_minute"]))
        for a, b in zip(s, s[1:]):
            if a["weekday"] == b["weekday"] and b["start_minute"] < a["end_minute"]:
                _bad("rules overlap")
        with self.db.tx() as tx:
            tx.run("DELETE FROM availability_rules WHERE tenant_id = ? AND provider_id = ? AND clinic_id = ?", tenant_id, provider_id, clinic_id)
            for r in s:
                tx.run("INSERT INTO availability_rules (tenant_id, provider_id, clinic_id, weekday, start_minute, end_minute) VALUES (?,?,?,?,?,?)", tenant_id, provider_id, clinic_id, r["weekday"], r["start_minute"], r["end_minute"])
            if self.audit and actor_id:
                self.audit.record(tenant_id, "staff", "schedule.hours_change", actor_id=actor_id, target_type="provider", target_id=provider_id, db=tx)

    def add_time_off(self, tenant_id: str, provider_id: str, starts_at: str, ends_at: str, actor_id: str | None = None) -> int:
        self._provider(tenant_id, provider_id)
        s, e = _instant(starts_at), _instant(ends_at)
        if e <= s:
            _bad("time off must end after it starts")
        with self.db.tx() as tx:
            r = tx.get("INSERT INTO time_off (tenant_id, provider_id, starts_at, ends_at) VALUES (?,?,?,?) RETURNING id", tenant_id, provider_id, iso(s), iso(e))
            if self.audit and actor_id:
                self.audit.record(tenant_id, "staff", "schedule.time_off_add", actor_id=actor_id, target_type="provider", target_id=provider_id, db=tx)
        return int(r["id"])

    def remove_time_off(self, tenant_id: str, id_: int, actor_id: str | None = None) -> None:
        with self.db.tx() as tx:
            row = tx.get("SELECT provider_id FROM time_off WHERE tenant_id = ? AND id = ?", tenant_id, id_)
            if not row or tx.run("DELETE FROM time_off WHERE tenant_id = ? AND id = ?", tenant_id, id_) == 0:
                raise AdminNotFoundError()
            if self.audit and actor_id:
                self.audit.record(tenant_id, "staff", "schedule.time_off_remove", actor_id=actor_id, db=tx)

    def list_time_off(self, tenant_id: str, provider_id: str) -> list[dict]:
        self._provider(tenant_id, provider_id)
        return self.db.all("SELECT id, starts_at, ends_at FROM time_off WHERE tenant_id = ? AND provider_id = ? AND ends_at > ? ORDER BY starts_at", tenant_id, provider_id, iso(self.now()))

    def add_closure(self, tenant_id: str, clinic_id: str, starts_at: str, ends_at: str, reason: str = "", actor_id: str | None = None) -> dict:
        """Closes a clinic for a period: no provider is bookable there in that window. Existing appointments are untouched; staff move them."""
        self._clinic(tenant_id, clinic_id)
        s, e = _instant(starts_at), _instant(ends_at)
        if e <= s:
            _bad("a closure must end after it starts")
        with self.db.tx() as tx:
            r = tx.get("INSERT INTO clinic_closures (tenant_id, clinic_id, starts_at, ends_at, reason) VALUES (?,?,?,?,?) RETURNING id", tenant_id, clinic_id, iso(s), iso(e), str(reason or "")[:120])
            n = tx.get("SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND clinic_id = ? AND status = 'confirmed' AND starts_at < ? AND ends_at > ?", tenant_id, clinic_id, iso(e), iso(s))
            if self.audit and actor_id:
                self.audit.record(tenant_id, "staff", "schedule.closure_add", actor_id=actor_id, target_type="clinic", target_id=clinic_id, detail={"affected": int(n["n"])}, db=tx)
        return {"id": int(r["id"]), "affected_appointments": int(n["n"])}

    def list_closures(self, tenant_id: str, clinic_id: str) -> list[dict]:
        self._clinic(tenant_id, clinic_id)
        return self.db.all("SELECT id, starts_at, ends_at, reason FROM clinic_closures WHERE tenant_id = ? AND clinic_id = ? AND ends_at > ? ORDER BY starts_at", tenant_id, clinic_id, iso(self.now()))

    def remove_closure(self, tenant_id: str, id_: int, actor_id: str | None = None) -> None:
        with self.db.tx() as tx:
            if tx.run("DELETE FROM clinic_closures WHERE tenant_id = ? AND id = ?", tenant_id, id_) == 0:
                raise AdminNotFoundError()
            if self.audit and actor_id:
                self.audit.record(tenant_id, "staff", "schedule.closure_remove", actor_id=actor_id, db=tx)


_KEY = re.compile(r"^cxa_[A-Za-z0-9_-]{43}$")


class AdminKeys:
    """Per-tenant admin API keys (ADR-004). The plaintext is returned once at creation; only a SHA-256 hash is stored (keys are 256-bit random)."""

    def __init__(self, db, clock: Callable[[], datetime] = _now):
        self.db, self.now = db, clock

    def create(self, tenant_id: str, label: str) -> str:
        label = (label or "").strip()
        if not label or len(label) > 80:
            raise ValueError("label required (max 80 characters)")
        if not self.db.get("SELECT 1 AS ok FROM tenants WHERE id = ?", tenant_id):
            raise ValueError("unknown tenant")
        key = "cxa_" + secrets.token_urlsafe(32)
        self.db.run("INSERT INTO admin_keys (tenant_id, key_hash, label, created_at) VALUES (?,?,?,?)", tenant_id, sha256(key), label, iso(self.now()))
        return key

    def verify(self, key) -> str | None:
        """The tenant id the key belongs to, or None for anything malformed, unknown or revoked."""
        if not isinstance(key, str) or not _KEY.match(key):
            return None
        row = self.db.get("SELECT tenant_id FROM admin_keys WHERE key_hash = ? AND revoked_at IS NULL", sha256(key))
        return row["tenant_id"] if row else None

    def revoke_by_label(self, tenant_id: str, label: str) -> int:
        return self.db.run("UPDATE admin_keys SET revoked_at = ? WHERE tenant_id = ? AND label = ? AND revoked_at IS NULL", iso(self.now()), tenant_id, label)
