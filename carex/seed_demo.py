"""SYNTHETIC DEMO DATA for local development and demos. Everything here is invented. Extends `synthetic_catalog()` (which the automated tests rely on and which
stays unchanged) with more clinics, visit types, providers, hours, employers and insurers; `seed_demo_people` adds demo accounts, appointments and staff logins."""
from __future__ import annotations

from datetime import datetime
from typing import Callable

from .accounts import Accounts
from .catalog import seed_db
from .scheduling import ReserveInput, Scheduling
from .demo_places import places
from .seed import synthetic_catalog
from .states import US_STATES
from .staff import StaffAccounts
from .util import now as _now

DEMO_PASSWORD = "Demo-Passw0rd-2026"
DEMO_PATIENTS = [
    {"tenant_id": "tn-north", "email": "alex.demo@example.test", "first": "Alex", "last": "Demo", "dob": "1988-03-14", "phone": "+1 415 555 0101", "door": ("employer", "em-n-1")},
    {"tenant_id": "tn-north", "email": "maria.demo@example.test", "first": "Maria", "last": "Sample", "dob": "1976-11-02", "phone": "+1 415 555 0102", "door": ("insurer", "in-n-1")},
    {"tenant_id": "tn-north", "email": "new.demo@example.test", "first": "Nia", "last": "Newcomer", "dob": "1995-07-30", "phone": "+1 415 555 0103", "door": ("employer", "em-n-5")},
    {"tenant_id": "tn-bay", "email": "sam.demo@example.test", "first": "Sam", "last": "Bayview", "dob": "1990-01-21", "phone": "+1 510 555 0104", "door": ("employer", "em-b-1")},
]
DEMO_STAFF = [
    {"tenant_id": "tn-north", "email": "frontdesk@northwind.example.test", "name": "Fran Frontdesk", "role": "front_desk"},
    {"tenant_id": "tn-north", "email": "dr.alex@northwind.example.test", "name": "Dr. Alex Example", "role": "provider", "provider_id": "pr-a"},
    {"tenant_id": "tn-north", "email": "admin@northwind.example.test", "name": "Avery Admin", "role": "admin"},
]


