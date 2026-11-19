from __future__ import annotations

import pytest

from carex.audit import Audit, AuditWriteError
from carex.privacy import Privacy


class BrokenAuditDb:
    def run(self, *args, **kwargs):
        raise OSError("database unavailable")


def test_required_audit_write_failure_is_not_silently_swallowed():
    audit = Audit(BrokenAuditDb())
    with pytest.raises(AuditWriteError):
        audit.record("tenant-1", "staff", "patient.record.view", actor_id="staff-1", target_type="patient", target_id="patient-1")


class ErasureDb:
    def __init__(self):
        self.calls = []
        self.status = "active"
        self.finalized = False

    def tx(self):
        from contextlib import contextmanager
        @contextmanager
        def scope():
            yield self
        return scope()

    def get(self, sql, *params):
        if "SELECT closure_status FROM users" in sql:
            return {"closure_status": self.status}
        if "SELECT COUNT(*) AS n FROM appointments" in sql:
            return {"n": 0}
        raise AssertionError(f"Unexpected query: {sql}")

    def run(self, sql, *params):
        self.calls.append((sql, params))
        if "SET closure_status = 'pending'" in sql:
            self.status = "pending"
        if "closure_status = 'erased'" in sql:
            self.status = "erased"
        return 1

    def all(self, sql, *params):
        if "SELECT id FROM appointments" in sql:
            return [{"id": "appointment-1"}]
        raise AssertionError(f"Unexpected query: {sql}")


class FailingScheduler:
    def cancel(self, *args, **kwargs):
        raise RuntimeError("appointment cancellation failed")


class AuditSpy:
    def __init__(self):
        self.events = []

    def record(self, *args, **kwargs):
        self.events.append((args, kwargs))


def test_account_erasure_persists_pending_state_and_audit_before_cancellation_retry():
    db, audit = ErasureDb(), AuditSpy()
    privacy = Privacy(db, FailingScheduler(), audit)
    with pytest.raises(RuntimeError, match="appointment cancellation failed"):
        privacy.erase("tenant-1", "user-1")
    assert db.status == "pending"
    assert [event[0][2] for event in audit.events] == ["account.erase_requested"]
    assert audit.events[0][1]["db"] is db


def test_account_erasure_completion_is_audited_inside_final_transaction():
    db, audit = ErasureDb(), AuditSpy()

    class NoAppointments:
        def cancel(self, *args, **kwargs):
            raise AssertionError("No appointment should need cancellation")

    db.all = lambda sql, *params: []
    privacy = Privacy(db, NoAppointments(), audit)
    assert privacy.erase("tenant-1", "user-1") is True
    assert db.status == "erased"
    assert [event[0][2] for event in audit.events] == ["account.erase_requested", "account.erased"]
    assert all(event[1]["db"] is db for event in audit.events)

class AuditCaptureDb:
    def __init__(self):
        self.params = None

    def run(self, sql, *params):
        self.params = params
        return 1


def test_audit_detail_requires_an_exact_event_schema_and_valid_values():
    import json
    db = AuditCaptureDb()
    audit = Audit(db)
    audit.record("tenant-1", "admin", "export.fhir", detail={"count": 4})
    assert json.loads(db.params[-1]) == {"count": 4}
    with pytest.raises(ValueError, match="not allowed"):
        audit.record("tenant-1", "user", "user.login_failed", detail={"email": "patient@example.com"})
    with pytest.raises(ValueError, match="not allowed"):
        audit.record("tenant-1", "user", "unknown.event", detail={"text": "clinical free text"})
    with pytest.raises(ValueError, match="Unsupported audit actor"):
        audit.record("tenant-1", "patient", "booking.cancel")


def test_audit_detail_rejects_invalid_dates_and_negative_counts():
    audit = Audit(AuditCaptureDb())
    with pytest.raises(ValueError, match="Invalid audit date"):
        audit.record("tenant-1", "staff", "schedule.view", detail={"date": "not-a-date", "count": 1})
    with pytest.raises(ValueError, match="Invalid audit detail"):
        audit.record("tenant-1", "staff", "schedule.view", detail={"date": "2026-11-19", "count": -1})


def test_reservation_rejects_accounts_with_pending_closure():
    from contextlib import contextmanager
    from carex.scheduling import BookingNotFoundError, ReserveInput, Scheduling

    class ClosedAccountTx:
        kind = "sqlite"
        for_update = ""
        def get(self, sql, *params):
            if "idempotency_key" in sql:
                return None
            if "closure_status" in sql:
                return {"closure_status": "pending"}
            raise AssertionError(sql)
        def lock(self, key):
            pass

    class ClosedAccountDb:
        def tx(self):
            @contextmanager
            def scope():
                yield ClosedAccountTx()
            return scope()
        def is_unique(self, exc, index=None):
            return False

    inp = ReserveInput("tenant-1", "clinic", "service", "provider", "slot", "idem", "A", "B", user_id="user-1")
    with pytest.raises(BookingNotFoundError, match="not available"):
        Scheduling(ClosedAccountDb()).reserve(inp)
