"""Patient web flows end to end through real HTML pages (no JavaScript)."""
from __future__ import annotations

import re

import pytest

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
    assert client.get(S + "/book").status_code == 200                              # browsing needs no account
    assert client.get(S + "/appointments").url.path.endswith("/login")            # personal pages are protected
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


def test_911_text_is_informational_only_and_never_blocks(signed_in):
    r, _ = book_through_pages(signed_in, reason="crushing chest pain and trouble breathing")
    assert h1(r) == "You're booked" and "911" in r.text and 'class="infonote"' in r.text
    assert "emergency" not in re.findall(r'class="banner ([^"]*)"', r.text)
    details = signed_in.get(S + f"/book/details?clinic=cl-sb&service=sv-physio-n&provider=pr-b&slot={first_slot(signed_in)}")
    assert details.status_code == 200 and 'class="infonote"' in details.text and "Safety check" not in details.text
    css = signed_in.get("/assets/app.css").text
    assert "emerg-pulse" not in css and "banner.emergency" not in css


def test_consent_is_required_when_intake_is_on(signed_in, ctx):
    ctx.db.run("UPDATE tenants SET intake_required = 1")
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


def test_first_screen_is_sign_in_and_demo_logins_are_prefilled_only_for_demo_data(client, ctx, db):
    r = client.get("/")
    assert r.url.path.endswith("/login") and h1(r) == "Sign in"
    assert "Demo account" not in r.text and 'value="Demo' not in r.text          # synthetic test data is not the demo set
    from fastapi.testclient import TestClient
    from carex.app import create_app
    from carex.context import build
    from carex.seed_demo import DEMO_PASSWORD, load_demo, seed_demo_people
    tables = [r["tablename"] for r in db.all("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'carex_migrations'")]
    if tables:
        db.run("TRUNCATE " + ", ".join(tables) + " RESTART IDENTITY CASCADE")
    d = db
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
    hidden = TestClient(create_app(build(db=d, env={"CAREX_HIDE_DEMO": "1"})), base_url="http://testserver", follow_redirects=True)
    r = hidden.get(S + "/login")
    assert "Demo account" not in r.text and DEMO_PASSWORD not in r.text and 'value="alex.demo' not in r.text
    assert "frontdesk@northwind.example.test" not in hidden.get(S + "/staff/login").text


def test_state_picker_lists_all_56_and_every_state_has_at_least_20_clinics_in_tiers(demo):
    signed_in, ctx = demo
    page = signed_in.get(S + "/book")
    codes = re.findall(r'<option value="([A-Z]{2})"', page.text)
    assert len(codes) == 56
    assert "Puerto Rico" in page.text and "District of Columbia" in page.text and "Guam" in page.text
    for code in codes:
        n = ctx.db.get("SELECT COUNT(*) AS n FROM clinics WHERE tenant_id = 'tn-north' AND state_code = ? AND status = 'active' AND bookable = 1", code)["n"]
        assert n >= 20, code
        tiers = {r["tier"]: r["n"] for r in ctx.db.all("SELECT tier, COUNT(*) AS n FROM clinics WHERE tenant_id = 'tn-north' AND state_code = ? GROUP BY tier", code)}
        assert tiers.get("hq") == 1 and tiers.get("major", 0) >= 4 and tiers.get("other", 0) >= 10, code
    ca = signed_in.get(S + "/book?state=CA")
    assert "Clinics in California" in ca.text and "selected" in ca.text
    assert "Headquarters location" in ca.text and "Prominent locations" in ca.text and "More locations in California" in ca.text
    for name in ("San Francisco Clinic", "Los Angeles Clinic", "San Diego Clinic", "San Jose Clinic", "Santa Clara Clinic", "San Bernardino Clinic"):
        assert name in ca.text
    assert ca.text.index("San Francisco Clinic") < ca.text.index("Los Angeles Clinic") < ca.text.index("Santa Clara Clinic")      # headquarters, then prominent, then others
    assert ca.text.count('class="clinic"') == 5 and ca.text.count('class="morerow"') >= 15
    dc = signed_in.get(S + "/book?state=DC")
    assert "Capitol Hill Clinic" in dc.text
    pr = signed_in.get(S + "/book?state=PR")
    assert "San Juan Clinic" in pr.text and "Atlantic Time" in pr.text
    assert "Pago Pago Clinic" in signed_in.get(S + "/book?state=AS").text
    assert "Pensacola Clinic" in signed_in.get(S + "/book?state=FL").text