def demo_catalog() -> dict:
    base = synthetic_catalog()
    N, B = "tn-north", "tn-bay"

    def wk(tenant, provider, clinic, days, frm, to):
        return [{"tenant_id": tenant, "provider_id": provider, "clinic_id": clinic, "weekday": d, "start_minute": frm * 60, "end_minute": to * 60} for d in days]

    def named(prefix, tenant, names, start):
        return [{"id": f"{prefix}{start + i}", "tenant_id": tenant, "name": f"{n} (demo)"} for i, n in enumerate(names)]

    def clinic(id, tenant, state, name, city, tz):
        return {"id": id, "tenant_id": tenant, "state_code": state, "name": name, "city": city, "address": f"2 Example Way, {city}", "time_zone": tz, "status": "active", "bookable": True}

    def svc(id, tenant, canonical, label):
        return {"id": id, "tenant_id": tenant, "canonical_type": canonical, "label": label, "description": f"{label} visit", "status": "active"}

    def el(tenant, clinic_id, service, provider):
        return {"tenant_id": tenant, "clinic_id": clinic_id, "service_id": service, "provider_id": provider, "active": True}

    d = dict(base)
    d["clinics"] = base["clinics"] + [clinic("cl-sea", N, "WA", "Seattle Clinic", "Seattle", "America/Los_Angeles"), clinic("cl-den", N, "CO", "Denver Clinic", "Denver", "America/Denver"),
                                      clinic("cl-sj", B, "CA", "San Jose Clinic", "San Jose", "America/Los_Angeles")]
    d["services"] = base["services"] + [svc("sv-vision-b", B, "vision_care", "Vision Care"), svc("sv-coach-b", B, "health_coach", "Health Coach")]
    d["providers"] = base["providers"] + [{"id": i, "tenant_id": t, "display_name": n, "status": "active"} for i, t, n in (
        ("pr-d", N, "Dr. Dana Demo"), ("pr-e", N, "Riley Sample, OD"), ("pr-f", N, "Jordan Placeholder, Health Coach"), ("pr-g", N, "Dr. Morgan Example"),
        ("pr-y", B, "Dr. Yara Example"), ("pr-x", B, "Kai Sample, Health Coach"))]
    d["clinic_services"] = base["clinic_services"] + (
        [{"tenant_id": N, "clinic_id": "cl-sea", "service_id": s, "active": True} for s in ("sv-pc-n", "sv-vision-n", "sv-coach-n")]
        + [{"tenant_id": N, "clinic_id": "cl-den", "service_id": s, "active": True} for s in ("sv-pc-n", "sv-physio-n", "sv-fit-n")]
        + [{"tenant_id": B, "clinic_id": "cl-sj", "service_id": s, "active": True} for s in ("sv-pc-b", "sv-vision-b")]
        + [{"tenant_id": B, "clinic_id": "cl-oak", "service_id": "sv-coach-b", "active": True}])
    d["eligibility"] = base["eligibility"] + [el(N, "cl-sea", "sv-pc-n", "pr-d"), el(N, "cl-sea", "sv-vision-n", "pr-e"), el(N, "cl-sea", "sv-coach-n", "pr-f"), el(N, "cl-den", "sv-pc-n", "pr-g"),
                                              el(N, "cl-den", "sv-physio-n", "pr-b"), el(N, "cl-den", "sv-fit-n", "pr-f"), el(B, "cl-sj", "sv-pc-b", "pr-y"), el(B, "cl-sj", "sv-vision-b", "pr-y"),
                                              el(B, "cl-oak", "sv-coach-b", "pr-x")]
    d["availability"] = base["availability"] + (wk(N, "pr-d", "cl-sea", [1, 2, 3, 4, 5], 8, 16) + wk(N, "pr-e", "cl-sea", [2, 3, 4], 9, 17) + wk(N, "pr-f", "cl-sea", [1, 3, 5], 10, 15)
                                                 + wk(N, "pr-g", "cl-den", [1, 2, 3, 4, 5], 9, 17) + wk(N, "pr-b", "cl-den", [2, 4], 8, 12) + wk(N, "pr-f", "cl-den", [2, 4], 13, 17)
                                                 + wk(B, "pr-y", "cl-sj", [1, 2, 3, 4, 5], 9, 17) + wk(B, "pr-x", "cl-oak", [1, 3, 5], 10, 16))
    # Twenty locations in every state and territory (see demo_places): the headquarters location and four prominent ones carry every visit type so the colour coding shows;
    # the other locations carry primary care plus one rotating visit type. Clinics that already exist (Seattle, Denver, Austin ...) keep their ids and just take their place in the list.
    kinds = [("sv-pc-n", "Dr.", "Primary care", 8, 16), ("sv-physio-n", "", "Physiotherapy", 8, 15), ("sv-vision-n", "", "Vision care", 9, 17), ("sv-coach-n", "", "Health coaching", 10, 18), ("sv-fit-n", "", "Fitness", 7, 12)]
    suffix = {"sv-physio-n": ", PT", "sv-vision-n": ", OD", "sv-coach-n": ", Health Coach", "sv-fit-n": ", Trainer"}
    first = ["Avery", "Blake", "Casey", "Devon", "Emerson", "Finley", "Harper", "Jamie", "Kendall", "Logan", "Morgan", "Parker", "Quinn", "Reese", "Sage", "Taylor"]
    last = ["Example", "Sample", "Placeholder", "Demo", "Fictional", "Mockridge", "Testwell", "Samplewood"]
    existing = {(c["state_code"], c["city"]): c for c in d["clinics"] if c["tenant_id"] == N and c.get("status") == "active" and c.get("bookable")}
    n = 0
    streets = ["Maple Avenue", "Harbor Street", "Oak Boulevard", "Cedar Lane", "Main Street", "Park Road", "Lakeview Drive", "Summit Way", "River Street", "Elm Court"]
    hours = ["Mon-Fri 8:00 AM - 5:00 PM", "Mon-Fri 7:30 AM - 6:00 PM, Sat 9:00 AM - 1:00 PM", "Mon-Thu 8:00 AM - 7:00 PM, Fri 8:00 AM - 4:00 PM", "Mon-Fri 9:00 AM - 5:30 PM"]
    abouts = ["Free parking in the lot behind the building. Step-free entrance and an accessible restroom.", "Street parking and a garage one block away. Wheelchair accessible, with an elevator to all floors.",
              "Short-term parking at the front door. Quiet waiting room; ask us about sensory-friendly visits.", "Two minutes from the bus stop. Step-free entrance. Interpreters available on request."]

    def details(c, i, st):
        c.update(phone=f"({200 + (i * 37 + len(st) * 11) % 700}) 555-01{i % 100:02d}", hours_text=hours[i % len(hours)], about=abouts[(i // 2) % len(abouts)])

    xprofiles = []
    for st, _name in US_STATES:
        for p in places(st):
            have = existing.get((st, p["city"]))
            if have and p["label"] == p["city"]:
                have.update(tier=p["tier"], sort_order=p["sort_order"])
                details(have, p["sort_order"], st)
                continue
            cid = f"cl-{st.lower()}{p['sort_order']:02d}"
            c = clinic(cid, N, st, f"{p['label']} Clinic", p["city"], p["time_zone"])
            c["address"] = f"{10 + p['sort_order'] * 7} {streets[(p['sort_order'] + len(st)) % len(streets)]}, {p['label']}" + (f", {p['city']}" if p["label"] != p["city"] else "")
            c.update(tier=p["tier"], sort_order=p["sort_order"])
            details(c, p["sort_order"], st)
            d["clinics"].append(c)
            chosen = kinds if p["tier"] != "other" else [kinds[0], kinds[1 + p["sort_order"] % 4]]
            for sid, title, spec, h0, h1 in chosen:
                pid = f"pr-x{n}"
                nm = f"{first[n % len(first)]} {last[n % len(last)]}{suffix.get(sid, '')}"
                d["providers"].append({"id": pid, "tenant_id": N, "display_name": ("Dr. " + nm) if sid == "sv-pc-n" else nm, "status": "active", "specialty": spec,
                                     "languages": ["English", "Spanish"] if n % 3 == 0 else (["English", "Mandarin"] if n % 7 == 0 else ["English"]),
                                     "bio": f"{nm} has cared for patients in {p['label']} for {4 + n % 17} years and focuses on clear explanations and short waits."})
                d["clinic_services"].append({"tenant_id": N, "clinic_id": cid, "service_id": sid, "active": True})
                d["eligibility"].append(el(N, cid, sid, pid))
                d["availability"] += wk(N, pid, cid, [1, 2, 3, 4, 5], h0, h1)
                xprofiles.append({"tenant_id": N, "provider_id": pid, "specialty": spec, "languages": d["providers"][-1]["languages"], "bio": d["providers"][-1]["bio"], "licensed_states": [st], "accepting_new": True})
                n += 1
    d["employers"] = base["employers"] + named("em-n-", N, ["Vandelay Industries", "Stark Engineering", "Wayne Logistics", "Hooli Cloud", "Soylent Foods", "Wonka Confections", "Cyberdyne Systems",
                                                          "Gringotts Bank", "Pied Piper Labs", "Dunder Mifflin Paper"], 5) + named("em-b-", B, ["Oceanic Airlines", "Tyrell Biotech", "Bluth Construction", "Prestige Worldwide", "Sterling Cooper"], 3)
    d["insurers"] = base["insurers"] + named("in-n-", N, ["Demo Care Alliance", "Northstar Example Insurance", "Evergreen Sample Health", "Summit Placeholder Plan", "Riverbend Mutual"], 4) \
        + named("in-b-", B, ["Bay Sample Health", "Golden Gate Example Plan", "Pacific Placeholder Mutual"], 2)
    # The demo shows the full clinical flow: safety check, consent, video visits, copays.
    d["tenant_settings"] = [{"tenant_id": N, "intake_required": True, "video_join_base_url": "https://video.example.test/join"}, {"tenant_id": B, "intake_required": True},
                            {"tenant_id": "tn-off", "intake_required": False}]
    d["rules"] = [{"tenant_id": N, "service_id": "sv-pc-n", "modality": "either", "buffer_after_min": 0}]
    d["profiles"] = [{"tenant_id": N, "provider_id": "pr-a", "specialty": "Primary care", "languages": ["English", "Spanish"], "licensed_states": ["CA", "WA", "CO"], "accepting_new": True},
                     {"tenant_id": N, "provider_id": "pr-g", "specialty": "Primary care", "languages": ["English"], "licensed_states": ["CO"], "accepting_new": True},
                     {"tenant_id": N, "provider_id": "pr-d", "specialty": "Primary care", "languages": ["English", "Mandarin"], "licensed_states": ["WA", "CA"], "accepting_new": False}]
    d["profiles"] += xprofiles
    d["coverage"] = [{"tenant_id": N, "service_id": "sv-pc-n", "covered": True, "copay_cents": 2500}]
    return d


def load_demo(db) -> None:
    seed_db(db, demo_catalog())


def seed_demo_people(db, clock: Callable[[], datetime] = _now) -> None:
    """Demo accounts, appointments and staff logins. Idempotent."""
    accounts, sched, staff = Accounts(db, clock), Scheduling(db, clock), StaffAccounts(db, clock)
    ids: dict[str, str] = {}
    for p in DEMO_PATIENTS:
        have = db.get("SELECT id FROM users WHERE tenant_id = ? AND email = ?", p["tenant_id"], p["email"])
        if have:
            ids[p["email"]] = have["id"]
            continue
        profile, _ = accounts.signup(p["tenant_id"], email=p["email"], password=DEMO_PASSWORD, first_name=p["first"], last_name=p["last"], date_of_birth=p["dob"], phone=p["phone"],
                                     access_type=p["door"][0], access_id=p["door"][1])
        ids[p["email"]] = profile["id"]

    def book(email, tenant_id, clinic, service, provider, idx, key, cancel=False):
        p = next(x for x in DEMO_PATIENTS if x["email"] == email)
        if sched.lookup_by_key(tenant_id, key):
            return
        slots = sched.list_slots(tenant_id, clinic, service, provider)
        if len(slots) <= idx:
            return
        rec = sched.reserve(ReserveInput(tenant_id, clinic, service, provider, slots[idx]["id"], key, p["first"], p["last"], email, user_id=ids[email]))
        if cancel:
            sched.cancel(tenant_id, rec["booking_id"])

    book("alex.demo@example.test", "tn-north", "cl-sb", "sv-pc-n", "pr-a", 20, "demo-seed-alex-1")
    book("alex.demo@example.test", "tn-north", "cl-sea", "sv-vision-n", "pr-e", 6, "demo-seed-alex-2", True)
    book("maria.demo@example.test", "tn-north", "cl-sb", "sv-physio-n", "pr-b", 14, "demo-seed-maria-1")
    book("maria.demo@example.test", "tn-north", "cl-den", "sv-pc-n", "pr-g", 30, "demo-seed-maria-2")
    book("sam.demo@example.test", "tn-bay", "cl-oak", "sv-pc-b", "pr-z", 18, "demo-seed-sam-1")
    for s in DEMO_STAFF:
        if not db.get("SELECT 1 AS ok FROM staff_users WHERE tenant_id = ? AND email = ?", s["tenant_id"], s["email"]):
            staff.create(s["tenant_id"], email=s["email"], name=s["name"], role=s["role"], password=DEMO_PASSWORD, provider_id=s.get("provider_id"))
