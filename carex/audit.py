"""Append-only record of who did what to which record (HIPAA-style access trail). Never stores passwords, tokens, codes, free-text clinical
content or raw IP addresses (a short hash lets an investigator correlate requests without keeping the address)."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Callable

from .util import iso, now as _now, sha256

log = logging.getLogger("carex.audit")


class Audit:
    def __init__(self, db, clock: Callable[[], datetime] = _now):
        self.db, self.now = db, clock

    def record(self, tenant_id: str, actor_type: str, action: str, actor_id: str | None = None, target_type: str | None = None,
               target_id: str | None = None, ip: str | None = None, detail: dict | None = None) -> None:
        try:
            self.db.run("INSERT INTO audit_log (tenant_id, at, actor_type, actor_id, action, target_type, target_id, ip_hash, detail) VALUES (?,?,?,?,?,?,?,?,?)",
                        tenant_id, iso(self.now()), actor_type, actor_id, action, target_type, target_id, sha256(ip)[:16] if ip else None,
                        json.dumps(detail)[:1000] if detail else None)
        except Exception as e:                      # an audit failure must be visible to operators; it must not leak into the patient's response
            log.error("audit_write_failed action=%s error=%s", action, type(e).__name__)

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