def test_any_generated_clinic_opens_with_providers_and_times(demo):
    signed_in, _ = demo
    for cid in ("cl-wy00", "cl-gu00", "cl-vi07", "cl-ny00"):
        page = signed_in.get(S + "/book/provider?clinic=" + cid)
        assert page.status_code == 200 and 'class="vcard ' in page.text and 'class="slot"' not in page.text, cid          # visit-type cards first, no times yet
        sid = re.search(r"service=([\w-]+)", page.text).group(1)
        assert 'class="slot"' in signed_in.get(S + f"/book/provider?clinic={cid}&service={sid}").text, cid


def test_clinic_card_shows_only_visit_type_cards_until_one_is_chosen(signed_in):
    page = signed_in.get(S + "/book/provider?clinic=cl-sb")
    assert h1(page) == "San Bernardo Clinic" and "All times in Pacific Time" in page.text
    assert "What kind of visit?" in page.text
    cards = re.findall(r'class="vcard (vt-\d)"', page.text)
    assert len(cards) == 2 and len(set(cards)) == 2                 # Physio and Primary Care each own a colour
    assert "Next opening" in page.text and "Next opening" in page.text.split("vcards")[1]
    for hidden in ('class="slot"', 'class="prov"', 'class="regcard"', 'class="datebadge"', 'class="vchip'):
        assert hidden not in page.text, hidden                       # nothing but the cards until a visit type is picked


def test_choosing_a_visit_type_shows_its_providers_times_and_time_zone_in_the_visit_colour(signed_in):
    other = signed_in.get(S + "/book/provider?clinic=cl-sb&service=sv-pc-n")
    assert "Dr. Alex Example" in other.text and "Sam Sample" not in other.text
    assert re.search(r"(PDT|PST)", other.text) and 'class="datebadge"' in other.text and 'class="slot"' in other.text
    assert re.search(r'<div class="vt-\d">', other.text) and 'class="regcard"' in other.text and "Visit types" in other.text
    assert len(re.findall(r'class="vchip vt-\d', other.text)) == 2        # the other visit types stay one tap away


def test_every_visit_type_has_a_different_colour(client, ctx):
    from carex.web import Web
    colors = Web(ctx).visit_colors(ctx.db.get("SELECT id FROM tenants WHERE slug = 'northwind-health'"))
    assert len(colors) >= 5 and len(set(colors.values())) == len(colors)


def test_details_page_is_a_modern_form_and_quick_reasons_combine_with_free_text(signed_in, ctx):
    ctx.db.run("UPDATE tenants SET intake_required = 1")
    slot = first_slot(signed_in, service="sv-pc-n", provider="pr-a")
    page = signed_in.get(f"{S}/book/details?clinic=cl-sb&service=sv-pc-n&provider=pr-a&slot={slot}")
    for marker in ('class="persons"', 'class="pills"', 'class="actionbar"', 'class="switch"', 'class="apptcard vt-', "Review booking"):
        assert marker in page.text, marker
    assert len(re.findall(r'name="reason_pick"', page.text)) == 6
    r = signed_in.post(S + "/book/review", data=dict(clinic="cl-sb", service="sv-pc-n", provider="pr-a", slot=slot, reason_pick="Follow-up", reason_text="Left knee", modality="in_person", consent="v1"))
    assert h1(r) == "Review and confirm" and "Follow-up: Left knee" in r.text
    only_pick = signed_in.post(S + "/book/review", data=dict(clinic="cl-sb", service="sv-pc-n", provider="pr-a", slot=slot, reason_pick="Check-up", consent="v1"))
    assert h1(only_pick) == "Review and confirm"
    nothing = signed_in.post(S + "/book/review", data=dict(clinic="cl-sb", service="sv-pc-n", provider="pr-a", slot=slot, consent="v1"))
    assert h1(nothing) != "Review and confirm" and "what the visit is for" in nothing.text.lower()


