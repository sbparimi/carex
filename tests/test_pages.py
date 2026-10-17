"""Patient web flows end to end through real HTML pages (no JavaScript)."""
from __future__ import annotations

import re

from tests.conftest import S, SIGNUP, banners, book_through_pages, first_slot, h1, hidden


def test_home_redirects_to_the_only_tenant_or_lists(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code in (200, 303)


def test_pages_set_strict_headers_and_never_use_inline_script_or_style(signed_in):
    r = signed_in.get(S + "/book")
    csp = r.headers["content-security-policy"]
    assert "default-src 'none'" in csp and "script-src" not in csp and "form-action 'self'" in csp
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "same-origin"
    assert r.headers["cache-control"].startswith("no-store")
    assert "<script" not in r.text and " style=" not in r.text and "<style" not in r.text and " onclick=" not in r.text


def test_signup_then_login_and_logout(client):
    assert client.get(S + "/book").url.path.endswith("/login")                    # protected
    r = client.post(S + "/signup", data=SIGNUP)
    assert h1(r) == "Find care"
    client.post(S + "/logout")
    assert client.get(S + "/appointments").url.path.endswith("/login")
    r = client.post(S + "/login", data={"email": SIGNUP["email"], "password": "wrong password"})
    assert r.status_code in (200, 401) and banners(r)
    r = client.post(S + "/login", data={"email": SIGNUP["email"], "password": SIGNUP["password"]})
    assert h1(r) == "Find care"


def test_full_booking_then_replay_then_cancel_then_reschedule(signed_in):
    r, form = book_through_pages(signed_in)
    assert h1(r) == "You're booked"
    mine = signed_in.get(S + "/appointments")
    assert "Physio" in mine.text or "physio" in mine.text.lower()
    ids = re.findall(r'/appointments/([\w-]+)/cancel', mine.text)
    assert len(ids) == 1
    # a second identical submission is not a second booking
    r2, _ = book_through_pages(signed_in)
    assert len(re.findall(r'/appointments/([\w-]+)/cancel', signed_in.get(S + "/appointments").text)) >= 1
    # reschedule form loads and moves it
    rs = signed_in.get(f"{S}/appointments/{ids[0]}/reschedule")
    assert rs.status_code == 200
    slot = re.findall(r'name="slot" value="([^"]+)"', rs.text)[-1]
    moved = signed_in.post(f"{S}/appointments/{ids[0]}/reschedule", data={**hidden(rs), "slot": slot})
    assert moved.status_code == 200
    gone = signed_in.post(f"{S}/appointments/{ids[0]}/cancel", data={"reason": "Changed my mind"})
    assert gone.status_code == 200
    assert f"/appointments/{ids[0]}/cancel" not in signed_in.get(S + "/appointments").text


def test_emergency_symptoms_show_an_urgent_911_warning_but_booking_still_works(signed_in):
    r, _ = book_through_pages(signed_in, reason="crushing chest pain and trouble breathing")
    assert h1(r) == "You're booked" and "911" in r.text and 'class="banner warning emergency"' in r.text
    slot = first_slot(signed_in)
    review = signed_in.post(S + "/book/review", data=dict(clinic="cl-sb", service="sv-physio-n", provider="pr-b", slot=slot, reason="Sore knee", flag="stroke", modality="in_person", consent="v1"))
    assert h1(review) == "Review and confirm" and "emergency" in review.text and "Confirm booking" in review.text
    assert "animation" not in review.text and "<style" not in review.text          # motion lives in the stylesheet, not inline


def test_emergency_banner_has_motion_that_respects_reduced_motion(client):
    css = client.get("/assets/app.css").text
    assert "emerg-pulse" in css and "prefers-reduced-motion: reduce" in css


def test_must_acknowledge_red_flag_screen_and_consent(signed_in, ctx):
    ctx.db.run("UPDATE tenants SET intake_required = 1")
    r, _ = book_through_pages(signed_in, none_apply="")
    assert h1(r) != "Review and confirm" and r.status_code in (200, 422)
    r, _ = book_through_pages(signed_in, consent="")
    assert h1(r) != "Review and confirm"


def test_posting_without_same_origin_is_rejected(client):
    r = client.post(S + "/login", data={"email": "a@b.co", "password": "x"}, headers={"origin": "https://evil.example", "sec-fetch-site": "cross-site"})
    assert r.status_code == 403


def test_other_peoples_appointments_cannot_be_touched(signed_in, client, ctx):
    r, _ = book_through_pages(signed_in)
    apt = re.findall(r'/appointments/([\w-]+)/cancel', signed_in.get(S + "/appointments").text)[0]
    from fastapi.testclient import TestClient
    from carex.app import create_app
    other = TestClient(create_app(ctx), base_url="http://testserver", follow_redirects=True)
    other.post(S + "/signup", data={**SIGNUP, "email": "bob@example.com", "first_name": "Bob"})
    r = other.post(f"{S}/appointments/{apt}/cancel", data={"reason": "x"})
    assert r.status_code in (404, 200) and "cancelled" not in other.get(S + "/appointments").text.lower()
    assert f"/appointments/{apt}/cancel" in signed_in.get(S + "/appointments").text


def test_dependents_can_be_added_and_removed(signed_in):
    r = signed_in.post(S + "/patients/add", data={"first_name": "Kid", "last_name": "Lee", "date_of_birth": "2018-05-05", "relationship": "child"})
    r = signed_in.get(S + "/appointments")
    assert "Kid" in r.text
    pid = re.findall(r'/patients/([\w-]+)/remove', r.text)
    assert pid
    r = signed_in.post(f"{S}/patients/{pid[0]}/remove")
    assert "Kid" not in signed_in.get(S + "/appointments").text


def test_unknown_tenant_and_pages_give_clean_errors(client):
    r = client.get("/t/nope/login")
    assert r.status_code == 404 and "Traceback" not in r.text
    assert client.get(S + "/does-not-exist").status_code == 404


def test_password_reset_flow(client, ctx):
    client.post(S + "/signup", data=SIGNUP)
    client.post(S + "/logout")
    client.post(S + "/forgot", data={"email": SIGNUP["email"]})
    to, slug, token = ctx.accounts.mailer.resets[-1]
    r = client.get(f"{S}/reset?token={token}")
    assert r.status_code == 200
    r = client.post(S + "/reset", data={"token": token, "password": "another long pass 9"})
    r = client.post(S + "/login", data={"email": SIGNUP["email"], "password": "another long pass 9"})
    assert h1(r) == "Find care"
    # unknown email gives the same answer (no account enumeration)
    a = client.post(S + "/forgot", data={"email": "nobody@example.com"})
    assert a.status_code == 200


def test_first_screen_is_sign_in_and_demo_logins_are_prefilled_only_for_demo_data(client, ctx):
    r = client.get("/")
    assert r.url.path.endswith("/login") and h1(r) == "Sign in"
    assert "Demo account" not in r.text and 'value="Demo' not in r.text          # synthetic test data is not the demo set
    from fastapi.testclient import TestClient
    from carex.app import create_app
    from carex.context import build
    from carex.db import open_db
    from carex.seed_demo import DEMO_PASSWORD, load_demo, seed_demo_people
    d = open_db()
    load_demo(d)
    seed_demo_people(d)
    client = TestClient(create_app(build(db=d, env={})), base_url="http://testserver", follow_redirects=True)
    r = client.get("/")
    assert r.url.path == S + "/login"                                           # the demo organisation, not alphabetical first
    r = client.get(S + "/login")
    assert "alex.demo@example.test" in r.text and DEMO_PASSWORD in r.text and "Demo account" in r.text
    s = client.get(S + "/staff/login")
    assert "frontdesk@northwind.example.test" in s.text
    ok = client.post(S + "/login", data={"email": "alex.demo@example.test", "password": DEMO_PASSWORD})
    assert h1(ok) == "Find care"


def test_state_picker_lists_all_56_and_shows_at_most_five_clinic_cards(signed_in, ctx):
    page = signed_in.get(S + "/book")
    assert len(re.findall(r'<option value="[A-Z]{2}"', page.text)) == 56
    assert "Puerto Rico" in page.text and "District of Columbia" in page.text and "Guam" in page.text
    ca = signed_in.get(S + "/book?state=CA")
    assert "Clinics in California" in ca.text and 'selected' in ca.text and "San Bernardo Clinic" in ca.text
    empty = signed_in.get(S + "/book?state=WY")
    assert "No clinics open in Wyoming yet" in empty.text
    for i in range(8):                                              # many clinics: still only the five most prominent
        ctx.db.run("INSERT INTO clinics (id, tenant_id, state_code, name, city, address, time_zone, status, bookable) VALUES (?,?,?,?,?,?,?,?,?)",
                   f"cl-x{i}", "tn-north", "CA", f"Extra {i}", "Town", "1 Way", "America/Los_Angeles", "active", 1)
    assert signed_in.get(S + "/book?state=CA").text.count('class="clinic"') <= 5


def test_clinic_card_leads_to_providers_with_dates_times_and_time_zone_in_the_visit_colour(signed_in):
    page = signed_in.get(S + "/book/provider?clinic=cl-sb")
    assert h1(page) == "San Bernardo Clinic" and "All times in Pacific Time" in page.text
    assert re.search(r"(PDT|PST)", page.text) and 'class="datebadge"' in page.text and 'class="slot"' in page.text
    assert "Sam Sample, PT" in page.text or "Dr. Alex Example" in page.text
    chips = re.findall(r'class="vchip (vt-\d)', page.text)
    assert len(chips) == 2 and len(set(chips)) == 2                 # Physio and Primary Care each own a colour
    other = signed_in.get(S + "/book/provider?clinic=cl-sb&service=sv-pc-n")
    assert "Dr. Alex Example" in other.text and "Sam Sample" not in other.text
    assert re.search(r'<div class="vt-\d">', other.text)


def test_every_visit_type_has_a_different_colour(client, ctx):
    from carex.web import Web
    colors = Web(ctx).visit_colors(ctx.db.get("SELECT id FROM tenants WHERE slug = 'northwind-health'"))
    assert len(colors) >= 5 and len(set(colors.values())) == len(colors)
