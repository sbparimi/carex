import sys
from types import SimpleNamespace

import pytest

import carex.db as db_module


class FakeCursor:
    def __init__(self, execute_calls, error=None):
        self.execute_calls = execute_calls
        self.error = error

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql):
        self.execute_calls.append(sql)
        if self.error is not None:
            raise self.error


class FakeConnection:
    def __init__(self, execute_calls, error=None):
        self.execute_calls = execute_calls
        self.error = error

    def cursor(self):
        return FakeCursor(self.execute_calls, self.error)


def test_open_pg_wires_checkout_check_and_preserves_pool_options(monkeypatch):
    captured = {}
    close_calls = []

    class FakePool:
        def __init__(self, *args, **kwargs):
            captured["args"] = args
            captured["kwargs"] = kwargs

        def close(self):
            close_calls.append(True)

    monkeypatch.setitem(
        sys.modules,
        "psycopg_pool",
        SimpleNamespace(ConnectionPool=FakePool),
    )

    url = "postgresql://user:password@example.neon.tech/db"
    db = db_module._open_pg(url)

    assert captured["args"] == (url,)
    options = captured["kwargs"]
    assert options["min_size"] == 0
    assert options["max_size"] == 5
    assert options["kwargs"] == {
        "autocommit": True,
        "prepare_threshold": None,
    }
    assert options["open"] is True
    assert options["timeout"] == 10

    check = options["check"]
    assert callable(check)

    calls = []
    check(FakeConnection(calls))
    assert calls == ["SELECT 1"]

    db.close()
    assert close_calls == [True]


def test_checkout_check_propagates_connection_failure(monkeypatch):
    captured = {}

    class FakePool:
        def __init__(self, *args, **kwargs):
            captured["kwargs"] = kwargs

        def close(self):
            pass

    monkeypatch.setitem(
        sys.modules,
        "psycopg_pool",
        SimpleNamespace(ConnectionPool=FakePool),
    )

    db_module._open_pg("postgresql://user:password@example.neon.tech/db")
    check = captured["kwargs"]["check"]

    failure = RuntimeError("simulated closed connection")
    with pytest.raises(RuntimeError, match="simulated closed connection"):
        check(FakeConnection([], error=failure))