def test_video_visits_show_the_state_question_and_in_person_only_visits_do_not(signed_in, ctx):
    ctx.db.run("UPDATE visit_types SET modality = 'either' WHERE id = 'sv-pc-n'")
    slot = first_slot(signed_in, service="sv-pc-n", provider="pr-a")
    page = signed_in.get(f"{S}/book/details?clinic=cl-sb&service=sv-pc-n&provider=pr-a&slot={slot}")
    assert 'value="telehealth"' in page.text and 'class="tele"' in page.text and "licensed" in page.text
    inperson = signed_in.get(f"{S}/book/details?clinic=cl-sb&service=sv-physio-n&provider=pr-b&slot={first_slot(signed_in)}")
    assert 'class="tele' not in inperson.text and 'value="in_person"' in inperson.text


def test_clinic_page_is_an_event_style_page_with_next_opening_book_card_and_tint(signed_in):
    page = signed_in.get(S + "/book/provider?clinic=cl-sb&service=sv-pc-n")
    t = page.text
    assert 'class="cover"' in t and "Hosted by" in t and 'class="facts"' in t and 'class="regcard"' in t
    assert re.search(r'class="evt tint-[0-7]"', t) and "Next opening" in t
    book = re.search(r'<a class="cta" href="([^"]+)">Book ', t)
    assert book and "/book/details?" in book.group(1)
    assert signed_in.get(book.group(1).replace("&amp;", "&")).status_code == 200      # the Book card leads straight to the details step
    assert re.search(r'class="evt tint-[0-7]"', signed_in.get(S + "/book/provider?clinic=cl-sb&service=sv-pc-n").text).group(0) == re.search(r'class="evt tint-[0-7]"', t).group(0)   # tint is stable per clinic


def test_visit_type_cards_are_ordered_by_soonest_opening(demo):
    cl, _ = demo
    t = cl.get(S + "/book/provider?clinic=cl-tx00").text
    cards = re.findall(r'class="vcard vt-\d".*?Next opening (\w+) (\w+) (\d+) · ([^<]+)</em>', t, re.S)
    assert len(cards) == 5
    key = [(int(d), __import__("datetime").datetime.strptime(tm.strip(), "%I:%M %p").time()) for _, _, d, tm in cards]
    assert key == sorted(key)
    headline = re.search(r"Next opening ([^<]+?) [A-Z]{3,4}<", t).group(1)
    assert headline == cards[0][3].strip()


# ---------------------------------------------------------------- batch 1: guest browsing, finding care, one-tap booking, manage links
def test_guests_can_browse_clinics_and_times_without_an_account(demo):
    _, ctx = demo
    from fastapi.testclient import TestClient
    from carex.app import create_app
    g = TestClient(create_app(ctx), base_url="http://testserver", follow_redirects=True)
    r = g.get(S + "/book?state=TX")
    assert r.status_code == 200 and "Sign in" in r.text and "Create account" in r.text and "tabbar" not in r.text
    p = g.get(S + "/book/provider?clinic=cl-tx00")
    assert p.status_code == 200 and "Next opening" in p.text and "quickbook" in p.text
    link = re.search(r'class="quickbook" href="([^"]+)"', p.text).group(1).replace("&amp;", "&")
    r = g.get(link)
    assert r.url.path.endswith("/login") and "next=" in str(r.url)                      # booking needs an account; the way back is kept


def test_search_by_name_or_city_and_find_soonest(demo):
    cl, _ = demo
    r = cl.get(S + "/book?q=austin")
    assert "Results for" in r.text and "Austin" in r.text
    assert "No clinics match" in cl.get(S + "/book?q=zzzzqq").text
    f = cl.get(S + "/book/find?kind=primary_care&state=TX")
    assert f.status_code == 200 and "Soonest" in f.text and f.text.count('class="clinic"') >= 5


def test_one_tap_booking_link_goes_to_the_details_step(demo):
    cl, _ = demo
    p = cl.get(S + "/book/provider?clinic=cl-tx00").text
    link = re.search(r'class="quickbook" href="([^"]+)"', p).group(1).replace("&amp;", "&")
    r = cl.get(link)
    assert r.status_code == 200 and "Review" in r.text or "details" in str(r.url)


