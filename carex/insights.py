"""Numbers for the practice: how many visits happen, are missed or cancelled, how far ahead people book, how full the calendar is, and where people drop off.
Everything is counts and rates; nothing here identifies a patient."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Callable

from .util import iso, ms, now as _now, parse


def _pct(a: int, b: int) -> int:
    return round(100 * a / b) if b else 0


class Insights:
    def __init__(self, db, sched, clock: Callable[[], datetime] = _now):
        self.db, self.sched, self.now = db, sched, clock

    def summary(self, tenant_id: str, days: int = 30, clinic_id: str | None = None) -> dict:
        end = self.now()
        start = end - timedelta(days=days)
        cl, cp = (" AND clinic_id = ?", [clinic_id]) if clinic_id else ("", [])
        rows = self.db.all(f"SELECT status, created_at, starts_at FROM appointments WHERE tenant_id = ? AND starts_at >= ? AND starts_at < ?{cl}", tenant_id, iso(start), iso(end), *cp)
        by = {k: 0 for k in ("confirmed", "arrived", "completed", "no_show", "cancelled")}
        for r in rows:
            by[r["status"]] += 1
        seen = by["completed"] + by["arrived"] + by["no_show"]
        leads = [ms(parse(r["starts_at"])) - ms(parse(r["created_at"])) for r in rows if r["status"] != "cancelled" and r["created_at"]]
        lead_days = round(sum(leads) / len(leads) / 86_400_000, 1) if leads else 0.0
        up = self.db.get(f"SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND status = 'confirmed' AND starts_at >= ? AND starts_at < ?{cl}", tenant_id, iso(end), iso(end + timedelta(days=14)), *cp)
        booked_up = int(up["n"])
        open_slots = 0
        if clinic_id:
            for v in self._visits(tenant_id, clinic_id):
                for p in self._providers(tenant_id, clinic_id, v):
                    open_slots += len(self.sched.list_slots(tenant_id, clinic_id, v, p))
        funnel = {r["name"]: r["n"] for r in self.db.all("SELECT name, COUNT(*) AS n FROM events WHERE tenant_id = ? AND at >= ? GROUP BY name", tenant_id, iso(start))}
        steps = [("Looked for care", max(funnel.get("search", 0), funnel.get("find", 0), funnel.get("clinic_viewed", 0))), ("Chose a visit type", funnel.get("visit_chosen", 0)),
                 ("Opened the details step", funnel.get("details_opened", 0)), ("Booked", funnel.get("booked", 0))]
        top = max([n for _, n in steps] + [1])
        return {"days": days, "total": len(rows), "by_status": by, "no_show_rate": _pct(by["no_show"], seen), "cancel_rate": _pct(by["cancelled"], len(rows)), "lead_days": lead_days,
                "upcoming_booked": booked_up, "open_slots": open_slots, "utilisation": _pct(booked_up, booked_up + open_slots) if clinic_id else None,
                "funnel": [{"label": l, "n": n, "pct_of_top": _pct(n, top)} for l, n in steps], "booked_rate": _pct(funnel.get("booked", 0), steps[0][1])}

    def _visits(self, tenant_id, clinic_id):
        return [r["visit_type_id"] for r in self.db.all("SELECT visit_type_id FROM clinic_visit_types WHERE tenant_id = ? AND clinic_id = ? AND active = 1", tenant_id, clinic_id)]

    def _providers(self, tenant_id, clinic_id, visit_id):
        return [r["provider_id"] for r in self.db.all("SELECT provider_id FROM provider_eligibility WHERE tenant_id = ? AND clinic_id = ? AND visit_type_id = ? AND active = 1", tenant_id, clinic_id, visit_id)]

    def waitlist(self, tenant_id: str, clinic_id: str | None = None, limit: int = 200) -> list[dict]:
        cl, cp = (" AND w.clinic_id = ?", [clinic_id]) if clinic_id else ("", [])
        return self.db.all(f"""SELECT w.id, w.status, w.created_at, c.name AS clinic_name, c.id AS clinic_id, v.label AS visit_label, p.display_name AS provider_name, u.first_name, u.last_name
                                 FROM waitlist w JOIN clinics c ON c.id = w.clinic_id JOIN visit_types v ON v.id = w.visit_type_id LEFT JOIN providers p ON p.id = w.provider_id
                                 JOIN users u ON u.id = w.user_id
                                WHERE w.tenant_id = ? AND w.status IN ('active','notified'){cl} ORDER BY w.created_at, w.id LIMIT ?""", tenant_id, *cp, limit)

    def remove_waitlist(self, tenant_id: str, wid: int) -> bool:
        return self.db.run("UPDATE waitlist SET status = 'cancelled' WHERE tenant_id = ? AND id = ? AND status IN ('active','notified')", tenant_id, wid) > 0
