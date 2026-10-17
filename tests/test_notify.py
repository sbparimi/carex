"""Outbox, reminders, dispatch, vendor failures, opt-in rules, waiting list."""
from __future__ import annotations

from datetime import timedelta

import pytest

from carex.accounts import Accounts
from carex.notify import Channels, Notifier
from carex.scheduling import ReserveInput
from carex.waitlist import WaitlistError


class Sink:
    def __init__(self):
        self.emails, self.texts, self.fail = [], [], 0

    def channels(self):
        def email(to, subject, text):
            if self.fail:
                self.fail -= 1
                raise RuntimeError("email provider returned 500")
            self.emails.append((to, subject, text))

        def sms(to, text):
            self.texts.append((to, text))
        return Channels(base_url="https://app.example.test", email=email, sms=sms)


@pytest.fixture
def world(ctx):
    sink = Sink()
    acc = Accounts(ctx.db, ctx.clock)
    p, _ = acc.signup("tn-north", email="u@x.com", password="correct horse 1", first_name="Una", last_name="User", date_of_birth="1990-01-01", phone="+1 555 111 2222", access_type="employer", access_id="em-n-1")
    return ctx, sink, p, Notifier(ctx.db, sink.channels(), ctx.clock)


def book(ctx, p, idx=10, key="k-notify-0001"):
    s = ctx.sched.list_slots("tn-north", "cl-sb", "sv-pc-n", "pr-a")[idx]
    return ctx.sched.reserve(ReserveInput("tn-north", "cl-sb", "sv-pc-n", "pr-a", s["id"], key, "Una", "User", "u@x.com", "+1 555 111 2222", user_id=p["id"])), s


def test_booking_queues_a_confirmation_and_two_reminders_in_the_same_transaction(world):
    ctx, sink, p, n = world
    rec, s = book(ctx, p, 40)
    kinds = sorted({r["kind"] for r in ctx.db.all("SELECT kind FROM outbox WHERE appointment_id = ?", rec["booking_id"])})
    assert kinds == ["confirmation", "reminder_24h", "reminder_2h"]
    assert ctx.db.get("SELECT COUNT(*) AS n FROM outbox WHERE appointment_id = ?", rec["booking_id"])["n"] == 6          # email + sms each


def test_email_goes_out_but_sms_needs_opt_in(world):
    ctx, sink, p, n = world
    rec, _ = book(ctx, p, 40)
    res = n.dispatch()
    assert res["sent"] == 1 and len(sink.emails) == 1 and sink.texts == []
    to, subject, text = sink.emails[0]
    assert to == "u@x.com" and subject.startswith("Appointment confirmed") and rec["booking_id"] not in text and "/t/northwind-health/m/" in text and "911" in text
    ctx.accounts.set_notify("tn-north", p["id"], sms=True)
    book(ctx, p, 41, "k-notify-0002")
    n.dispatch()
    assert len(sink.texts) == 1 and sink.texts[0][0] == "+1 555 111 2222"


def test_reminders_wait_until_due_and_are_skipped_after_cancellation(world):
    ctx, sink, p, n = world
    rec, s = book(ctx, p, 100)
    n.dispatch()
    assert [e[1].split(" —")[0] for e in sink.emails] == ["Appointment confirmed"]
    ctx.sched.cancel("tn-north", rec["booking_id"])
    ctx.clock.t = ctx.clock() + timedelta(days=30)
    res = n.dispatch()
    assert any("cancelled" in e[1] for e in sink.emails)
    assert all("Reminder" not in e[1] for e in sink.emails)
    assert ctx.db.get("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'")["n"] == 0


def test_reminders_after_reschedule_follow_the_new_time(world):
    ctx, sink, p, n = world
    rec, s = book(ctx, p, 100)
    new = ctx.sched.list_slots("tn-north", "cl-sb", "sv-pc-n", "pr-a")[130]
    ctx.sched.reschedule("tn-north", rec["booking_id"], new["id"])
    rows = ctx.db.all("SELECT kind, status, send_after FROM outbox WHERE appointment_id = ? AND kind = 'reminder_24h' AND channel = 'email' ORDER BY id", rec["booking_id"])
    assert [r["status"] for r in rows] == ["skipped", "pending"] and rows[1]["send_after"] < new["starts_at"]


