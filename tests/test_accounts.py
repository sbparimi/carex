"""Sign-up rules, login, lockout, sessions, second step, password reset."""
from __future__ import annotations

from datetime import timedelta

import pytest

from carex.accounts import AccountError, Accounts, hash_password, password_problem, verify_password
from conftest import Outbox

GOOD = dict(email="Ann@Example.com", password="correct horse 1", first_name="Ann", last_name="Lee", date_of_birth="1990-02-03", phone="555-123-4567", access_type="employer", access_id="em-n-1")


@pytest.fixture
def acc(ctx):
    return Accounts(ctx.db, ctx.clock, Outbox())


def fields(acc, **kw):
    with pytest.raises(AccountError) as e:
        acc.signup("tn-north", **{**GOOD, **kw})
    return e.value


def test_password_hashing_is_salted_and_verifiable():
    a, b = hash_password("correct horse 1"), hash_password("correct horse 1")
    assert a != b and a.startswith("scrypt$") and verify_password("correct horse 1", a) and not verify_password("wrong", a) and not verify_password("x", "garbage")


def test_password_rules():
    assert password_problem("short") and password_problem("a" * 129) and password_problem("aaaaaaaaaaaa") and password_problem("me@x.com", "me@x.com")
    assert password_problem("correct horse 1") is None


def test_signup_validates_each_field(acc):
    assert "email" in fields(acc, email="nope").fields and "password" in fields(acc, password="short").fields
    assert "first_name" in fields(acc, first_name=" ").fields and "date_of_birth" in fields(acc, date_of_birth="2020-01-01").fields
    assert "date_of_birth" in fields(acc, date_of_birth="1990-02-31").fields and "phone" in fields(acc, phone="x").fields
    assert "access" in fields(acc, access_id="em-b-1").fields                     # another tenant's employer
    assert "access" in fields(acc, access_type="neither").fields


def test_signup_normalises_email_and_blocks_duplicates(acc):
    p, token = acc.signup("tn-north", **GOOD)
    assert p["email"] == "ann@example.com" and len(token) == 43 and p["access"]["name"].startswith("Acme")
    e = fields(acc, email="ANN@example.com")
    assert e.code == "email_taken"
    acc.signup("tn-bay", **{**GOOD, "access_id": "em-b-1"})                       # same email in another tenant is a different account


def test_employer_verification_by_domain_and_roster(ctx, acc):
    ctx.db.run("UPDATE employers SET verification = 'domain', email_domain = 'acme.test' WHERE id = 'em-n-1'")
    assert "email" in fields(acc, email="ann@gmail.com").fields
    acc.signup("tn-north", **{**GOOD, "email": "ann@acme.test"})
    ctx.db.run("UPDATE employers SET verification = 'roster' WHERE id = 'em-n-2'")
    assert "email" in fields(acc, access_id="em-n-2", email="bob@x.com").fields
    ctx.db.run("INSERT INTO employer_roster (tenant_id, employer_id, email) VALUES ('tn-north','em-n-2','bob@x.com')")
    acc.signup("tn-north", **{**GOOD, "access_id": "em-n-2", "email": "bob@x.com"})


def test_login_and_generic_failures(acc):
    acc.signup("tn-north", **GOOD)
    p, token = acc.login("tn-north", "ann@example.com", "correct horse 1")
    assert acc.authenticate("tn-north", token)["id"] == p["id"]
    for email, pw in (("ann@example.com", "wrong password"), ("nobody@example.com", "correct horse 1")):
        with pytest.raises(AccountError) as e:
            acc.login("tn-north", email, pw)
        assert e.value.code == "invalid_credentials" and str(e.value) == "Invalid email or password"


def test_lockout_after_five_failures_then_recovers(ctx, acc, clock):
    acc.signup("tn-north", **GOOD)
    for _ in range(5):
        with pytest.raises(AccountError):
            acc.login("tn-north", "ann@example.com", "bad bad bad bad")
    with pytest.raises(AccountError) as e:
        acc.login("tn-north", "ann@example.com", "correct horse 1")
    assert e.value.code == "locked"
    clock.t += timedelta(minutes=16)
    assert acc.login("tn-north", "ann@example.com", "correct horse 1")


