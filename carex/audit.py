"""Append-only record of who did what to which record (HIPAA-style access trail). Never stores passwords, tokens, codes, free-text clinical
content or raw IP addresses (a short hash lets an investigator correlate requests without keeping the address)."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Callable

from .util import iso, now as _now, sha256

log = logging.getLogger("carex.audit")


class AuditWriteError(RuntimeError):
    """Raised when a required audit event cannot be persisted."""



class Audit:
    def __init__(self, db, clock: Callable[[], datetime] = _now):
        self.db, self.now = db, clock

    # Detail is deliberately event-specific. Clinical/free text and arbitrary caller data are never accepted.
    DETAIL_FIELDS = {
        "export.fhir": {"count": int},
        "user.login_failed": {"identifier_hash": str},
        "staff.login_failed": {"identifier_hash": str},
        "schedule.view": {"date": str, "count": int},
        "appointment.status": {"status": str},
        "schedule.closure_add": {"affected": int},
        "export.csv": {"from": str, "to": str, "count": int},
        "calendar.view": {"date": str, "count": int},
        "waitlist.view": {"count": int},
        "setup.import_check": {"created": int, "skipped": int, "errors": int},
        "setup.import_clinics": {"created": int, "skipped": int, "errors": int},
    }

    def record(self, tenant_id: str, actor_type: str, action: str, actor_id: str | None = None, target_type: str | None = None,
               target_id: str | None = None, ip: str | None = None, detail: dict | None = None, db=None) -> None:
        if actor_type not in {"user", "staff", "admin", "system", "anonymous"}:
            raise ValueError("Unsupported audit actor type")
        safe_detail = None
        if detail is not None:
            schema = self.DETAIL_FIELDS.get(action)
            if schema is None or not isinstance(detail, dict) or set(detail) != set(schema):
                raise ValueError("Audit detail is not allowed for this event")
            for key, expected in schema.items():
                value = detail[key]
                if expected is int and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
                    raise ValueError("Invalid audit detail value")
                if expected is str and (not isinstance(value, str) or len(value) > 32 or any(ord(ch) < 32 for ch in value)):
                    raise ValueError("Invalid audit detail value")
            if "identifier_hash" in detail and (len(detail["identifier_hash"]) != 12 or any(ch not in "0123456789abcdef" for ch in detail["identifier_hash"])):
                raise ValueError("Invalid audit identifier hash")
            if "date" in detail and not __import__("re").fullmatch(r"\d{4}-\d{2}-\d{2}", detail["date"]):
                raise ValueError("Invalid audit date")
            if "status" in detail and detail["status"] not in {"confirmed", "arrived", "completed", "no_show", "cancelled"}:
                raise ValueError("Invalid appointment status")
            safe_detail = json.dumps(detail, separators=(",", ":"), allow_nan=False)
            if len(safe_detail.encode("utf-8")) > 256:
                raise ValueError("Audit detail exceeds the event schema limit")
        # Pass the active transaction connection for events coupled to a state mutation.
        target_db = db or self.db
        try:
            target_db.run("INSERT INTO audit_log (tenant_id, at, actor_type, actor_id, action, target_type, target_id, ip_hash, detail) VALUES (?,?,?,?,?,?,?,?,?)",
                          tenant_id, iso(self.now()), actor_type, actor_id, action, target_type, target_id, sha256(ip)[:16] if ip else None, safe_detail)
        except Exception as e:
            log.error("audit_write_failed action=%s error=%s", action, type(e).__name__)
            raise AuditWriteError("Required audit event could not be persisted") from e

    def list(self, tenant_id: str, limit: int = 100, before: int | None = None, actor_id: str | None = None, target_id: str | None = None, action: str | None = None) -> list[dict]:
        where, p = ["tenant_id = ?"], [tenant_id]
        if before:
            where.append("id < ?"); p.append(before)
        if actor_id:
            where.append("actor_id = ?"); p.append(actor_id)
        if target_id:
            where.append("target_id = ?"); p.append(target_id)
        if action:
            where.append("action = ?"); p.append(action)
        return self.db.all(f"SELECT id, at, actor_type, actor_id, action, target_type, target_id, detail FROM audit_log WHERE {' AND '.join(where)} ORDER BY id DESC LIMIT ?", *p, min(limit, 500))
