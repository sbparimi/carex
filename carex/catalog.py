"""Catalog reads (states, clinics, visit types, providers) and loading catalog data. Every query is tenant-scoped and parameterised."""
from __future__ import annotations

import json
from typing import Any

from .db import Conn

ACTIVE_CLINIC = "c.tenant_id = ? AND c.status = 'active' AND c.bookable = 1"
CLINIC_COLS = "c.id, c.name, c.city, c.address, c.state_code, c.time_zone"
VISIT_COLS = "v.id, v.canonical_type, v.label, v.description, v.duration_min, v.modality, v.requires_referral, v.min_age, v.max_age"
PROV_COLS = "p.id, p.display_name, p.specialty, p.languages, p.accepting_new, p.bio"


def _clinic(r: dict) -> dict:
    return {"id": r["id"], "name": r["name"], "city": r["city"], "address": r["address"], "state_code": r["state_code"], "time_zone": r["time_zone"]}


def _visit(r: dict) -> dict:
    return {"id": r["id"], "canonical_type": r["canonical_type"], "label": r["label"], "description": r["description"], "duration_min": r["duration_min"],
            "modality": r["modality"], "requires_referral": bool(r["requires_referral"]), "min_age": r["min_age"], "max_age": r["max_age"]}


def _provider(r: dict) -> dict:
    return {"id": r["id"], "display_name": r["display_name"], "specialty": r["specialty"] or "", "languages": json.loads(r["languages"] or "[]"),
            "accepting_new": bool(r["accepting_new"]), "bio": r["bio"] or ""}


class Catalog:
    def __init__(self, db: Conn):
        self.db = db

    def tenant_by_slug(self, slug: str) -> dict | None:
        r = self.db.get("SELECT id, slug, status, display_name, primary_color, logo_url, support_email, support_phone, analytics_enabled FROM tenants WHERE slug = ? AND status = 'active'", slug)
        if not r:
            return None
        return {"id": r["id"], "slug": r["slug"], "brand": {"display_name": r["display_name"], "primary_color": r["primary_color"], "logo_url": r["logo_url"],
                                                           "support_email": r["support_email"], "support_phone": r["support_phone"]}}

    def states(self, tenant_id: str) -> list[str]:
        return [r["state_code"] for r in self.db.all(f"SELECT DISTINCT c.state_code FROM clinics c WHERE {ACTIVE_CLINIC} ORDER BY c.state_code", tenant_id)]

    def clinics(self, tenant_id: str, state_code: str) -> list[dict]:
        return [_clinic(r) for r in self.db.all(f"SELECT {CLINIC_COLS} FROM clinics c WHERE {ACTIVE_CLINIC} AND c.state_code = ? ORDER BY c.name, c.id", tenant_id, state_code)]

    def clinic(self, tenant_id: str, clinic_id: str) -> dict | None:
        r = self.db.get(f"SELECT {CLINIC_COLS} FROM clinics c WHERE {ACTIVE_CLINIC} AND c.id = ?", tenant_id, clinic_id)
        return _clinic(r) if r else None

    def visit_types(self, tenant_id: str, clinic_id: str) -> list[dict]:
        rows = self.db.all(
            f"""SELECT {VISIT_COLS} FROM clinics c
                 JOIN clinic_visit_types cv ON cv.clinic_id = c.id AND cv.tenant_id = c.tenant_id AND cv.active = 1
                 JOIN visit_types v ON v.id = cv.visit_type_id AND v.tenant_id = c.tenant_id AND v.status = 'active'
                WHERE {ACTIVE_CLINIC} AND c.id = ? ORDER BY v.label, v.id""", tenant_id, clinic_id)
        return [_visit(r) for r in rows]

    def providers(self, tenant_id: str, clinic_id: str, service_id: str) -> list[dict]:
        rows = self.db.all(
            f"""SELECT {PROV_COLS} FROM clinics c
                 JOIN clinic_visit_types cv ON cv.clinic_id = c.id AND cv.tenant_id = c.tenant_id AND cv.visit_type_id = ? AND cv.active = 1
                 JOIN visit_types v ON v.id = cv.visit_type_id AND v.tenant_id = c.tenant_id AND v.status = 'active'
                 JOIN provider_eligibility e ON e.clinic_id = c.id AND e.visit_type_id = v.id AND e.tenant_id = c.tenant_id AND e.active = 1
                 JOIN providers p ON p.id = e.provider_id AND p.tenant_id = c.tenant_id AND p.status = 'active'
                WHERE {ACTIVE_CLINIC} AND c.id = ? ORDER BY p.display_name, p.id""", service_id, tenant_id, clinic_id)
        return [_provider(r) for r in rows]

    def eligible(self, tenant_id: str, clinic_id: str, service_id: str, provider_id: str) -> dict | None:
        c = self.clinic(tenant_id, clinic_id)
        v = next((x for x in self.visit_types(tenant_id, clinic_id) if x["id"] == service_id), None)
        p = next((x for x in self.providers(tenant_id, clinic_id, service_id) if x["id"] == provider_id), None)
        return {"clinic": c, "visit_type": v, "provider": p} if c and v and p else None

    def describe(self, tenant_id: str, clinic_id: str, service_id: str, provider_id: str) -> dict | None:
        """Names for an EXISTING booking: ignores active/bookable flags so a later deactivation never hides a patient's appointment."""
        c = self.db.get(f"SELECT {CLINIC_COLS} FROM clinics c WHERE c.tenant_id = ? AND c.id = ?", tenant_id, clinic_id)
        v = self.db.get(f"SELECT {VISIT_COLS} FROM visit_types v WHERE v.tenant_id = ? AND v.id = ?", tenant_id, service_id)
        p = self.db.get(f"SELECT {PROV_COLS} FROM providers p WHERE p.tenant_id = ? AND p.id = ?", tenant_id, provider_id)
        return {"clinic": _clinic(c), "visit_type": _visit(v), "provider": _provider(p)} if c and v and p else None


