"""SYNTHETIC, ILLUSTRATIVE DATA ONLY. Tenant, clinic and provider names are invented and do not describe real organisations, people or addresses."""


def synthetic_catalog() -> dict:
    def tenant(id, slug, name, color, analytics=True, status="active"):
        return {"id": id, "slug": slug, "status": status, "analytics_enabled": analytics, "display_name": name, "primary_color": color, "support_email": f"help@{slug}.example"}

    def clinic(id, tenant_id, state, name, city, tz, **extra):
        return {"id": id, "tenant_id": tenant_id, "state_code": state, "name": name, "city": city, "address": f"1 Example Way, {city}", "time_zone": tz, "status": "active", "bookable": True, **extra}

    def svc(id, tenant_id, canonical, label, **extra):
        return {"id": id, "tenant_id": tenant_id, "canonical_type": canonical, "label": label, "description": f"{label} visit", "status": "active", **extra}

    def prov(id, tenant_id, name, status="active"):
        return {"id": id, "tenant_id": tenant_id, "display_name": name, "status": status}

    availability = []
    for wd in (1, 2, 3, 4, 5):
        availability += [
            {"tenant_id": "tn-north", "provider_id": "pr-a", "clinic_id": "cl-sb", "weekday": wd, "start_minute": 9 * 60, "end_minute": 12 * 60},
            {"tenant_id": "tn-north", "provider_id": "pr-a", "clinic_id": "cl-sb", "weekday": wd, "start_minute": 13 * 60, "end_minute": 17 * 60},
            {"tenant_id": "tn-north", "provider_id": "pr-b", "clinic_id": "cl-sb", "weekday": wd, "start_minute": 8 * 60, "end_minute": 12 * 60},
            {"tenant_id": "tn-bay", "provider_id": "pr-z", "clinic_id": "cl-oak", "weekday": wd, "start_minute": 9 * 60, "end_minute": 17 * 60},
        ]
    for wd in (2, 4):
        availability.append({"tenant_id": "tn-north", "provider_id": "pr-c", "clinic_id": "cl-au", "weekday": wd, "start_minute": 10 * 60, "end_minute": 14 * 60})
    return {
        # The synthetic catalog predates clinical intake; tests that exercise intake switch it on explicitly.
        "tenant_settings": [{"tenant_id": t, "intake_required": False} for t in ("tn-north", "tn-bay", "tn-off")],
        "tenants": [tenant("tn-north", "northwind-health", "Northwind Health (synthetic)", "#1b6fb5"),
                    tenant("tn-bay", "bayview-care", "Bayview Care (synthetic)", "#0a7d5a", False),
                    tenant("tn-off", "dormant-clinic", "Dormant (synthetic)", "#999999", status="suspended")],
        "clinics": [clinic("cl-sb", "tn-north", "CA", "San Bernardo Clinic", "San Bernardo", "America/Los_Angeles"),
                    clinic("cl-fr", "tn-north", "CA", "Fresno Closed Clinic", "Fresno", "America/Los_Angeles", status="inactive"),
                    clinic("cl-au", "tn-north", "TX", "Austin Clinic", "Austin", "America/Chicago"),
                    clinic("cl-nb", "tn-north", "NY", "Not Bookable Clinic", "Albany", "America/New_York", bookable=False),
                    clinic("cl-oak", "tn-bay", "CA", "Oakland Clinic", "Oakland", "America/Los_Angeles")],
        "services": [svc("sv-physio-n", "tn-north", "physio", "Physio", duration_min=45), svc("sv-pc-n", "tn-north", "primary_care", "Primary Care"),
                     svc("sv-vision-n", "tn-north", "vision_care", "Vision Care"), svc("sv-coach-n", "tn-north", "health_coach", "Health Coach"),
                     svc("sv-fit-n", "tn-north", "fitness", "Fitness"), svc("sv-pc-b", "tn-bay", "primary_care", "Primary Care")],
        "providers": [prov("pr-a", "tn-north", "Dr. Alex Example"), prov("pr-b", "tn-north", "Sam Sample, PT"), prov("pr-gone", "tn-north", "Retired Provider", "inactive"),
                      prov("pr-c", "tn-north", "Dr. Casey Placeholder"), prov("pr-z", "tn-bay", "Dr. Zed Example")],
        "clinic_services": [
            {"tenant_id": "tn-north", "clinic_id": "cl-sb", "service_id": "sv-physio-n", "active": True},
            {"tenant_id": "tn-north", "clinic_id": "cl-sb", "service_id": "sv-pc-n", "active": True},
            {"tenant_id": "tn-north", "clinic_id": "cl-sb", "service_id": "sv-vision-n", "active": False},   # configured but switched off
            {"tenant_id": "tn-north", "clinic_id": "cl-au", "service_id": "sv-pc-n", "active": True},
            {"tenant_id": "tn-north", "clinic_id": "cl-au", "service_id": "sv-coach-n", "active": True},
            {"tenant_id": "tn-bay", "clinic_id": "cl-oak", "service_id": "sv-pc-b", "active": True}],
        "availability": availability,
        "time_off": [],
        "employers": [{"id": "em-n-1", "tenant_id": "tn-north", "name": "Acme Logistics (demo)"}, {"id": "em-n-2", "tenant_id": "tn-north", "name": "Globex Manufacturing (demo)"},
                      {"id": "em-n-3", "tenant_id": "tn-north", "name": "Initech Software (demo)"}, {"id": "em-n-4", "tenant_id": "tn-north", "name": "Umbrella Retail Group (demo)"},
                      {"id": "em-b-1", "tenant_id": "tn-bay", "name": "Bayside Shipping (demo)"}, {"id": "em-b-2", "tenant_id": "tn-bay", "name": "Harbor Foods (demo)"}],
        "insurers": [{"id": "in-n-1", "tenant_id": "tn-north", "name": "Example Health Plan (demo)"}, {"id": "in-n-2", "tenant_id": "tn-north", "name": "Sample Mutual Insurance (demo)"},
                     {"id": "in-n-3", "tenant_id": "tn-north", "name": "Placeholder Blue Network (demo)"}, {"id": "in-b-1", "tenant_id": "tn-bay", "name": "Bay Example Assurance (demo)"}],
        "eligibility": [
            {"tenant_id": "tn-north", "clinic_id": "cl-sb", "service_id": "sv-physio-n", "provider_id": "pr-b", "active": True},
            {"tenant_id": "tn-north", "clinic_id": "cl-sb", "service_id": "sv-pc-n", "provider_id": "pr-a", "active": True},
            {"tenant_id": "tn-north", "clinic_id": "cl-sb", "service_id": "sv-pc-n", "provider_id": "pr-gone", "active": True},
            {"tenant_id": "tn-north", "clinic_id": "cl-au", "service_id": "sv-pc-n", "provider_id": "pr-c", "active": True},
            {"tenant_id": "tn-bay", "clinic_id": "cl-oak", "service_id": "sv-pc-b", "provider_id": "pr-z", "active": True}],
    }
