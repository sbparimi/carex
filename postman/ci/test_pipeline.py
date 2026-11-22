"""Offline control tests only. These fixtures are never release evidence."""

from __future__ import annotations

import hashlib
import io
import json
import tarfile
from datetime import datetime, timezone

import pipeline as p
import pytest
from guard_lab import validate


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "sqlite:///local.db",
        "postgresql://user:pw@localhost/db",
        "https://example.test",
    ],
)
def test_lab_guard_rejects_non_neon_targets(bad):
    with pytest.raises(ValueError):
        validate(bad, {})


def test_lab_guard_requires_exact_host_and_future_expiry():
    host = "ep-unit-fixture.neon.tech"
    config = {
        "hostnameSha256": hashlib.sha256(host.encode()).hexdigest(),
        "expiresAt": "2099-01-01T00:00:00+00:00",
    }
    value = "postgresql://unit:unit-fixture-only@" + host + "/carex_course_dev"
    assert validate(value, config)["databaseOpened"] is False
    with pytest.raises(ValueError):
        validate(value, config, datetime(2099, 1, 2, tzinfo=timezone.utc))
    with pytest.raises(ValueError):
        validate(value.replace(host, "ep-other-fixture.neon.tech"), config)
    with pytest.raises(ValueError):
        validate(value.replace("carex_course_dev", "other_database"), config)


def test_redaction_removes_connection_and_password():
    value = "postgresql://unit:unit%20fixture@example.neon.tech/lab"
    text = p.scrub(value + " password=unit%20fixture decoded=unit fixture", value)
    assert (
        value not in text
        and "unit%20fixture" not in text
        and "unit fixture" not in text
    )


def test_changed_lines_tracks_additions_not_deleted_or_context_lines():
    text = "diff --git a/carex/a.py b/carex/a.py\n+++ b/carex/a.py\n@@ -2,2 +2,3 @@\n old\n-deleted\n+new\n+next\n"
    assert p.changed_lines(text) == {"carex/a.py": {3, 4}}


@pytest.fixture
def archive(tmp_path, monkeypatch):
    monkeypatch.setattr(p, "OUT", tmp_path)
    monkeypatch.setattr(p, "identity", lambda: "unit-fixture-commit")
    return tmp_path


def make_archive(folder, name="carex/a.py", kind=tarfile.REGTYPE):
    path = folder / "candidate.tar"
    with tarfile.open(path, "w") as archive:
        member = tarfile.TarInfo(name)
        member.type = kind
        if kind == tarfile.REGTYPE:
            member.size = 4
            archive.addfile(member, io.BytesIO(b"pass"))
        else:
            member.linkname = "outside"
            archive.addfile(member)
    p.write(
        folder / "release.json",
        {"commit": "unit-fixture-commit", "sha256": p.digest(path)},
    )


def test_original_candidate_bytes_are_verified_and_extracted(archive):
    make_archive(archive)
    target = archive / "unpacked"
    p.unpack(target)
    assert (target / "carex/a.py").read_text() == "pass"


@pytest.mark.parametrize(
    "name,kind",
    [
        ("../escape.py", tarfile.REGTYPE),
        ("/absolute.py", tarfile.REGTYPE),
        ("linked.py", tarfile.SYMTYPE),
        ("linked.py", tarfile.LNKTYPE),
    ],
)
def test_archive_paths_and_links_fail_closed(archive, name, kind):
    make_archive(archive, name, kind)
    with pytest.raises(ValueError):
        p.unpack(archive / "unpacked")


def test_candidate_digest_mismatch_blocks_extraction(archive):
    make_archive(archive)
    with (archive / "candidate.tar").open("ab") as f:
        f.write(b"tampered")
    with pytest.raises(ValueError, match="digest"):
        p.unpack(archive / "unpacked")


def test_candidate_source_mismatch_blocks_extraction(archive, monkeypatch):
    make_archive(archive)
    monkeypatch.setattr(p, "identity", lambda: "other-commit")
    with pytest.raises(ValueError, match="commit"):
        p.unpack(archive / "unpacked")


def test_api_requests_cannot_target_other_repositories():
    with pytest.raises(ValueError):
        p.github("repos/another-owner/another-repo/actions/runs")


def test_recursive_dispatch_is_rejected_before_any_network_request(monkeypatch):
    monkeypatch.setenv("GITHUB_ACTOR", "github-actions[bot]")
    with pytest.raises(ValueError, match="Recursive"):
        p.dispatch_promotion()


@pytest.mark.parametrize("actor", ["sbparimi", "unknown-user", ""])
def test_human_actor_cannot_bypass_the_distinct_initiator_requirement(
    monkeypatch, actor
):
    monkeypatch.setenv("GITHUB_ACTOR", actor)
    with pytest.raises(ValueError, match="built-in"):
        p.validate_promotion()


def test_missing_reports_are_not_a_pass(tmp_path, monkeypatch):
    monkeypatch.setattr(p, "OUT", tmp_path)
    with pytest.raises(FileNotFoundError):
        p.gate()


def test_storage_confirmation_is_mandatory_before_network_requests(monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("FREE_STORAGE_CONFIRMED", raising=False)
    with pytest.raises(ValueError, match="allowance"):
        p.preflight()


def test_policy_preserves_proposed_thresholds_and_real_suite_size():
    policy = json.loads((p.ROOT / "postman/ci/quality-policy.json").read_text())
    assert policy["applicationLineCoveragePercent"] == 80
    assert policy["changedApplicationLineCoveragePercent"] == 90
    assert policy["minimumPytestTests"] == 155
    assert policy["unexpectedSkipsAllowed"] == 0


def test_guard_checks_messaging_credentials_before_database_use(monkeypatch):
    monkeypatch.setattr(p, "validate", lambda *_: None)
    monkeypatch.setenv("RESEND_API_KEY", "unit-fixture-no-live-credential")
    with pytest.raises(ValueError, match="Messaging"):
        p.bind_lab()


def test_application_environment_does_not_receive_the_delivery_token(monkeypatch):
    monkeypatch.setenv("GH_TOKEN", "unit-fixture-token-only")
    monkeypatch.setenv("RESEND_API_KEY", "unit-fixture-key-only")
    env = p.runtime_environment("unit-fixture-database", testing=True)
    assert "GH_TOKEN" not in env and "RESEND_API_KEY" not in env
    assert env["CAREX_TEST_DATABASE_URL"] == "unit-fixture-database"
