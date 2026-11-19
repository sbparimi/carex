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
    def get(self, sql, *params):
        if "SELECT id FROM users" in sql:
            return {"id": params[-1]}
        raise AssertionError(f"Unexpected query: {sql}")

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


def test_account_erasure_stops_when_upcoming_appointment_cannot_be_cancelled():
    audit = AuditSpy()
    privacy = Privacy(ErasureDb(), FailingScheduler(), audit)
    with pytest.raises(RuntimeError, match="appointment cancellation failed"):
        privacy.erase("tenant-1", "user-1")
    assert audit.events == []