def _b(v: Any) -> int:
    return 1 if v else 0


def seed_db(db, d: dict) -> None:
    """Load catalog data (the synthetic seed, the demo seed, or an admin import). `d` uses snake_case keys; every list is optional."""
    with db.tx() as t:
        for x in d.get("tenants", []):
            t.run("INSERT INTO tenants (id, slug, status, display_name, primary_color, logo_url, support_email, support_phone, analytics_enabled) VALUES (?,?,?,?,?,?,?,?,?)",
                  x["id"], x["slug"], x.get("status", "active"), x["display_name"], x["primary_color"], x.get("logo_url"), x.get("support_email"), x.get("support_phone"), _b(x.get("analytics_enabled", True)))
        for c in d.get("clinics", []):
            t.run("INSERT INTO clinics (id, tenant_id, name, city, address, state_code, time_zone, status, bookable) VALUES (?,?,?,?,?,?,?,?,?)",
                  c["id"], c["tenant_id"], c["name"], c["city"], c["address"], c["state_code"], c["time_zone"], c.get("status", "active"), _b(c.get("bookable", True)))
        for s in d.get("services", []):
            t.run("INSERT INTO visit_types (id, tenant_id, canonical_type, label, description, duration_min, status) VALUES (?,?,?,?,?,?,?)",
                  s["id"], s["tenant_id"], s["canonical_type"], s["label"], s.get("description", f"{s['label']} visit"), s.get("duration_min", 30), s.get("status", "active"))
        for x in d.get("clinic_services", []):
            t.run("INSERT INTO clinic_visit_types (tenant_id, clinic_id, visit_type_id, active) VALUES (?,?,?,?)", x["tenant_id"], x["clinic_id"], x["service_id"], _b(x.get("active", True)))
        for p in d.get("providers", []):
            t.run("INSERT INTO providers (id, tenant_id, display_name, status) VALUES (?,?,?,?)", p["id"], p["tenant_id"], p["display_name"], p.get("status", "active"))
        for e in d.get("eligibility", []):
            t.run("INSERT INTO provider_eligibility (tenant_id, clinic_id, visit_type_id, provider_id, active) VALUES (?,?,?,?,?)", e["tenant_id"], e["clinic_id"], e["service_id"], e["provider_id"], _b(e.get("active", True)))
        for a in d.get("availability", []):
            t.run("INSERT INTO availability_rules (tenant_id, provider_id, clinic_id, weekday, start_minute, end_minute) VALUES (?,?,?,?,?,?)", a["tenant_id"], a["provider_id"], a["clinic_id"], a["weekday"], a["start_minute"], a["end_minute"])
        for o in d.get("time_off", []):
            t.run("INSERT INTO time_off (tenant_id, provider_id, starts_at, ends_at) VALUES (?,?,?,?)", o["tenant_id"], o["provider_id"], o["starts_at"], o["ends_at"])
        for e in d.get("employers", []):
            t.run("INSERT INTO employers (id, tenant_id, name) VALUES (?,?,?)", e["id"], e["tenant_id"], e["name"])
        for i in d.get("insurers", []):
            t.run("INSERT INTO insurers (id, tenant_id, name) VALUES (?,?,?)", i["id"], i["tenant_id"], i["name"])
        for r in d.get("rules", []):
            t.run("""UPDATE visit_types SET min_lead_minutes = ?, horizon_days = ?, buffer_before_min = ?, buffer_after_min = ?, min_age = ?, max_age = ?, new_patients = ?, modality = ?,
                       requires_referral = ?, resource_kind = ? WHERE tenant_id = ? AND id = ?""",
                  r.get("min_lead_minutes"), r.get("horizon_days"), r.get("buffer_before_min", 0), r.get("buffer_after_min", 0), r.get("min_age"), r.get("max_age"),
                  r.get("new_patients", "any"), r.get("modality", "in_person"), _b(r.get("requires_referral")), r.get("resource_kind"), r["tenant_id"], r["service_id"])
        for r in d.get("resources", []):
            t.run("INSERT INTO clinic_resources (id, tenant_id, clinic_id, kind, name) VALUES (?,?,?,?,?)", r["id"], r["tenant_id"], r["clinic_id"], r["kind"], r["name"])
        for c in d.get("closures", []):
            t.run("INSERT INTO clinic_closures (tenant_id, clinic_id, starts_at, ends_at, reason) VALUES (?,?,?,?,?)", c["tenant_id"], c["clinic_id"], c["starts_at"], c["ends_at"], c.get("reason", ""))
        for p in d.get("profiles", []):
            t.run("UPDATE providers SET specialty = ?, languages = ?, licensed_states = ?, accepting_new = ?, bio = ? WHERE tenant_id = ? AND id = ?",
                  p.get("specialty", ""), json.dumps(p.get("languages", [])), json.dumps(p.get("licensed_states", [])), _b(p.get("accepting_new", True)), p.get("bio", ""), p["tenant_id"], p["provider_id"])
        for s in d.get("tenant_settings", []):
            t.run("UPDATE tenants SET intake_required = ?, video_join_base_url = ?, consent_version = ? WHERE id = ?",
                  _b(s.get("intake_required", True)), s.get("video_join_base_url"), s.get("consent_version", "v1"), s["tenant_id"])
        for r in d.get("employer_rules", []):
            t.run("UPDATE employers SET verification = ?, email_domain = ? WHERE tenant_id = ? AND id = ?", r["verification"], (r.get("email_domain") or "").lower() or None, r["tenant_id"], r["employer_id"])
            for e in r.get("roster", []):
                t.run("INSERT INTO employer_roster (tenant_id, employer_id, email) VALUES (?,?,?)", r["tenant_id"], r["employer_id"], e.lower())
        for n in d.get("networks", []):
            t.run("INSERT INTO insurer_networks (tenant_id, insurer_id, clinic_id) VALUES (?,?,?)", n["tenant_id"], n["insurer_id"], n["clinic_id"])
        for c in d.get("coverage", []):
            t.run("INSERT INTO coverage_rules (tenant_id, visit_type_id, employer_id, insurer_id, covered, copay_cents) VALUES (?,?,?,?,?,?)",
                  c["tenant_id"], c["service_id"], c.get("employer_id"), c.get("insurer_id"), _b(c.get("covered", True)), c.get("copay_cents", 0))
