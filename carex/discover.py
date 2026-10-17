"""Finding care: the soonest opening for a visit type at a clinic, and clinics ranked by how soon a kind of visit can be had.
Answers are cached for a few seconds (CAREX_SOONEST_TTL) because the same clinic page is read far more often than bookings change; booking itself always re-checks."""
from __future__ import annotations

import time
from typing import Callable

from .fmt import clock, day_parts


class Discover:
    def __init__(self, catalog, booking, ttl: float = 15.0, monotonic: Callable[[], float] = time.monotonic):
        self.catalog, self.booking, self.ttl, self.mono = catalog, booking, ttl, monotonic
        self._cache: dict[tuple, tuple[float, dict | None]] = {}

    def soonest(self, tenant_id: str, clinic_id: str, visit_id: str, user_id: str | None = None) -> dict | None:
        key = (tenant_id, clinic_id, visit_id)
        hit = self._cache.get(key)
        if self.ttl > 0 and hit and self.mono() - hit[0] < self.ttl:
            return hit[1]
        best = None
        for pv in self.catalog.providers(tenant_id, clinic_id, visit_id):
            sl = self.booking.slots(tenant_id, clinic_id, visit_id, pv["id"], user_id)
            if sl and (best is None or sl[0]["starts_at"] < best["starts_at"]):
                best = {**day_parts(sl[0]["starts_at"], sl[0]["time_zone"]), "time": clock(sl[0]["starts_at"], sl[0]["time_zone"]), "starts_at": sl[0]["starts_at"],
                        "slot_id": sl[0]["id"], "provider_id": pv["id"], "provider_name": pv["display_name"]}
        if self.ttl > 0:
            if len(self._cache) > 5000:
                self._cache.clear()
            self._cache[key] = (self.mono(), best)
        return best

    def find(self, tenant_id: str, kind: str, state_code: str = "", q: str = "", limit: int = 12, user_id: str | None = None) -> list[dict]:
        """Clinics offering this kind of visit, soonest opening first. Searches at most 40 clinics so one request stays fast."""
        out = []
        for cl in self.catalog.search_clinics(tenant_id, q, state_code, 40):
            for v in self.catalog.visit_types(tenant_id, cl["id"]):
                if v["canonical_type"] != kind:
                    continue
                nxt = self.soonest(tenant_id, cl["id"], v["id"], user_id)
                out.append({"clinic": cl, "visit": v, "next": nxt})
                break
        out.sort(key=lambda r: (r["next"]["starts_at"] if r["next"] else "9", r["clinic"]["name"]))
        return out[:limit]
