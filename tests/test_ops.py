"""Health check, scheduled dispatch, operator API and the command-line tool."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from carex import ops
from carex.app import create_app
from carex.catalog import seed_db
from carex.context import build
from carex.seed import synthetic_catalog
from tests.conftest import NOW, S, Outbox, Clock

SECRET = "cron-secret-for-tests-0123456789"


@pytest.fixture
def cx(db):
    seed_db(db, synthetic_catalog())
    return build(db=db, env={"CRON_SECRET": SECRET}, clock=Clock(), mailer=Outbox())


@pytest.fixture
def web(cx):
    return TestClient(create_app(cx), base_url="http://testserver", follow_redirects=False)


def test_healthz_ok_and_503_when_the_database_is_down(cx):
    c = TestClient(create_app(cx), base_url="http://testserver")
    assert c.get("/healthz").json() == {"status": "ok"}
    cx.db.close() if cx.db.__class__.__name__ == "SqliteConn" and False else None

    class Broken:
        def get(self, *a, **k):
            raise RuntimeError("db down")
    real, cx.db = cx.db, Broken()
    try:
        r = c.get("/healthz")
        assert r.status_code == 503 and r.json() == {"status": "unavailable"} and "db down" not in r.text
    finally:
        cx.db = real


def test_dispatch_endpoint_needs_the_cron_secret(web, cx):
    assert web.post("/internal/dispatch").status_code == 401
    assert web.post("/internal/dispatch", headers={"authorization": "Bearer wrong"}).status_code == 401
    r = web.post("/internal/dispatch", headers={"authorization": f"Bearer {SECRET}"})
    assert r.status_code == 200 and set(r.json()) == {"sent", "skipped", "failed", "retried"}


def test_dispatch_endpoint_is_off_when_no_secret_is_configured(ctx):
    c = TestClient(create_app(ctx), base_url="http://testserver")
    assert c.post("/internal/dispatch", headers={"authorization": "Bearer anything"}).status_code == 404


def test_seed_demo_endpoint_is_protected_and_only_fills_an_empty_database(web, cx):
    assert web.post("/internal/seed-demo").status_code == 401
    assert web.post("/internal/seed-demo", headers={"authorization": "Bearer wrong"}).status_code == 401
    r = web.post("/internal/seed-demo", headers={"authorization": f"Bearer {SECRET}"})
    assert r.status_code == 409 and r.json()["status"] == "refused"      # the test database already has tenants


def test_seed_demo_endpoint_seeds_an_empty_database(monkeypatch):
    from carex.context import build
    from carex.db import open_db
    c = build(db=open_db(path=":memory:"), env={"CRON_SECRET": SECRET})
    w = TestClient(create_app(c), base_url="http://testserver")
    r = w.post("/internal/seed-demo", headers={"authorization": f"Bearer {SECRET}"})
    assert r.status_code == 200 and r.json()["status"] == "seeded" and r.json()["clinics"] > 1000
    assert w.post("/internal/seed-demo", headers={"authorization": f"Bearer {SECRET}"}).status_code == 409


def test_admin_api_requires_a_key_for_that_tenant_only(web, cx):
    key = cx.admin_keys.create("tn-north", "ci")
    h = {"authorization": f"Bearer {key}"}
    assert web.get(S + "/api/admin/clinics").status_code == 401
    assert web.get(S + "/api/admin/clinics", headers={"authorization": "Bearer cxa_nope"}).status_code == 401
    r = web.get(S + "/api/admin/clinics", headers=h)
    assert r.status_code == 200 and r.json()["clinics"]
    other = cx.db.get("SELECT slug FROM tenants WHERE slug <> 'northwind-health'")
    if other:
        assert web.get(f"/t/{other['slug']}/api/admin/clinics", headers=h).status_code == 401


def test_admin_api_creates_staff_and_lists_audit(web, cx):
    h = {"authorization": f"Bearer {cx.admin_keys.create('tn-north', 'ci')}"}
    r = web.post(S + "/api/admin/staff", headers=h, json={"email": "new@x.com", "name": "New Person", "role": "front_desk", "password": "a long enough pass"})
    assert r.status_code == 201 and "password" not in r.text
    assert any(s["email"] == "new@x.com" for s in web.get(S + "/api/admin/staff", headers=h).json()["staff"])
    assert web.post(S + "/api/admin/staff", headers=h, json={"email": "bad", "role": "king"}).status_code == 400
    assert web.get(S + "/api/admin/audit", headers=h).status_code == 200
    assert web.get(S + "/api/admin/fhir/Appointment?from=2026-10-01&to=2027-01-01", headers=h).json()["resourceType"] == "Bundle"


def test_revoked_keys_stop_working(web, cx):
    key = cx.admin_keys.create("tn-north", "temp")
    cx.admin_keys.revoke_by_label("tn-north", "temp")
    assert web.get(S + "/api/admin/clinics", headers={"authorization": f"Bearer {key}"}).status_code == 401


def test_login_attempts_are_rate_limited(web):
    codes = {web.post(S + "/login", data={"email": "a@b.co", "password": "x" * 12}).status_code for _ in range(15)}
    assert 429 in codes


def test_errors_are_json_for_api_and_html_for_pages(web):
    assert web.get("/t/northwind-health/api/admin/nope").headers["content-type"].startswith("application/json")
    r = web.get("/t/nope/login")
    assert r.headers["content-type"].startswith("text/html") and "Traceback" not in r.text


def test_cli_creates_tenant_and_seeds_demo(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("CAREX_DB", str(tmp_path / "t.db"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.chdir(tmp_path)
    assert ops.main(["create-tenant", "acme-care", "Acme Care", "#336699"]) == 0
    assert ops.main(["create-tenant", "Bad Slug", "x", "#336699"]) == 1
    assert ops.main(["admin-key", "acme-care", "ci"]) == 0
    assert "cxa_" in capsys.readouterr().out
    assert ops.main(["seed-demo", "--yes"]) == 1                      # refuses: already has tenants
    monkeypatch.setenv("CAREX_DB", str(tmp_path / "fresh.db"))
    assert ops.main(["seed-demo"]) == 1                               # needs --yes
    assert ops.main(["seed-demo", "--yes"]) == 0
    assert ops.main(["dispatch"]) == 0


def test_production_context_hides_demo_access_and_seed_route(cx):
    production = build(db=cx.db, env={"CRON_SECRET": SECRET}, clock=Clock(), mailer=Outbox(), production=True)
    assert production.hide_demo is True
    client = TestClient(create_app(production), base_url="http://testserver", follow_redirects=False)
    response = client.post("/internal/seed-demo", headers={"authorization": f"Bearer {SECRET}"})
    assert response.status_code == 404


def test_staff_admin_mutation_rolls_back_when_required_audit_fails(cx, monkeypatch):
    from carex.audit import AuditWriteError

    client = TestClient(create_app(cx), base_url="http://testserver", raise_server_exceptions=False)
    headers = {"authorization": f"Bearer {cx.admin_keys.create('tn-north', 'audit-failure-test')}"}
    before = cx.db.get("SELECT COUNT(*) AS n FROM staff_users WHERE tenant_id = ?", "tn-north")["n"]

    def fail_audit(*args, **kwargs):
        raise AuditWriteError("audit store unavailable")

    monkeypatch.setattr(cx.audit, "record", fail_audit)
    response = client.post(S + "/api/admin/staff", headers=headers,
                           json={"email": "atomic@example.com", "name": "Atomic User", "role": "front_desk", "password": "a long enough pass"})
    after = cx.db.get("SELECT COUNT(*) AS n FROM staff_users WHERE tenant_id = ?", "tn-north")["n"]
    assert response.status_code == 500
    assert after == before


def test_pending_account_cannot_reuse_an_existing_session(cx):
    profile, token = cx.accounts.signup(
        "tn-north", email="closure@example.com", password="a long enough pass",
        first_name="Closure", last_name="Test", date_of_birth="1990-01-01",
        phone="555-123-4567", access_type="employer", access_id="em-n-1",
    )
    assert profile and cx.accounts.authenticate("tn-north", token)
    cx.db.run("UPDATE users SET closure_status = 'pending' WHERE tenant_id = ? AND id = ?", "tn-north", profile["id"])
    assert cx.accounts.authenticate("tn-north", token) is None


def test_signup_rolls_back_user_and_session_when_audit_fails(cx, monkeypatch):
    from carex.audit import AuditWriteError

    def fail_audit(*args, **kwargs):
        raise AuditWriteError("audit store unavailable")

    monkeypatch.setattr(cx.audit, "record", fail_audit)
    before = cx.db.get("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?", "tn-north")["n"]
    with pytest.raises(AuditWriteError):
        cx.accounts.signup(
            "tn-north", email="signup-atomic@example.com", password="a long enough pass",
            first_name="Atomic", last_name="Signup", date_of_birth="1990-01-01",
            phone="555-123-4567", access_type="employer", access_id="em-n-1",
        )
    after = cx.db.get("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?", "tn-north")["n"]
    assert after == before
    assert cx.db.get("SELECT 1 AS ok FROM users WHERE tenant_id = ? AND email = ?", "tn-north", "signup-atomic@example.com") is None


def test_practice_category_catalog_and_patient_discovery_are_tenant_scoped(cx):
    categories = {row["code"]: row["label"] for row in cx.admin.practice_types()}
    assert set(categories) == {
        "physiotherapy", "dental", "fitness", "primary_care", "womens_wellness", "general_health"
    }
    north = {row["code"] for row in cx.catalog.practice_types("tn-north")}
    assert north == {"physiotherapy", "fitness", "womens_wellness", "general_health", "primary_care"}
    physio_clinics = cx.catalog.clinics_for_practice("tn-north", "physiotherapy")
    assert [row["id"] for row in physio_clinics] == ["cl-sb"]
    assert {row["code"] for row in physio_clinics[0]["practice_types"]} >= {"physiotherapy", "primary_care"}
    assert cx.catalog.clinics_for_practice("tn-north", "dental") == []
    assert [row["id"] for row in cx.catalog.clinics_for_practice("tn-bay", "dental")] == ["cl-oak"]


def test_clinic_practice_category_changes_are_validated_and_audited_atomically(cx):
    cx.admin.set_clinic_practice_types(
        "tn-north", "cl-sb", ["dental", "womens_wellness"], actor_id="staff-test"
    )
    assert set(cx.admin.clinic_practice_types("tn-north", "cl-sb")) == {"dental", "womens_wellness"}
    event = cx.db.get(
        "SELECT action, target_type, target_id FROM audit_log WHERE tenant_id = ? ORDER BY id DESC LIMIT 1",
        "tn-north",
    )
    assert event == {"action": "setup.clinic_update", "target_type": "clinic", "target_id": "cl-sb"}
    from carex.admin import AdminNotFoundError, AdminValidationError
    with pytest.raises(AdminValidationError):
        cx.admin.set_clinic_practice_types("tn-north", "cl-sb", ["not-a-practice"], actor_id="staff-test")
    assert set(cx.admin.clinic_practice_types("tn-north", "cl-sb")) == {"dental", "womens_wellness"}
    with pytest.raises(AdminNotFoundError):
        cx.admin.set_clinic_practice_types("tn-bay", "cl-sb", ["dental"], actor_id="staff-test")


def test_patient_finder_renders_practice_categories_and_filters_clinics(web):
    landing = web.get(S + "/book")
    assert landing.status_code == 200
    for label in ("Physiotherapy", "Fitness", "Primary care", "Women’s wellness", "General health"):
        assert label in landing.text
    filtered = web.get(S + "/book?practice=physiotherapy")
    assert filtered.status_code == 200 and "San Bernardo Clinic" in filtered.text
    assert "Austin Clinic" not in filtered.text
    assert "Physiotherapy" in filtered.text


def test_practice_category_update_rolls_back_if_audit_write_fails(cx, monkeypatch):
    from carex.audit import AuditWriteError

    before = cx.admin.clinic_practice_types("tn-north", "cl-sb")

    def fail_audit(*args, **kwargs):
        raise AuditWriteError("audit store unavailable")

    monkeypatch.setattr(cx.audit, "record", fail_audit)
    with pytest.raises(AuditWriteError):
        cx.admin.set_clinic_practice_types(
            "tn-north", "cl-sb", ["dental", "womens_wellness"], actor_id="staff-test"
        )
    assert cx.admin.clinic_practice_types("tn-north", "cl-sb") == before