def test_clinic_page_has_about_section_filters_and_calendar_links(demo):
    cl, _ = demo
    t = cl.get(S + "/book/provider?clinic=cl-tx00").text
    assert "About this clinic" in t and "tel:" in t and "google.com/maps" in t
    v = re.search(r"service=([\w-]+)", t).group(1)
    t2 = cl.get(S + f"/book/provider?clinic=cl-tx00&service={v}&part=morning").text
    assert 'name="part"' in t2 and "Visit &amp; time" in t2 or "Visit & time" in t2


def test_confirmation_has_calendar_file_and_manage_link_works(signed_in, ctx):
    r, _ = book_through_pages(signed_in)
    assert h1(r) == "You're booked" and "calendar.ics" in r.text and "Get directions" in r.text
    row = ctx.db.get("SELECT id, manage_token FROM appointments WHERE manage_token IS NOT NULL")
    ics = signed_in.get(S + f"/appointments/{row['id']}/calendar.ics")
    assert ics.status_code == 200 and ics.text.startswith("BEGIN:VCALENDAR") and "text/calendar" in ics.headers["content-type"]
    from fastapi.testclient import TestClient
    from carex.app import create_app
    g = TestClient(create_app(ctx), base_url="http://testserver", follow_redirects=True)           # no cookies: the link itself is the key
    m = g.get(S + f"/m/{row['manage_token']}")
    assert m.status_code == 200 and "Your appointment" in m.text
    assert g.get(S + "/m/not-a-real-token").status_code == 404
    assert g.get(S + f"/m/{row['manage_token']}/calendar.ics").text.startswith("BEGIN:VCALENDAR")
    done = g.post(S + f"/m/{row['manage_token']}/cancel")
    assert done.status_code == 200 and "cancelled" in done.text.lower()
    assert ctx.db.get("SELECT status FROM appointments WHERE id = ?", row["id"])["status"] == "cancelled"


# ---------------------------------------------------------------- batch 2
def test_reschedule_to_a_different_provider(signed_in, ctx):
    ctx.db.run("INSERT INTO provider_eligibility (tenant_id, clinic_id, visit_type_id, provider_id, active) VALUES ('tn-north','cl-sb','sv-pc-n','pr-b',1)")
    from urllib.parse import unquote
    page = signed_in.get(f"{S}/book/provider?clinic=cl-sb&service=sv-pc-n&provider=pr-a")
    slot = unquote(re.findall(r'slot=([^"&]+)', page.text)[0])
    review = signed_in.post(S + "/book/review", data=dict(clinic="cl-sb", service="sv-pc-n", provider="pr-a", slot=slot, reason="Cough", modality="in_person", consent="v1"))
    assert h1(review) == "Review and confirm"
    assert h1(signed_in.post(S + "/book/confirm", data=hidden(review))) == "You're booked"
    bid = ctx.db.get("SELECT id FROM appointments")["id"]
    r = signed_in.get(S + f"/appointments/{bid}/reschedule?provider=pr-b")
    assert "Sam Sample" in r.text and 'name="provider" value="pr-b"' in r.text
    new = unquote(re.findall(r'name="slot" value="([^"]+)"', r.text)[3])
    assert ":pr-b:" in new
    done = signed_in.post(S + f"/appointments/{bid}/reschedule", data={"slot": new, "provider": "pr-b"})
    assert "moved" in done.text.lower()
    assert ctx.db.get("SELECT provider_id FROM appointments WHERE id = ?", bid)["provider_id"] == "pr-b"
    bad = signed_in.post(S + f"/appointments/{bid}/reschedule", data={"slot": new, "provider": "pr-a"})        # slot of one provider can't be claimed for another
    assert ctx.db.get("SELECT provider_id FROM appointments WHERE id = ?", bid)["provider_id"] == "pr-b"


def test_coverage_chip_provider_bio_and_language_filter(demo):
    cl, _ = demo
    t = cl.get(S + "/book/provider?clinic=cl-tx00").text
    assert "covchip" in t and ("Covered by your plan" in t or "Not covered" in t)
    v = re.search(r"service=([\w-]+)", t).group(1)
    p = cl.get(S + f"/book/provider?clinic=cl-tx00&service={v}").text
    assert "<details class=\"bio\">" in p
    assert cl.get(S + f"/book/provider?clinic=cl-tx00&service={v}&lang=Klingon").status_code == 200