def test_sessions_are_tenant_scoped_idle_limited_and_absolute_limited(ctx, acc, clock):
    _, token = acc.signup("tn-north", **GOOD)
    assert acc.authenticate("tn-bay", token) is None and acc.authenticate("tn-north", "bad") is None and acc.authenticate("tn-north", None) is None
    clock.t += timedelta(minutes=29)
    assert acc.authenticate("tn-north", token)
    clock.t += timedelta(minutes=29)
    assert acc.authenticate("tn-north", token)                                      # activity keeps it alive
    clock.t += timedelta(minutes=31)
    assert acc.authenticate("tn-north", token) is None                              # idle 30 min
    _, token = acc.login("tn-north", "ann@example.com", "correct horse 1")
    for _ in range(50):
        clock.t += timedelta(minutes=29)
        acc.authenticate("tn-north", token)
    assert acc.authenticate("tn-north", token) is None                              # 24 h absolute


def test_logout_ends_the_session(acc):
    _, token = acc.signup("tn-north", **GOOD)
    acc.logout("tn-north", token)
    assert acc.authenticate("tn-north", token) is None


def test_second_step_code(ctx):
    mail = Outbox()
    acc = Accounts(ctx.db, ctx.clock, mail)
    ctx.db.run("UPDATE tenants SET mfa_required = 1")
    acc.signup("tn-north", **GOOD)
    r = acc.begin_login("tn-north", "ann@example.com", "correct horse 1")
    assert r["mfa"] and "token" not in r and len(mail.codes) == 1
    ch, code = r["mfa"]["challenge"], mail.codes[0][1]
    with pytest.raises(AccountError):
        acc.verify_login("tn-north", ch, "000000" if code != "000000" else "111111")
    profile, token = acc.verify_login("tn-north", ch, code)
    assert acc.authenticate("tn-north", token)["id"] == profile["id"]
    with pytest.raises(AccountError):
        acc.verify_login("tn-north", ch, code)                                      # single use
    with pytest.raises(AccountError):
        acc.login("tn-north", "ann@example.com", "correct horse 1")                 # plain login refuses to skip the step


def test_second_step_attempts_and_expiry(ctx, clock):
    mail = Outbox()
    acc = Accounts(ctx.db, ctx.clock, mail)
    ctx.db.run("UPDATE tenants SET mfa_required = 1")
    acc.signup("tn-north", **GOOD)
    ch = acc.begin_login("tn-north", "ann@example.com", "correct horse 1")["mfa"]["challenge"]
    wrong = "000000" if mail.codes[0][1] != "000000" else "111111"
    for _ in range(5):
        with pytest.raises(AccountError):
            acc.verify_login("tn-north", ch, wrong)
    with pytest.raises(AccountError):
        acc.verify_login("tn-north", ch, mail.codes[0][1])                          # five tries used up
    ch2 = acc.begin_login("tn-north", "ann@example.com", "correct horse 1")["mfa"]["challenge"]
    clock.t += timedelta(minutes=11)
    with pytest.raises(AccountError):
        acc.verify_login("tn-north", ch2, mail.codes[1][1])


def test_password_reset_is_single_use_expires_and_signs_out_everywhere(ctx, clock):
    mail = Outbox()
    acc = Accounts(ctx.db, ctx.clock, mail)
    _, session = acc.signup("tn-north", **GOOD)
    acc.request_reset("tn-north", "northwind-health", "nobody@example.com")
    assert mail.resets == []                                                        # unknown address: silent
    acc.request_reset("tn-north", "northwind-health", "ann@example.com")
    token = mail.resets[0][2]
    with pytest.raises(AccountError):
        acc.reset_password("tn-north", token, "short")
    acc.reset_password("tn-north", token, "a brand new passphrase")
    assert acc.authenticate("tn-north", session) is None
    assert acc.login("tn-north", "ann@example.com", "a brand new passphrase")
    with pytest.raises(AccountError) as e:
        acc.reset_password("tn-north", token, "another passphrase 22")
    assert e.value.code == "invalid_token"
    acc.request_reset("tn-north", "northwind-health", "ann@example.com")
    clock.t += timedelta(minutes=31)
    with pytest.raises(AccountError):
        acc.reset_password("tn-north", mail.resets[1][2], "yet another passphrase")
    with pytest.raises(AccountError):
        acc.reset_password("tn-bay", mail.resets[1][2], "yet another passphrase")


def test_notification_preferences(ctx, acc):
    p, _ = acc.signup("tn-north", **GOOD)
    assert p["notify"] == {"email": True, "sms": False}
    acc.set_notify("tn-north", p["id"], email=False, sms=True)
    assert acc.profile_by_id("tn-north", p["id"])["notify"] == {"email": False, "sms": True}
