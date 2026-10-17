"""Privacy-safe funnel events: a name and an optional clinic/visit reference. No user id, no IP, no free text."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Callable

from .util import iso, now as _now

log = logging.getLogger("carex.events")
NAMES = {"search", "find", "clinic_viewed", "visit_chosen", "details_opened", "booked", "cancelled", "rescheduled", "waitlist_joined", "signup", "manage_link"}


class Events:
    def __init__(self, db, clock: Callable[[], datetime] = _now):
        self.db, self.now = db, clock

    def log(self, tenant_id: str, name: str, ref: str = "") -> None:
        if name not in NAMES:
            return
        try:
            self.db.run("INSERT INTO events (tenant_id, at, name, ref) VALUES (?,?,?,?)", tenant_id, iso(self.now()), name, (ref or "")[:60] or None)
        except Exception as e:           # analytics must never break booking
            log.error("event_write_failed name=%s error=%s", name, type(e).__name__)

    def counts(self, tenant_id: str, since_iso: str) -> dict[str, int]:
        return {r["name"]: r["n"] for r in self.db.all("SELECT name, COUNT(*) AS n FROM events WHERE tenant_id = ? AND at >= ? GROUP BY name", tenant_id, since_iso)}
