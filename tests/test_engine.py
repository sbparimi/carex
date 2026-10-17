"""The scheduling engine: slot derivation rules, booking integrity, change rules."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest

from carex.scheduling import BookingNotFoundError, ChangeWindowClosedError, IdempotencyConflictError, ReserveInput, SlotTakenError
from carex.util import iso

Q = dict(tenant_id="tn-north", clinic_id="cl-sb", service_id="sv-pc-n", provider_id="pr-a")


def slots(ctx, **kw):
    return ctx.sched.list_slots(**{**Q, **kw})


def inp(slot, key="key-00001", **kw):
    return ReserveInput(Q["tenant_id"], Q["clinic_id"], Q["service_id"], Q["provider_id"], slot["id"], key, "Ann", "Lee", **kw)


def test_slots_follow_weekly_hours_in_clinic_time_zone(ctx):
    s = slots(ctx)
    assert s[0]["starts_at"] == "2026-10-19T16:00:00.000Z"        # Monday 9:00 PDT
    assert s[0]["time_zone"] == "America/Los_Angeles"
    assert all(a["starts_at"] < b["starts_at"] for a, b in zip(s, s[1:]))
    assert not any("2026-10-19T19:00" <= x["starts_at"] < "2026-10-19T20:00" for x in s)   # 12:00-13:00 PDT lunch gap
    local_hours = {(datetime.fromisoformat(x["starts_at"].replace("Z", "+00:00")) - timedelta(hours=7)).hour for x in s[:16]}
    assert local_hours <= {9, 10, 11, 13, 14, 15, 16}


def test_horizon_and_lead(ctx, clock):
    s = slots(ctx)
    assert s[-1]["starts_at"] < iso(clock() + timedelta(days=14))
    ctx.db.run("UPDATE visit_types SET min_lead_minutes = 24*60, horizon_days = 3 WHERE id = 'sv-pc-n'")
    s = slots(ctx)
    assert s[0]["starts_at"] >= iso(clock() + timedelta(hours=24)) and s[-1]["starts_at"] < iso(clock() + timedelta(days=3))


def test_booked_slot_disappears_and_cannot_be_booked_twice(ctx):
    s = slots(ctx)
    rec = ctx.sched.reserve(inp(s[0]))
    assert rec["status"] == "confirmed" and rec["booking_id"].startswith("CX-")
    assert s[0]["id"] not in {x["id"] for x in slots(ctx)}
    with pytest.raises(SlotTakenError):
        ctx.sched.reserve(inp(s[0], key="key-00002"))


def test_same_key_replays_and_a_changed_request_conflicts(ctx):
    s = slots(ctx)
    a = ctx.sched.reserve(inp(s[0]))
    assert ctx.sched.reserve(inp(s[0]))["booking_id"] == a["booking_id"]
    with pytest.raises(IdempotencyConflictError):
        ctx.sched.reserve(inp(s[1]))


def test_concurrent_requests_for_one_slot_produce_exactly_one_booking(ctx):
    s = slots(ctx)

    def go(i):
        try:
            return ctx.sched.reserve(inp(s[0], key=f"race-key-{i:04d}"))["booking_id"]
        except SlotTakenError:
            return None
    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(go, range(8)))
    assert len([r for r in results if r]) == 1


def test_overlapping_slots_cannot_both_book(ctx):
    ctx.db.run("UPDATE visit_types SET duration_min = 60 WHERE id = 'sv-physio-n'")
    q = dict(tenant_id="tn-north", clinic_id="cl-sb", service_id="sv-physio-n", provider_id="pr-b")
    first = ctx.sched.list_slots(**q)[0]
    ctx.sched.reserve(ReserveInput(*q.values(), first["id"], "k-over-0001", "A", "B"))
    nxt = {x["starts_at"] for x in ctx.sched.list_slots(**q)}
    assert first["starts_at"] not in nxt


def test_cancel_frees_the_slot_notes_late_cancel_and_is_idempotent(ctx):
    s = slots(ctx)
    rec = ctx.sched.reserve(inp(s[0]))
    done = ctx.sched.cancel("tn-north", rec["booking_id"], "plans changed")
    assert done["status"] == "cancelled"
    assert ctx.sched.cancel("tn-north", rec["booking_id"])["status"] == "cancelled"
    row = ctx.db.get("SELECT late_cancel, cancel_reason, cancelled_by FROM appointments WHERE id = ?", rec["booking_id"])
    assert row == {"late_cancel": 1, "cancel_reason": "plans changed", "cancelled_by": "patient"}    # 4 h before: inside the 24 h policy
    assert s[0]["id"] in {x["id"] for x in slots(ctx)}


def test_not_late_when_cancelled_well_ahead(ctx):
    s = slots(ctx)
    far = next(x for x in s if x["starts_at"] > iso(NOW_PLUS(ctx, days=5)))
    rec = ctx.sched.reserve(inp(far))
    ctx.sched.cancel("tn-north", rec["booking_id"])
    assert ctx.db.get("SELECT late_cancel FROM appointments WHERE id = ?", rec["booking_id"])["late_cancel"] == 0


def NOW_PLUS(ctx, **kw):
    return ctx.clock() + timedelta(**kw)


def test_patient_cannot_change_inside_the_notice_window_but_staff_can(ctx, clock):
    s = slots(ctx)
    rec = ctx.sched.reserve(inp(s[0]))
    clock.t = datetime(2026, 10, 19, 14, 30, tzinfo=timezone.utc)         # 90 minutes before the 16:00Z slot
    with pytest.raises(ChangeWindowClosedError):
        ctx.sched.cancel("tn-north", rec["booking_id"])
    with pytest.raises(ChangeWindowClosedError):
        ctx.sched.reschedule("tn-north", rec["booking_id"], s[5]["id"])
    assert ctx.sched.cancel("tn-north", rec["booking_id"], by="staff")["status"] == "cancelled"


def test_reschedule_keeps_the_reference_frees_the_old_time_and_refuses_taken_times(ctx):
    s = slots(ctx)
    a = ctx.sched.reserve(inp(s[3]))
    b = ctx.sched.reserve(inp(s[4], key="key-00002"))
    moved = ctx.sched.reschedule("tn-north", a["booking_id"], s[8]["id"])
    assert moved["booking_id"] == a["booking_id"] and moved["starts_at"] == s[8]["starts_at"]
    now_free = {x["id"] for x in slots(ctx)}
    assert s[3]["id"] in now_free and s[8]["id"] not in now_free
    with pytest.raises(SlotTakenError):
        ctx.sched.reschedule("tn-north", a["booking_id"], s[4]["id"])
    assert ctx.sched.get_booking("tn-north", a["booking_id"])["starts_at"] == s[8]["starts_at"]
    assert b["booking_id"] != a["booking_id"]


def test_time_off_and_clinic_closures_remove_slots(ctx):
    s = slots(ctx)
    day = s[0]["starts_at"][:10]
    ctx.db.run("INSERT INTO time_off (tenant_id, provider_id, starts_at, ends_at) VALUES (?,?,?,?)", "tn-north", "pr-a", f"{day}T00:00:00.000Z", f"{day}T23:59:00.000Z")
    assert not any(x["starts_at"].startswith(day) for x in slots(ctx))
    day2 = slots(ctx)[0]["starts_at"][:10]
    ctx.db.run("INSERT INTO clinic_closures (tenant_id, clinic_id, starts_at, ends_at, reason) VALUES (?,?,?,?,?)", "tn-north", "cl-sb", f"{day2}T00:00:00.000Z", f"{day2}T23:59:00.000Z", "holiday")
    assert not any(x["starts_at"].startswith(day2) for x in slots(ctx))


def test_buffers_keep_neighbouring_visits_apart(ctx):
    ctx.db.run("UPDATE visit_types SET buffer_after_min = 30 WHERE id = 'sv-pc-n'")
    s = slots(ctx)
    ctx.sched.reserve(inp(s[0]))
    starts = [x["starts_at"] for x in slots(ctx)]
    assert s[0]["starts_at"] not in starts and s[1]["starts_at"] not in starts and s[2]["starts_at"] in starts   # booked 9:00-9:30 + 30 min buffer holds 9:30


def test_rooms_are_shared_between_providers(ctx):
    ctx.db.run("UPDATE visit_types SET resource_kind = 'room' WHERE id = 'sv-physio-n'")
    ctx.db.run("INSERT INTO clinic_resources (id, tenant_id, clinic_id, kind, name) VALUES ('rm-1','tn-north','cl-sb','room','Room 1')")
    ctx.db.run("INSERT INTO provider_eligibility (tenant_id, clinic_id, visit_type_id, provider_id, active) VALUES ('tn-north','cl-sb','sv-physio-n','pr-a',1)")
    q = dict(tenant_id="tn-north", clinic_id="cl-sb", service_id="sv-physio-n")
    b_slot = next(x for x in ctx.sched.list_slots(**q, provider_id="pr-b") if x["starts_at"] == "2026-10-19T16:30:00.000Z")     # 9:30-10:15 PDT
    ctx.sched.reserve(ReserveInput(*q.values(), "pr-b", b_slot["id"], "room-k-0001", "A", "B"))
    overlapping = "2026-10-19T16:45:00.000Z"                          # Dr. A's 9:45-10:30 slot
    assert overlapping not in {x["starts_at"] for x in ctx.sched.list_slots(**q, provider_id="pr-a")}   # the only room is busy then
    ctx.db.run("INSERT INTO clinic_resources (id, tenant_id, clinic_id, kind, name) VALUES ('rm-2','tn-north','cl-sb','room','Room 2')")
    assert overlapping in {x["starts_at"] for x in ctx.sched.list_slots(**q, provider_id="pr-a")}       # a second room opens it back up


def test_a_visit_that_needs_a_room_has_no_slots_without_one(ctx):
    ctx.db.run("UPDATE visit_types SET resource_kind = 'room' WHERE id = 'sv-pc-n'")
    assert slots(ctx) == []


def test_daylight_saving_keeps_local_hours_stable(ctx, clock):
    clock.t = datetime(2027, 3, 10, 12, 0, tzinfo=timezone.utc)
    s = slots(ctx)
    starts = {x["starts_at"][:16] for x in s}
    assert "2027-03-12T17:00" in starts                              # Friday 9:00 PST (UTC-8)
    assert "2027-03-15T16:00" in starts                              # Monday 9:00 PDT (UTC-7)


def test_age_and_new_patient_rules(ctx):
    ctx.db.run("INSERT INTO employers (id, tenant_id, name) VALUES ('e1','tn-north','E')") if False else None
    from carex.accounts import Accounts
    adult, _ = Accounts(ctx.db, ctx.clock).signup("tn-north", email="a@x.com", password="correct horse 1", first_name="A", last_name="B", date_of_birth="1990-01-01", phone="555-111-2222", access_type="employer", access_id="em-n-1")
    ctx.db.run("UPDATE visit_types SET min_age = 65 WHERE id = 'sv-pc-n'")
    assert slots(ctx, user_id=adult["id"]) == []                     # 36 years old
    assert slots(ctx)                                                # anonymous listing is unfiltered...
    with pytest.raises(SlotTakenError):                              # ...but a booking without a patient is refused
        ctx.sched.reserve(inp(slots(ctx)[0]))
    ctx.db.run("UPDATE visit_types SET min_age = NULL, new_patients = 'established_only' WHERE id = 'sv-pc-n'")
    assert slots(ctx, user_id=adult["id"]) == []
    ctx.db.run("UPDATE visit_types SET new_patients = 'new_only' WHERE id = 'sv-pc-n'")
    assert slots(ctx, user_id=adult["id"])


def test_tenant_isolation(ctx):
    s = slots(ctx)
    assert ctx.sched.list_slots("tn-bay", "cl-sb", "sv-pc-n", "pr-a") == []
    other = ReserveInput("tn-bay", "cl-oak", "sv-pc-b", "pr-z", s[0]["id"], "k-iso-0001", "A", "B")
    with pytest.raises(SlotTakenError):
        ctx.sched.reserve(other)
    rec = ctx.sched.reserve(inp(s[0]))
    assert ctx.sched.get_booking("tn-bay", rec["booking_id"]) is None
    with pytest.raises(BookingNotFoundError):
        ctx.sched.cancel("tn-bay", rec["booking_id"])


def test_inactive_clinic_provider_and_unoffered_visit_have_no_slots(ctx):
    assert ctx.sched.list_slots("tn-north", "cl-fr", "sv-pc-n", "pr-a") == []        # inactive clinic
    assert ctx.sched.list_slots("tn-north", "cl-nb", "sv-pc-n", "pr-a") == []        # not bookable
    assert ctx.sched.list_slots("tn-north", "cl-sb", "sv-pc-n", "pr-gone") == []     # inactive provider
    assert ctx.sched.list_slots("tn-north", "cl-sb", "sv-vision-n", "pr-a") == []    # visit switched off at this clinic
