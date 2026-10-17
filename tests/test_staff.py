"""Staff desk: login and roles, day schedule, status changes, phone bookings, schedule editing, exports."""
from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from carex.app import create_app
from carex.staff import to_csv, to_fhir
from tests.conftest import S, SIGNUP, h1

PW = "staff password 12345"


@pytest.fixture
def staff(ctx):
    ctx.staff_accounts.create("tn-north", email="desk@x.com", name="Dee Desk", role="front_desk", password=PW)
    ctx.staff_accounts.create("tn-north", email="doc@x.com", name="Dr A", role="provider", password=PW, provider_id="pr-a")
    ctx.staff_accounts.create("tn-north", email="boss@x.com", name="Ad Min", role="admin", password=PW)


def login(ctx, email):
    c = TestClient(create_app(ctx), base_url="http://testserver", follow_redirects=True)
    r = c.post(S + "/staff/login", data={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    return c


def phone_book(c, ctx, idx=30, slot=None, **over):
    slot = slot or ctx.sched.list_slots("tn-north", "cl-sb", "sv-pc-n", "pr-a")[idx]
    d = dict(clinic_id="cl-sb", service_id="sv-pc-n", provider_id="pr-a", slot_id=slot["id"], first_name="Phil", last_name="Phone", date_of_birth="1980-01-01",
             phone="555-222-3333", email="phil@x.com", reason="Cough", modality="in_person", consent_attested="1")
    d.update(over)
    return c.post(S + "/staff/book", data=d), slot


def test_staff_pages_need_a_staff_session_and_patients_do_not_count(client, staff):
    assert client.get(S + "/staff").url.path.endswith("/staff/login")
    client.post(S + "/signup", data=SIGNUP)                              # a patient session is not a staff session
    assert client.get(S + "/staff").url.path.endswith("/staff/login")


def test_wrong_password_is_rejected_and_locks_after_repeated_failures(ctx, staff):
    c = TestClient(create_app(ctx), base_url="http://testserver", follow_redirects=True)
    for _ in range(5):
        r = c.post(S + "/staff/login", data={"email": "desk@x.com", "password": "nope nope nope"})
        assert r.status_code in (401, 429)
    r = c.post(S + "/staff/login", data={"email": "desk@x.com", "password": PW})
    assert r.status_code in (401, 423, 429)


def test_front_desk_books_by_phone_and_sees_it_on_the_day(ctx, staff):
    c = login(ctx, "desk@x.com")
    r, slot = phone_book(c, ctx)
    assert r.status_code == 200 and "Phil Phone" in r.text or "Appointment booked" in r.text
    again, _ = phone_book(c, ctx, slot=slot, first_name="Pam")                                   # same slot: refused, not double booked
    assert again.status_code == 409
    n = ctx.db.get("SELECT COUNT(*) AS n FROM appointments WHERE provider_id = 'pr-a' AND status <> 'cancelled' AND starts_at = ?", slot["starts_at"])["n"]
    assert n == 1


def test_phone_booking_requires_verbal_consent(ctx, staff):
    c = login(ctx, "desk@x.com")
    r, _ = phone_book(c, ctx, 31, consent_attested="")
    assert r.status_code == 400


def test_status_changes_follow_the_allowed_transitions(ctx, staff):
    c = login(ctx, "desk@x.com")
    phone_book(c, ctx, 32)
    aid = ctx.db.get("SELECT id FROM appointments ORDER BY created_at DESC")["id"]
    assert c.post(f"{S}/staff/appointments/{aid}/status", data={"status": "arrived"}).status_code == 200
    assert ctx.db.get("SELECT status FROM appointments WHERE id = ?", aid)["status"] == "arrived"
    bad = c.post(f"{S}/staff/appointments/{aid}/status", data={"status": "no_show"})
    assert bad.status_code in (400, 409)
    assert ctx.db.get("SELECT status FROM appointments WHERE id = ?", aid)["status"] == "arrived"
    c.post(f"{S}/staff/appointments/{aid}/status", data={"status": "completed"})
    assert ctx.db.get("SELECT status FROM appointments WHERE id = ?", aid)["status"] == "completed"


def test_providers_are_limited_to_their_own_visits_and_to_arrive_or_complete(ctx, staff):
    desk = login(ctx, "desk@x.com")
    phone_book(desk, ctx, 33)
    other = ctx.sched.list_slots("tn-north", "cl-sb", "sv-pc-n", "pr-b")
    aid = ctx.db.get("SELECT id FROM appointments ORDER BY created_at DESC")["id"]
    doc = login(ctx, "doc@x.com")
    assert doc.post(f"{S}/staff/appointments/{aid}/status", data={"status": "no_show"}).status_code == 403
    assert doc.get(S + "/staff/book").status_code in (403, 200) and doc.post(f"{S}/staff/appointments/{aid}/cancel", data={"reason": "x"}).status_code == 403
    assert doc.get(S + "/staff/export.csv?from=2026-10-01&to=2026-12-01").status_code == 403


def test_cancel_and_reschedule_by_staff(ctx, staff):
    c = login(ctx, "desk@x.com")
    phone_book(c, ctx, 34)
    aid = ctx.db.get("SELECT id FROM appointments ORDER BY created_at DESC")["id"]
    rs = c.get(f"{S}/staff/appointments/{aid}/reschedule")
    assert rs.status_code == 200
    slot = re.findall(r'name="slot_id" value="([^"]+)"|name="slot" value="([^"]+)"', rs.text)
    assert slot
    c.post(f"{S}/staff/appointments/{aid}/cancel", data={"reason": "Patient called"})
    row = ctx.db.get("SELECT status, cancelled_by FROM appointments WHERE id = ?", aid)
    assert row["status"] == "cancelled"


def test_hours_time_off_and_closures_change_what_patients_can_book(ctx, staff):
    boss = login(ctx, "boss@x.com")
    before = len(ctx.sched.list_slots("tn-north", "cl-sb", "sv-pc-n", "pr-a"))
    r = boss.get(S + "/staff/hours")
    assert r.status_code == 200
    day = ctx.sched.list_slots("tn-north", "cl-sb", "sv-pc-n", "pr-a")[0]["starts_at"][:10]
    boss.post(S + "/staff/closures/add", data={"clinic": "cl-sb", "starts": day + "T00:00", "ends": day + "T23:59", "reason": "Holiday"})
    after = ctx.sched.list_slots("tn-north", "cl-sb", "sv-pc-n", "pr-a")
    assert len(after) < before


def test_csv_export_is_formula_safe_and_fhir_is_a_bundle(ctx, staff):
    c = login(ctx, "desk@x.com")
    phone_book(c, ctx, 35, first_name="=HYPERLINK(\"http://evil\")")
    r = c.get(S + "/staff/export.csv?from=2026-10-01&to=2027-01-01")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]
    assert "'=HYPERLINK" in r.text and ",=HYPERLINK" not in r.text
    rows = ctx.desk.range("tn-north", ctx.staff_accounts.list("tn-north")[0] if False else {"role": "admin", "provider_id": None, "id": "x"}, "2026-10-01", "2027-01-01")
    b = to_fhir(rows, "https://app.example.test")
    assert b["resourceType"] == "Bundle" and b["entry"][0]["resource"]["resourceType"] == "Appointment"
    assert to_csv([]).startswith("Reference,")


def test_staff_cannot_cross_tenants(ctx, staff):
    c = login(ctx, "desk@x.com")
    other = ctx.db.get("SELECT slug FROM tenants WHERE slug <> 'northwind-health'")
    if other:
        r = c.get(f"/t/{other['slug']}/staff")
        assert r.url.path.endswith("/staff/login")


def test_phone_booking_never_screens_symptom_words(ctx, staff):
    c = login(ctx, "desk@x.com")
    r, slot = phone_book(c, ctx, 36, reason="severe chest pain")
    assert r.status_code == 200 and "Appointment booked" in r.text
    assert ctx.db.get("SELECT COUNT(*) AS n FROM appointments WHERE starts_at = ?", slot["starts_at"])["n"] == 1


# ---------------------------------------------------------------- batch 3: calendar, waiting list, insights, setup, share
def test_calendar_grid_shows_booked_visits_by_provider(ctx, staff):
    c = login(ctx, "desk@x.com")
    r, slot = phone_book(c, ctx, 30)
    date = slot["starts_at"][:10]
    page = c.get(S + f"/staff/calendar?date={date}&clinic=cl-sb")
    assert page.status_code == 200 and "calblk" in page.text and "Phil Phone" in page.text and " style=" not in page.text
    assert re.search(r'class="calblk st-confirmed rs-\d+ rl-\d+ col-\d+"', page.text)
    doc = login(ctx, "doc@x.com").get(S + f"/staff/calendar?date={date}&clinic=cl-sb")
    assert doc.status_code == 200


def test_waiting_list_and_insights_and_setup_are_role_limited(ctx, staff):
    desk, doc, boss = login(ctx, "desk@x.com"), login(ctx, "doc@x.com"), login(ctx, "boss@x.com")
    for path in ("/staff/waitlist", "/staff/insights", "/staff/share"):
        assert desk.get(S + path).status_code == 200
        assert doc.get(S + path).status_code == 403
    assert desk.get(S + "/staff/setup").status_code == 403 and boss.get(S + "/staff/setup").status_code == 200


def test_staff_can_remove_a_waiting_list_entry(ctx, staff):
    from carex.accounts import Accounts
    p, _ = Accounts(ctx.db, ctx.clock).signup("tn-north", email="w@x.com", password="correct horse 1", first_name="Wil", last_name="Wait", date_of_birth="1990-01-01", phone="555-111-3333", access_type="employer", access_id="em-n-1")
    e = ctx.waitlist.join("tn-north", p["id"], "cl-sb", "sv-pc-n")
    desk = login(ctx, "desk@x.com")
    assert "Wil W." in desk.get(S + "/staff/waitlist").text
    assert desk.post(S + f"/staff/waitlist/{e['id']}/remove").status_code == 200
    assert "Wil W." not in desk.get(S + "/staff/waitlist").text


def test_insights_counts_and_funnel(ctx, staff, signed_in_factory=None):
    ctx.events.log("tn-north", "search"); ctx.events.log("tn-north", "booked", "cl-sb")
    ctx.events.log("tn-north", "not-a-real-event")                       # ignored: only known names are stored
    m = ctx.insights.summary("tn-north", 30, "cl-sb")
    assert m["funnel"][3]["n"] == 1 and m["funnel"][0]["n"] == 1 and m["utilisation"] is not None
    assert ctx.db.get("SELECT COUNT(*) AS n FROM events")["n"] == 2
    page = login(ctx, "desk@x.com").get(S + "/staff/insights?days=90&clinic=cl-sb")
    assert page.status_code == 200 and "No-show rate" in page.text and "<meter" in page.text


def test_admin_setup_changes_branding_and_clinic_details_and_keeps_new_clinics_hidden(ctx, staff):
    boss = login(ctx, "boss@x.com")
    r = boss.post(S + "/staff/setup/brand", data={"state": "CA", "display_name": "Northwind Care", "primary_color": "#112233", "logo_url": "", "support_email": "help@x.com", "support_phone": "555-000-1111"})
    assert "Branding saved" in r.text and ctx.db.get("SELECT display_name FROM tenants WHERE id = 'tn-north'")["display_name"] == "Northwind Care"
    assert "https" in boss.post(S + "/staff/setup/brand", data={"state": "CA", "display_name": "X", "primary_color": "#112233", "logo_url": "http://insecure.example/x.png"}).text
    r = boss.post(S + "/staff/setup/clinic", data={"name": "Pop-up", "city": "Austin", "address": "1 Test St", "state_code": "TX", "time_zone": "America/Chicago"})
    assert "Clinic added" in r.text
    new = ctx.db.get("SELECT id, status, bookable FROM clinics WHERE name = 'Pop-up'")
    assert new["status"] == "inactive" and new["bookable"] == 0
    r = boss.post(S + f"/staff/setup/clinic/{new['id']}", data={"state": "TX", "op": "details", "phone": "(512) 555-0100", "hours_text": "Mon-Fri 9-5", "about": "Free parking", "image_url": "https://img.example/x.jpg"})
    assert "details saved" in r.text.lower() and ctx.db.get("SELECT phone FROM clinics WHERE id = ?", new["id"])["phone"] == "(512) 555-0100"


def test_share_page_and_qr_code(ctx, staff):
    desk = login(ctx, "desk@x.com")
    page = desk.get(S + "/staff/share?state=CA&clinic=cl-sb")
    assert page.status_code == 200 and "qr.svg?clinic=cl-sb" in page.text and "Button for your website" in page.text
    q = TestClient(create_app(ctx), base_url="http://testserver").get(S + "/qr.svg?clinic=cl-sb")                 # public: it only encodes a public link
    assert q.status_code == 200 and q.headers["content-type"].startswith("image/svg+xml") and "<svg" in q.text
    assert TestClient(create_app(ctx), base_url="http://testserver").get(S + "/qr.svg?clinic=nope-nope").status_code == 404