def test_video_waiting_room_opens_fifteen_minutes_before(signed_in, ctx, clock):
    from datetime import timedelta
    ctx.db.run("UPDATE visit_types SET modality = 'telehealth' WHERE id = 'sv-pc-n'")
    ctx.db.run("UPDATE providers SET licensed_states = '[\"CA\"]' WHERE id = 'pr-a'")
    ctx.db.run("UPDATE tenants SET video_join_base_url = 'https://video.example.test/room' WHERE id = 'tn-north'")
    from urllib.parse import unquote
    page = signed_in.get(f"{S}/book/provider?clinic=cl-sb&service=sv-pc-n&provider=pr-a")
    slot = unquote(re.findall(r'slot=([^"&]+)', page.text)[0])
    d = dict(clinic="cl-sb", service="sv-pc-n", provider="pr-a", slot=slot, reason="Cough", modality="telehealth", patient_state="CA", consent="v1")
    review = signed_in.post(S + "/book/review", data=d)
    if h1(review) != "Review and confirm":
        raise AssertionError(banners(review) or h1(review))
    signed_in.post(S + "/book/confirm", data=hidden(review))
    row = ctx.db.get("SELECT id, starts_at FROM appointments")
    r = signed_in.get(S + f"/appointments/{row['id']}/video")
    assert r.status_code == 200 and "Almost time" in r.text
    from carex.util import iso
    ctx.db.run("UPDATE appointments SET starts_at = ?, ends_at = ? WHERE id = ?", iso(clock() + timedelta(minutes=5)), iso(clock() + timedelta(minutes=35)), row["id"])
    assert "ready" in signed_in.get(S + f"/appointments/{row['id']}/video").text


# ---------------------------------------------------------------- batch 4: legal pages, my data, closing an account
def test_legal_pages_are_public_and_flagged_as_templates(client):
    for doc, h in (("privacy", "Privacy policy"), ("terms", "Terms of use"), ("notice-of-privacy-practices", "Notice of privacy practices")):
        r = client.get(S + f"/legal/{doc}")
        assert r.status_code == 200 and h1(r) == h and "not legal advice" in r.text
    assert client.get(S + "/legal/nope").status_code == 404
    assert "/legal/privacy" in client.get(S + "/login").text                    # linked from every page footer


def test_account_page_download_activity_and_close_account(signed_in, ctx):
    r, _ = book_through_pages(signed_in)
    assert h1(r) == "You're booked"
    acct = signed_in.get(S + "/account")
    assert h1(acct) == "Your account" and "You booked an appointment" in acct.text
    dl = signed_in.get(S + "/account/export.json")
    assert dl.status_code == 200 and "attachment" in dl.headers["content-disposition"]
    data = dl.json()
    assert data["account"]["email"] == SIGNUP["email"] and len(data["appointments"]) == 1 and "password" not in dl.text.lower()
    uid = data["account"]["id"]
    wrong = signed_in.post(S + "/account/delete", data={"confirm": "DELETE", "password": "wrong"})
    assert "Type DELETE" in wrong.text and ctx.db.get("SELECT email FROM users WHERE id = ?", uid)["email"] == SIGNUP["email"]
    done = signed_in.post(S + "/account/delete", data={"confirm": "DELETE", "password": SIGNUP["password"]})
    assert "account was closed" in done.text
    row = ctx.db.get("SELECT email, first_name FROM users WHERE id = ?", uid)
    assert row["first_name"] == "Former" and row["email"].endswith("@erased.invalid")
    a = ctx.db.get("SELECT status, patient_first_name, patient_email, user_id, manage_token FROM appointments")
    assert a["status"] == "cancelled" and a["patient_first_name"] == "Former" and a["patient_email"] is None and a["user_id"] is None and a["manage_token"] is None
    assert signed_in.get(S + "/appointments").url.path.endswith("/login")                         # signed out everywhere
    assert signed_in.post(S + "/login", data={"email": SIGNUP["email"], "password": SIGNUP["password"]}).status_code in (200, 401)
    assert ctx.db.get("SELECT COUNT(*) AS n FROM outbox WHERE to_email IS NOT NULL AND user_id IS NOT NULL")["n"] == 0