def test_vendor_failures_retry_with_backoff_then_give_up(world):
    ctx, sink, p, n = world
    book(ctx, p, 40)
    sink.fail = 99
    assert n.dispatch()["retried"] == 1
    assert n.dispatch()["sent"] == 0                                                  # not due again yet: backoff
    for _ in range(6):
        ctx.clock.t = ctx.clock() + timedelta(hours=1)
        n.dispatch()
    row = ctx.db.get("SELECT status, attempts, last_error FROM outbox WHERE kind = 'confirmation' AND channel = 'email'")
    assert row["status"] == "failed" and row["attempts"] == 5 and "500" in row["last_error"]


def test_unconfigured_channels_are_skipped_with_a_reason_not_lost_silently(world):
    ctx, sink, p, n = world
    book(ctx, p, 40)
    res = Notifier(ctx.db, Channels(base_url="x"), ctx.clock).dispatch()
    assert res["skipped"] >= 2
    reasons = {r["last_error"] for r in ctx.db.all("SELECT last_error FROM outbox WHERE status = 'skipped'")}
    assert reasons >= {"email_not_configured", "sms_not_configured"}


def test_two_workers_never_send_the_same_message_twice(world):
    ctx, sink, p, n = world
    book(ctx, p, 40)
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(lambda _: n.dispatch(), range(4)))
    assert len(sink.emails) == 1


def test_staff_booked_patient_without_account_gets_direct_messages_only_with_consent(world):
    ctx, sink, p, n = world
    s = ctx.sched.list_slots("tn-north", "cl-sb", "sv-pc-n", "pr-a")[50]
    rec = ctx.sched.reserve(ReserveInput("tn-north", "cl-sb", "sv-pc-n", "pr-a", s["id"], "staff-k-00001", "Walk", "In", "walk@x.com", "+1 555 000 1111", booked_by="staff", staff_id="st_1", sms_ok=False))
    n.dispatch()
    assert [e[0] for e in sink.emails] == ["walk@x.com"] and sink.texts == []


def test_waitlist_join_notify_on_cancel_and_leave(world):
    ctx, sink, p, n = world
    rec, s = book(ctx, p, 100)
    other, _ = Accounts(ctx.db, ctx.clock).signup("tn-north", email="w@x.com", password="correct horse 1", first_name="Wil", last_name="Wait", date_of_birth="1990-01-01", phone="555-111-3333", access_type="employer", access_id="em-n-1")
    e = ctx.waitlist.join("tn-north", other["id"], "cl-sb", "sv-pc-n", "pr-a")
    assert ctx.waitlist.join("tn-north", other["id"], "cl-sb", "sv-pc-n", "pr-a")["id"] == e["id"]      # no duplicates
    ctx.sched.cancel("tn-north", rec["booking_id"])
    n.dispatch()
    assert any(to == "w@x.com" and "A time opened up" in sub for to, sub, _ in sink.emails)
    assert ctx.waitlist.list("tn-north", other["id"])[0]["status"] == "notified"
    assert ctx.waitlist.leave("tn-north", other["id"], e["id"]) and ctx.waitlist.list("tn-north", other["id"]) == []


def test_waitlist_rules(world):
    ctx, sink, p, n = world
    with pytest.raises(WaitlistError):
        ctx.waitlist.join("tn-north", p["id"], "cl-sb", "sv-vision-n")                  # visit off at that clinic
    with pytest.raises(WaitlistError):
        ctx.waitlist.join("tn-north", p["id"], "cl-sb", "sv-pc-n", "pr-b")              # provider doesn't see that visit
    assert not ctx.waitlist.leave("tn-north", "someone-else", 1)


def test_booking_the_visit_satisfies_the_waitlist(world):
    ctx, sink, p, n = world
    ctx.waitlist.join("tn-north", p["id"], "cl-sb", "sv-pc-n")
    book(ctx, p, 60)
    assert ctx.waitlist.list("tn-north", p["id"]) == []
