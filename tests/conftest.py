"""Test fixtures use a dedicated, empty Neon test database. Never point this at production."""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from carex.app import create_app
from carex.catalog import seed_db
from carex.context import build
from carex.db import open_db
from carex.seed import synthetic_catalog

# Monday 2026-10-19 12:00 UTC (5 am Pacific): a stable "now" for slot maths.
NOW = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
PG = os.environ.get("CAREX_TEST_DATABASE_URL")
S = "/t/northwind-health"


class Clock:
    def __init__(self, t=NOW):
        self.t = t

    def __call__(self):
        return self.t


_pg = {}


def _fresh_db():
    if not PG:
        pytest.skip("Set CAREX_TEST_DATABASE_URL to a dedicated Neon test branch.")
    if "db" not in _pg:
        _pg["db"] = open_db(url=PG)
    db = _pg["db"]
    tables = [r["tablename"] for r in db.all("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'carex_migrations'")]
    if tables:
        db.run("TRUNCATE " + ", ".join(tables) + " RESTART IDENTITY CASCADE")
    return db


@pytest.fixture
def db():
    return _fresh_db()


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def ctx(db, clock):
    seed_db(db, synthetic_catalog())
    return build(db=db, env={"CAREX_SOONEST_TTL": "0"}, clock=clock, mailer=Outbox())


class Outbox:
    """Captures account emails instead of sending them."""
    def __init__(self):
        self.resets, self.codes = [], []

    def send_password_reset(self, to, slug, token):
        self.resets.append((to, slug, token))

    def send_login_code(self, to, tenant_name, code):
        self.codes.append((to, code))


@pytest.fixture
def client(ctx):
    return TestClient(create_app(ctx), base_url="http://testserver", follow_redirects=True)


def h1(r) -> str:
    m = re.search(r"<h1[^>]*>(.*?)</h1>", r.text, re.S)
    return re.sub(r"<[^>]+>", "", m.group(1)).strip() if m else ""


def hidden(r) -> dict:
    return dict(re.findall(r'<input type="hidden" name="(\w+)" value="([^"]*)"', r.text))


def banners(r) -> list[str]:
    return [re.sub(r"<[^>]+>", "", x).strip() for x in re.findall(r'<div class="banner[^"]*"[^>]*>(.*?)</div>', r.text, re.S)]


SIGNUP = dict(door="employer", access_id="em-n-1", first_name="Ann", last_name="Lee", date_of_birth="1990-02-03", phone="555-123-4567", email="ann@example.com", password="correct horse 1")


@pytest.fixture
def signed_in(client):
    r = client.post(S + "/signup", data=SIGNUP)
    assert r.status_code == 200 and h1(r) == "Find care"
    return client


def first_slot(c, clinic="cl-sb", service="sv-physio-n", provider="pr-b"):
    from urllib.parse import unquote
    page = c.get(f"{S}/book/provider?clinic={clinic}&service={service}&provider={provider}")
    return unquote(re.findall(r'slot=([^"&]+)', page.text)[0])


def book_through_pages(c, intake=True, **over):
    """Drives details -> review -> confirm for pr-b physio at San Bernardo; returns (confirm response, form values)."""
    slot = first_slot(c)
    d = dict(clinic="cl-sb", service="sv-physio-n", provider="pr-b", slot=slot, reason="Sore knee", modality="in_person", consent="v1")
    d.update(over)
    review = c.post(S + "/book/review", data=d)
    if h1(review) != "Review and confirm":
        return review, d
    return c.post(S + "/book/confirm", data=hidden(review)), d


def pytest_sessionfinish(session, exitstatus):
    if "db" in _pg:
        _pg["db"].close()


@pytest.fixture
def demo(db, clock):
    """The full demo catalog (20+ clinics in every state) with a signed-in demo patient."""
    from carex.seed_demo import DEMO_PASSWORD, load_demo, seed_demo_people
    load_demo(db)
    seed_demo_people(db, clock)
    c = build(db=db, env={"CAREX_SOONEST_TTL": "0"}, clock=clock, mailer=Outbox())
    cl = TestClient(create_app(c), base_url="http://testserver", follow_redirects=True)
    r = cl.post(S + "/login", data={"email": "alex.demo@example.test", "password": DEMO_PASSWORD})
    assert r.status_code == 200
    return cl, c
