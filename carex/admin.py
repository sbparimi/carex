"""Tenant-scoped configuration changes (ADR-004). Every statement filters on tenant_id; a row of another tenant is indistinguishable from a missing one."""
from __future__ import annotations

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
    def __init__(self, db, clock: Callable[[], datetime] = _now):
        self.db, self.now = db, clock

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
    def update_brand(self, tenant_id: str, patch: dict) -> dict:
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
        if sets:
            self.db.run(f"UPDATE tenants SET {', '.join(sets)} WHERE id = ?", *args, tenant_id)
        r = self.db.get("SELECT display_name, primary_color, logo_url, support_email, support_phone FROM tenants WHERE id = ?", tenant_id)
        return {k: v for k, v in r.items() if v is not None}

    def set_analytics(self, tenant_id: str, enabled: bool) -> None:
        self._tenant(tenant_id)
        self.db.run("UPDATE tenants SET analytics_enabled = ? WHERE id = ?", 1 if enabled else 0, tenant_id)

    # ---- clinics
    def list_clinics(self, tenant_id: str) -> list[dict]:
        self._tenant(tenant_id)
        return [{**r, "bookable": r["bookable"] == 1} for r in self.db.all("SELECT id, name, city, address, state_code, time_zone, status, bookable FROM clinics WHERE tenant_id = ? ORDER BY name, id", tenant_id)]

    def create_clinic(self, tenant_id: str, c: dict) -> dict:
        """New clinics start inactive and not bookable: nothing becomes visible to patients until an admin activates it."""
        self._tenant(tenant_id)
        name, city, addr = _text(c.get("name"), "name"), _text(c.get("city"), "city"), _text(c.get("address"), "address", 200)
        if not re.fullmatch(r"[A-Z]{2}", str(c.get("state_code"))):
            _bad("state_code must be two capital letters")
        tz = _tz(c.get("time_zone"))
        cid = "cl-" + secrets.token_hex(5)
        self.db.run("INSERT INTO clinics (id, tenant_id, name, city, address, state_code, time_zone, status, bookable) VALUES (?,?,?,?,?,?,?,'inactive',0)", cid, tenant_id, name, city, addr, c["state_code"], tz)
        return {"id": cid, "name": name, "city": city, "address": addr, "state_code": c["state_code"], "time_zone": tz, "status": "inactive", "bookable": False}

    def update_clinic(self, tenant_id: str, clinic_id: str, p: dict) -> dict:
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
        if sets:
            self.db.run(f"UPDATE clinics SET {', '.join(sets)} WHERE tenant_id = ? AND id = ?", *args, tenant_id, clinic_id)
        clinic = next(c for c in self.list_clinics(tenant_id) if c["id"] == clinic_id)
        n = self.db.get("SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND clinic_id = ? AND status = 'confirmed' AND starts_at > ?", tenant_id, clinic_id, iso(self.now()))
        return {**clinic, "affected_future_appointments": int(n["n"])}

    def update_clinic_details(self, tenant_id: str, clinic_id: str, p: dict) -> None:
        """What patients see on the clinic page: phone, opening hours, a short note (parking, access) and an optional https photo."""
        self._clinic(tenant_id, clinic_id)
        phone, hours, about, img = ((p.get(k) or "").strip() for k in ("phone", "hours_text", "about", "image_url"))
        if phone and not re.fullmatch(r"[0-9+()\-. ]{5,30}", phone):
            _bad("phone is invalid")
        if len(hours) > 200 or len(about) > 400:
            _bad("hours or notes are too long")
        if img and not re.fullmatch(r"https://\S{1,500}", img):
            _bad("photo must be an https URL")
        self.db.run("UPDATE clinics SET phone = ?, hours_text = ?, about = ?, image_url = ? WHERE tenant_id = ? AND id = ?", phone or None, hours or None, about or None, img or None, tenant_id, clinic_id)

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

    def set_availability(self, tenant_id: str, provider_id: str, clinic_id: str, rules: list[dict]) -> None:
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

    def add_time_off(self, tenant_id: str, provider_id: str, starts_at: str, ends_at: str) -> int:
        self._provider(tenant_id, provider_id)
        s, e = _instant(starts_at), _instant(ends_at)
        if e <= s:
            _bad("time off must end after it starts")
        r = self.db.get("INSERT INTO time_off (tenant_id, provider_id, starts_at, ends_at) VALUES (?,?,?,?) RETURNING id", tenant_id, provider_id, iso(s), iso(e))
        return int(r["id"])

    def remove_time_off(self, tenant_id: str, id_: int) -> None:
        if self.db.run("DELETE FROM time_off WHERE tenant_id = ? AND id = ?", tenant_id, id_) == 0:
            raise AdminNotFoundError()

    def list_time_off(self, tenant_id: str, provider_id: str) -> list[dict]:
        self._provider(tenant_id, provider_id)
        return self.db.all("SELECT id, starts_at, ends_at FROM time_off WHERE tenant_id = ? AND provider_id = ? AND ends_at > ? ORDER BY starts_at", tenant_id, provider_id, iso(self.now()))

    def add_closure(self, tenant_id: str, clinic_id: str, starts_at: str, ends_at: str, reason: str = "") -> dict:
        """Closes a clinic for a period: no provider is bookable there in that window. Existing appointments are untouched; staff move them."""
        self._clinic(tenant_id, clinic_id)
        s, e = _instant(starts_at), _instant(ends_at)
        if e <= s:
            _bad("a closure must end after it starts")
        r = self.db.get("INSERT INTO clinic_closures (tenant_id, clinic_id, starts_at, ends_at, reason) VALUES (?,?,?,?,?) RETURNING id", tenant_id, clinic_id, iso(s), iso(e), str(reason or "")[:120])
        n = self.db.get("SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND clinic_id = ? AND status = 'confirmed' AND starts_at < ? AND ends_at > ?", tenant_id, clinic_id, iso(e), iso(s))
        return {"id": int(r["id"]), "affected_appointments": int(n["n"])}

    def list_closures(self, tenant_id: str, clinic_id: str) -> list[dict]:
        self._clinic(tenant_id, clinic_id)
        return self.db.all("SELECT id, starts_at, ends_at, reason FROM clinic_closures WHERE tenant_id = ? AND clinic_id = ? AND ends_at > ? ORDER BY starts_at", tenant_id, clinic_id, iso(self.now()))

    def remove_closure(self, tenant_id: str, id_: int) -> None:
        if self.db.run("DELETE FROM clinic_closures WHERE tenant_id = ? AND id = ?", tenant_id, id_) == 0:
            raise AdminNotFoundError()


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
