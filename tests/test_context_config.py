from __future__ import annotations

import pytest

from carex.context import _neon_database_url


def test_neon_database_url_prefers_a_pooled_neon_endpoint():
    env = {
        "DATABASE_URL": "postgresql://user:pass@ep-direct.us-east-1.aws.neon.tech/carex",
        "POSTGRES_URL": "postgresql://user:pass@ep-pooler.us-east-1.aws.neon.tech/carex",
    }
    assert _neon_database_url(env) == env["POSTGRES_URL"]


def test_neon_database_url_falls_back_to_neon_integration_variables():
    env = {
        "POSTGRES_URL": "postgresql://user:pass@ep-pooler.us-east-1.aws.neon.tech/carex",
    }
    assert _neon_database_url(env) == env["POSTGRES_URL"]


def test_neon_database_url_rejects_non_neon_and_missing_values():
    with pytest.raises(RuntimeError, match="Neon PostgreSQL connection URL"):
        _neon_database_url({"DATABASE_URL": "postgresql://user:pass@localhost/carex"})
    with pytest.raises(RuntimeError, match="Neon PostgreSQL connection URL"):
        _neon_database_url({})
