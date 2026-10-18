"""Clinician cards, accepted plans, search-engine markup, the public booking feed, and CSV clinic import."""
from __future__ import annotations

import json

from tests.conftest import S, h1
from tests.test_staff import login, staff  # noqa: F401


def test_clinic_page_shows_clinicians_plans_and_schema_markup(client):
    r = client.get(S + "/book/provider?clinic=cl-sb")
    assert r.status_code == 200
    assert "Our clinicians" in r.text and 'class="clin"' in r.text and "Accepting new patients" in r.text
    assert 'itemtype="https://schema.org/MedicalClinic"' in r.text and 'itemprop="name"' in r.text and 'itemprop="streetAddress"' in r.text
    assert 'rel="alternate" type="application/json"' in r.text and "<script" not in r.text
    # picking a visit type leaves the overview: no microdata block, no clinician list
    v = client.get(S + "/book/provider?clinic=cl-sb&service=sv-pc-n")
    assert "Our clinicians" not in v.text and "MedicalClinic" not in v.text


def test_accepted_plans_follow_the_same_rule_as_booking(ctx):
    plans = ctx.catalog.clinic_plans("tn-north", "cl-sb")
    every = {r["name"] for r in ctx.db.all("SELECT name FROM insurers WHERE tenant_id = ?", "tn-north")}
    nets = ctx.db.all("SELECT insurer_id, clinic_id FROM insurer_networks WHERE tenant_id = ?", "tn-north")
    limited = {n["insurer_id"] for n in nets}
    expect = {r["name"] for r in ctx.db.all("SELECT id, name FROM insurers WHERE tenant_id = ?", "tn-north") if r["id"] not in limited or any(n["insurer_id"] == r["id"] and n["clinic_id"] == "cl-sb" for n in nets)}
    assert {p["name"] for p in plans} == expect and expect <= every


def test_public_feed_lists_clinics_and_open_times_without_personal_data(client):
    r = client.get(S + "/api/clinics.json")
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == "*" and "states" in r.json()
    cl = client.get(S + "/api/clinics.json?state=CA").json()["clinics"]
    assert cl and all(x["booking_url"].startswith("http") and "/book/provider?clinic=" in x["booking_url"] for x in cl)
    a = client.get(S + "/api/availability.json?clinic=cl-sb")
    assert a.status_code == 200
    body = a.json()
    slots = [s for v in body["visits"] for s in v["slots"]]
    assert slots and all("/book/details?" in s["booking_url"] and "T" in s["starts_at"] for s in slots)
    flat = json.dumps(body).lower()
    assert "email" not in flat and "patient" not in flat
    assert client.get(S + "/api/availability.json?clinic=nope-nope").status_code == 404
    assert client.get(S + "/api/availability.json?clinic=bad id!").status_code == 400


CSV_OK = "name,city,address,state,time_zone,phone,hours,photo_url\nRiver Clinic,Austin,5 River Rd,tx,America/Chicago,(512) 555-0100,Mon-Fri 8-5,https://img.example/r.jpg\nHill Clinic,Dallas,9 Hill St,TX,America/Chicago,,,\n"


def test_csv_import_is_all_or_nothing_hidden_and_safe_to_repeat(ctx, staff):
    boss = login(ctx, "boss@x.com")
    before = ctx.db.get("SELECT COUNT(*) AS n FROM clinics WHERE tenant_id = ?", "tn-north")["n"]
    bad = boss.post(S + "/staff/setup/import", data={"op": "save", "csv": CSV_OK + "Bad,Austin,1 A St,Texas,Mars/Base,12,,\n"})
    assert bad.status_code == 422 and "Line 4" in bad.text
    assert ctx.db.get("SELECT COUNT(*) AS n FROM clinics WHERE tenant_id = ?", "tn-north")["n"] == before          # nothing saved
    chk = boss.post(S + "/staff/setup/import", data={"op": "check", "csv": CSV_OK})
    assert chk.status_code == 200 and "2 new clinics ready" in chk.text
    assert ctx.db.get("SELECT COUNT(*) AS n FROM clinics WHERE tenant_id = ?", "tn-north")["n"] == before
    ok = boss.post(S + "/staff/setup/import", data={"op": "save", "csv": CSV_OK})
    assert ok.status_code == 200 and "Clinics imported" in ok.text
    rows = ctx.db.all("SELECT name, state_code, status, bookable, image_url FROM clinics WHERE tenant_id = ? AND name IN ('River Clinic','Hill Clinic') ORDER BY name", "tn-north")
    assert [r["name"] for r in rows] == ["Hill Clinic", "River Clinic"] and all(r["status"] == "inactive" and r["bookable"] == 0 and r["state_code"] == "TX" for r in rows)
    again = boss.post(S + "/staff/setup/import", data={"op": "check", "csv": CSV_OK})
    assert "0 new clinics" in again.text and "2 already exist" in again.text


def test_csv_import_is_admin_only_and_rejects_a_missing_header(ctx, staff):
    desk = login(ctx, "desk@x.com")
    assert desk.get(S + "/staff/setup/import").status_code == 403
    assert desk.post(S + "/staff/setup/import", data={"op": "save", "csv": CSV_OK}).status_code == 403
    boss = login(ctx, "boss@x.com")
    r = boss.post(S + "/staff/setup/import", data={"op": "save", "csv": "name,city\nA,B\n"})
    assert r.status_code == 422 and "missing: address, state, time_zone" in r.text
    assert h1(boss.get(S + "/staff/setup/import")) == "Import clinics"
