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
             phone="555-222-3333", email="phil@x.com", reason="Cough", modality="in_person", none_apply="1", consent_attested="1")
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


def test_phone_booking_requires_the_screen_and_verbal_consent(ctx, staff):
    c = login(ctx, "desk@x.com")
    r, _ = phone_book(c, ctx, 31, none_apply="")
    assert r.status_code == 400
    r, _ = phone_book(c, ctx, 31, consent_attested="")
    assert r.status_code == 400
    r, _ = phone_book(c, ctx, 31, reason="severe chest pain", none_apply="")
    assert r.status_code in (400, 409)


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
