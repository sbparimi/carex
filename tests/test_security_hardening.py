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
