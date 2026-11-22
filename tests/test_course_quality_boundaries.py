"""Privacy and configuration boundaries. No database or messaging service is used."""

from __future__ import annotations

import pytest

from carex.audit import Audit
from carex.ops import load_dotenv
from carex.privacy import Privacy
from tests.test_security_hardening import AuditSpy, ErasureDb


class NoAppointments:
    def cancel(self, *args, **kwargs):
        raise AssertionError("No cancellation was expected")


@pytest.mark.parametrize("phase", [1, 2])
@pytest.mark.parametrize("state,expected", [(None, False), ("erased", True)])
def test_erasure_handles_missing_or_completed_accounts_under_both_row_locks(
    phase, state, expected
):
    class TerminalDb(ErasureDb):
        reads = 0

        def get(self, sql, *params):
            if "SELECT closure_status" in sql:
                assert sql.endswith(" FOR UPDATE")
                self.reads += 1
                if self.reads == phase:
                    return None if state is None else {"closure_status": state}
            return super().get(sql, *params)

        def all(self, sql, *params):
            return []

    db, audit = TerminalDb(), AuditSpy()
    assert (
        Privacy(db, NoAppointments(), audit).erase("synthetic-tenant", "synthetic-user")
        is expected
    )
    assert not any(event[0][2] == "account.erased" for event in audit.events)


def test_erasure_rejects_an_unexpected_state_instead_of_anonymizing():
    class ChangedState(ErasureDb):
        reads = 0

        def get(self, sql, *params):
            if "SELECT closure_status" in sql:
                self.reads += 1
                if self.reads == 2:
                    return {"closure_status": "unexpected"}
            return super().get(sql, *params)

        def all(self, sql, *params):
            return []

    db, audit = ChangedState(), AuditSpy()
    with pytest.raises(RuntimeError, match="state changed"):
        Privacy(db, NoAppointments(), audit).erase("synthetic-tenant", "synthetic-user")
    assert db.status == "pending"
    assert not any(event[0][2] == "account.erased" for event in audit.events)


def test_erasure_refuses_completion_when_confirmed_appointments_remain():
    class RemainingAppointment(ErasureDb):
        def get(self, sql, *params):
            if "SELECT COUNT(*) AS n FROM appointments" in sql:
                return {"n": 1}
            return super().get(sql, *params)

        def all(self, sql, *params):
            return []

    db, audit = RemainingAppointment(), AuditSpy()
    db.status = "pending"
    with pytest.raises(RuntimeError, match="appointments remain"):
        Privacy(db, NoAppointments(), audit).erase("synthetic-tenant", "synthetic-user")
    assert db.status == "pending"
    assert not audit.events


def test_export_of_a_missing_account_does_not_return_partial_records():
    class MissingAccount:
        def get(self, *args):
            return None

    assert (
        Privacy(MissingAccount(), NoAppointments(), AuditSpy()).export(
            "synthetic-tenant", "missing"
        )
        == {}
    )


@pytest.mark.parametrize(
    "action,detail",
    [
        ("schedule.view", {"date": 123, "count": 0}),
        ("user.login_failed", {"identifier_hash": "g" * 12}),
        ("appointment.status", {"status": "not-a-real-status"}),
        (
            "export.csv",
            {"from": "\U0001f9ea" * 32, "to": "\U0001f9ea" * 32, "count": 1},
        ),
    ],
)
def test_audit_rejects_malformed_typed_or_oversized_details_before_writing(
    action, detail
):
    class MustNotWrite:
        def run(self, *args):
            raise AssertionError("Invalid detail reached storage")

    with pytest.raises(ValueError):
        Audit(MustNotWrite()).record(
            "synthetic-tenant", "system", action, detail=detail
        )


def test_dotenv_keeps_existing_environment_values_and_ignores_malformed_lines(
    tmp_path, monkeypatch
):
    path = tmp_path / "synthetic.env"
    path.write_text(
        "# comment\nCAREX_UNIT_EXISTING=from-file\nCAREX_UNIT_NEW='synthetic-value'\nnot an assignment\n"
    )
    monkeypatch.setenv("CAREX_UNIT_EXISTING", "from-environment")
    monkeypatch.delenv("CAREX_UNIT_NEW", raising=False)
    load_dotenv(str(path))
    import os

    assert os.environ["CAREX_UNIT_EXISTING"] == "from-environment"
    assert os.environ["CAREX_UNIT_NEW"] == "synthetic-value"
