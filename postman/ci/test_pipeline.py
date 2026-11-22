"""Offline control tests only. These fixtures are never release evidence."""

from __future__ import annotations

import hashlib
import io
import json
import os
import tarfile
import urllib.error
from datetime import UTC, datetime

import pipeline as p
import pytest
from guard_lab import validate


@pytest.fixture(autouse=True)
def isolate_live_ci_summary(monkeypatch):
    """Offline fixtures must never append simulated results to a real run summary."""
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)


def test_offline_controls_cannot_inherit_live_summary_output():
    assert "GITHUB_STEP_SUMMARY" not in os.environ


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
        validate(value, config, datetime(2099, 1, 2, tzinfo=UTC))
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


@pytest.mark.parametrize(
    "path",
    [
        "repos/another-owner/another-repo/actions/runs",
        f"repos/{p.REPO}-other",
        f"repos/{p.REPO}/",
    ],
)
def test_api_requests_reject_wrong_repositories_and_noncanonical_root(path):
    with pytest.raises(ValueError):
        p.github(path)


def test_repository_metadata_uses_the_exact_canonical_endpoint(monkeypatch):
    requests = []

    def open_fixture(request, timeout):
        requests.append((request.full_url, timeout))
        return io.BytesIO(b'{"private": false}')

    monkeypatch.setattr(p.urllib.request, "urlopen", open_fixture)
    assert p.github(f"repos/{p.REPO}") == {"private": False}
    assert requests == [("https://api.github.com/repos/sbparimi/carex", 30)]


def test_http_error_keeps_status_but_never_response_body_or_credentials(monkeypatch):
    private_fixture = "unit-fixture-response-should-not-print"

    def reject_fixture(*args, **kwargs):
        raise urllib.error.HTTPError(
            "https://api.github.com/repos/sbparimi/carex",
            404,
            private_fixture,
            {},
            io.BytesIO(private_fixture.encode()),
        )

    monkeypatch.setattr(p.urllib.request, "urlopen", reject_fixture)
    with pytest.raises(ValueError) as error:
        p.github(f"repos/{p.REPO}")
    assert str(error.value) == "GitHub API HTTP 404"
    assert private_fixture not in str(error.value)


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


@pytest.mark.parametrize(
    "path",
    [
        "repos/sbparimi/carex/actions/runs/123/pending_deployments",
        "repos/sbparimi/carex/environments/course-isolated-lab",
        "repos/sbparimi/carex/pulls/1/merge",
    ],
)
def test_delivery_helper_rejects_approval_settings_and_merge_writes(path):
    with pytest.raises(ValueError, match="Only built-in"):
        p.github(path, data={"ref": p.BRANCH, "inputs": {"mode": "promote-lab"}})


def test_delivery_helper_rejects_dispatch_to_main():
    with pytest.raises(ValueError, match="Only built-in"):
        p.github(
            f"repos/{p.REPO}/actions/workflows/ci.yml/dispatches",
            data={"ref": "main", "inputs": {"mode": "promote-lab"}},
        )


def test_lab_window_requires_exact_source_and_45_minute_headroom():
    config = {"sourceBranch": p.BRANCH, "expiresAt": "2099-01-01T01:00:00+00:00"}
    p.validate_lab_window(config, datetime(2099, 1, 1, 0, 0, tzinfo=UTC))
    with pytest.raises(ValueError, match="45 minutes"):
        p.validate_lab_window(config, datetime(2099, 1, 1, 0, 15, tzinfo=UTC))
    with pytest.raises(ValueError, match="another source"):
        p.validate_lab_window(
            {**config, "sourceBranch": "main"},
            datetime(2099, 1, 1, tzinfo=UTC),
        )


@pytest.mark.parametrize(
    "key",
    [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "POSTMAN_API_KEY",
        "RESEND_API_KEY",
        "SMTP_PASSWORD",
        "TWILIO_AUTH_TOKEN",
    ],
)
def test_named_credentials_rejected_before_github_reads(monkeypatch, key):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("GITHUB_EVENT_NAME", "workflow_dispatch")
    monkeypatch.setenv("FREE_STORAGE_CONFIRMED", "true")
    monkeypatch.setattr(p, "validate_lab_window", lambda _: None)
    monkeypatch.setenv(key, "unit-fixture-no-live-secret")
    with pytest.raises(ValueError, match="credential present"):
        p.preflight()


def test_non_dispatch_event_rejected_before_lab_or_network_reads(monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("GITHUB_EVENT_NAME", "push")
    monkeypatch.setenv("FREE_STORAGE_CONFIRMED", "true")
    with pytest.raises(ValueError, match="Manual dispatch"):
        p.preflight()


@pytest.fixture
def full_stage_context(archive, monkeypatch):
    make_archive(archive)
    release = json.loads((archive / "release.json").read_text())
    p.write(
        archive / "gate.json",
        {
            "gate": "passed",
            "commit": release["commit"],
            "candidateSha256": release["sha256"],
        },
    )
    for key, value in {
        "GITHUB_REPOSITORY": p.REPO,
        "GITHUB_REF": "refs/heads/" + p.BRANCH,
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_ACTOR": "github-actions[bot]",
        "GITHUB_JOB": "deploy",
        "GITHUB_RUN_ID": "456",
        "LAUNCHER_RUN_ID": "123",
    }.items():
        monkeypatch.setenv(key, value)
    common = {
        "head_sha": "unit-fixture-commit",
        "head_branch": p.BRANCH,
        "event": "workflow_dispatch",
    }
    launcher = {
        **common,
        "path": ".github/workflows/ci.yml",
        "actor": {"login": "fixture-owner"},
        "status": "completed",
        "conclusion": "success",
    }
    current = {
        **common,
        "path": ".github/workflows/dispatch.yml",
        "actor": {"login": "github-actions[bot]"},
    }
    jobs = [
        {"name": name, "status": "completed", "conclusion": "success", "steps": []}
        for name in ("Develop", "Build", "Test", "Deploy")
    ]
    data = {
        f"repos/{p.REPO}/actions/runs/123": launcher,
        f"repos/{p.REPO}/actions/runs/456": current,
        f"repos/{p.REPO}/actions/runs/456/jobs?per_page=100": {
            "total_count": 4,
            "jobs": jobs,
        },
    }
    monkeypatch.setattr(p, "github", lambda path: data[path])
    return data, launcher, current, jobs


def test_same_run_candidate_requires_all_native_stages(full_stage_context):
    p.validate_current_candidate()


@pytest.mark.parametrize("name", ["Develop", "Build", "Test"])
def test_failed_prior_stage_blocks_same_run_deploy(full_stage_context, name):
    jobs = full_stage_context[3]
    next(j for j in jobs if j["name"] == name)["conclusion"] = "failure"
    with pytest.raises(ValueError, match="prior stage"):
        p.validate_current_candidate()


def test_same_run_candidate_tampering_is_rejected(full_stage_context, archive):
    with (archive / "candidate.tar").open("ab") as f:
        f.write(b"unit-fixture-tamper")
    with pytest.raises(ValueError, match="digest"):
        p.validate_current_candidate()


@pytest.mark.parametrize("actor", ["fixture-owner", ""])
def test_full_execution_cannot_be_human_started(full_stage_context, monkeypatch, actor):
    monkeypatch.setenv("GITHUB_ACTOR", actor)
    with pytest.raises(ValueError, match="built-in"):
        p.validate_launch()


def test_launcher_commit_must_match_execution(full_stage_context):
    full_stage_context[1]["head_sha"] = "other-fixture-source"
    with pytest.raises(ValueError, match="source mismatch"):
        p.validate_launch()


def test_launcher_must_have_succeeded(full_stage_context):
    full_stage_context[1]["conclusion"] = "failure"
    with pytest.raises(ValueError, match="successfully"):
        p.validate_launch()


def test_wrong_launcher_workflow_is_rejected(full_stage_context):
    full_stage_context[1]["path"] = ".github/workflows/unrelated.yml"
    with pytest.raises(ValueError, match="launcher workflow"):
        p.validate_launch()


def test_full_execution_workflow_must_match(full_stage_context):
    full_stage_context[2]["path"] = ".github/workflows/ci.yml"
    with pytest.raises(ValueError, match="Execution source"):
        p.validate_current_candidate()


def test_deployment_requires_its_own_job_context(full_stage_context, monkeypatch):
    monkeypatch.setenv("GITHUB_JOB", "test")
    with pytest.raises(ValueError, match="Deploy job"):
        p.validate_current_candidate()


def test_native_lane_summary_uses_only_named_checks_and_labels_snapshot(
    full_stage_context, capsys
):
    full_stage_context[3][0]["steps"] = [
        {
            "name": "<b>untrusted label</b>",
            "status": "completed",
            "conclusion": "failure",
        }
    ]
    full_stage_context[3][3]["status"] = "waiting"
    p.stage_summary()
    text = capsys.readouterr().out
    assert text.count("<th>") == 4
    assert "untrusted label" not in text
    assert "NOT REPORTED" in text
    assert text.index("CareX API candidate") < text.index("Stage checks")
    assert "retained snapshot, not a live dashboard" in text
    assert "live four-job graph above is authoritative" in text


def test_missing_summary_stage_never_becomes_green(full_stage_context, capsys):
    full_stage_context[3].pop()
    p.stage_summary()
    assert "NOT STARTED" in capsys.readouterr().out


def test_duplicate_native_summary_stage_is_rejected(full_stage_context):
    full_stage_context[3].append(full_stage_context[3][0].copy())
    with pytest.raises(ValueError, match="Ambiguous"):
        p.stage_summary()


def test_recursive_full_pipeline_launch_stops_before_network(monkeypatch):
    monkeypatch.setenv("GITHUB_JOB", "launch")
    monkeypatch.setenv("GITHUB_ACTOR", "github-actions[bot]")
    with pytest.raises(ValueError, match="Recursive"):
        p.start_pipeline()


def test_exactly_four_native_jobs_keep_human_gate_and_read_only_tokens():
    import yaml

    workflow = yaml.safe_load((p.ROOT / ".github/workflows/dispatch.yml").read_text())
    jobs = workflow["jobs"]
    assert list(jobs) == ["develop", "build", "test", "deploy"]
    assert [j["name"] for j in jobs.values()] == ["Develop", "Build", "Test", "Deploy"]
    assert jobs["build"]["needs"] == "develop"
    assert jobs["test"]["needs"] == "build"
    assert jobs["deploy"]["needs"] == "test"
    assert jobs["deploy"]["environment"]["name"] == "course-isolated-lab"
    assert all(
        j["permissions"] == {"contents": "read", "actions": "read"}
        for j in jobs.values()
    )
    test_steps = jobs["test"]["steps"]
    assert any(s.get("run") == "python postman/ci/pipeline.py gate" for s in test_steps)
    assert "APP_URL" not in json.dumps(workflow) and "CRON_SECRET" not in json.dumps(
        workflow
    )
    assert "schedule" not in workflow["on"]


def test_manual_entry_is_scoped_launcher_not_production_dispatch():
    import yaml

    workflow = yaml.safe_load((p.ROOT / ".github/workflows/ci.yml").read_text())
    assert list(workflow["jobs"]) == ["launch"]
    assert workflow["jobs"]["launch"]["permissions"]["actions"] == "write"
    assert "python postman/ci/pipeline.py launch" in json.dumps(workflow)
    assert "APP_URL" not in json.dumps(workflow) and "CRON_SECRET" not in json.dumps(
        workflow
    )


def test_delivery_helper_allows_only_exact_scoped_stage_launch(monkeypatch):
    requests = []
    for key, value in {
        "GITHUB_JOB": "launch",
        "GITHUB_ACTOR": "fixture-owner",
        "GITHUB_RUN_ID": "123",
    }.items():
        monkeypatch.setenv(key, value)

    def open_fixture(request, timeout):
        requests.append(
            (request.full_url, request.get_method(), json.loads(request.data))
        )
        return io.BytesIO(b"")

    monkeypatch.setattr(p.urllib.request, "urlopen", open_fixture)
    body = {
        "ref": p.BRANCH,
        "inputs": {
            "launcher_run_id": "123",
            "expected_health_status": "200",
            "free_storage_confirmed": "true",
        },
    }
    assert (
        p.github(f"repos/{p.REPO}/actions/workflows/dispatch.yml/dispatches", data=body)
        is None
    )
    assert requests == [
        (
            "https://api.github.com/repos/sbparimi/carex/actions/workflows/dispatch.yml/dispatches",
            "POST",
            body,
        )
    ]
    body["inputs"]["launcher_run_id"] = "999"
    with pytest.raises(ValueError, match="Only built-in"):
        p.github(f"repos/{p.REPO}/actions/workflows/dispatch.yml/dispatches", data=body)
    assert len(requests) == 1


def test_launcher_sends_once_after_preflight(monkeypatch):
    calls = []
    env = {
        "GITHUB_JOB": "launch",
        "GITHUB_ACTOR": "fixture-owner",
        "GITHUB_RUN_ID": "123",
        "GITHUB_ACTIONS": "true",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REPOSITORY": p.REPO,
        "GITHUB_REF": "refs/heads/" + p.BRANCH,
        "EXPECTED_HEALTH_STATUS": "200",
    }
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(p, "preflight", lambda: calls.append("preflight"))
    monkeypatch.setattr(p, "github", lambda path, data: calls.append((path, data)))
    p.start_pipeline()
    assert calls[0] == "preflight" and len(calls) == 2
    assert calls[1][1]["inputs"]["launcher_run_id"] == "123"


def test_launcher_wrong_scope_stops_before_preflight(monkeypatch):
    monkeypatch.setenv("GITHUB_JOB", "launch")
    monkeypatch.setenv("GITHUB_ACTOR", "fixture-owner")
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    with pytest.raises(ValueError, match="launcher scope"):
        p.start_pipeline()


def test_missing_native_deploy_job_is_rejected(full_stage_context):
    full_stage_context[3][3]["name"] = "unexpected"
    with pytest.raises(ValueError, match="four native"):
        p.validate_current_candidate()


def test_detailed_output_is_log_only_unless_explicitly_published(tmp_path, monkeypatch):
    path = tmp_path / "summary.md"
    path.write_text("sentinel\n")
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(path))
    p.summary("offline diagnostic")
    assert path.read_text() == "sentinel\n"
    p.summary("real publication", publish=True)
    assert path.read_text() == "sentinel\nreal publication\n"


def test_stage_snapshot_is_published_only_once_by_test():
    import yaml

    workflow = yaml.safe_load((p.ROOT / ".github/workflows/dispatch.yml").read_text())
    publishers = [
        name
        for name, job in workflow["jobs"].items()
        for step in job["steps"]
        if "stage-summary" in step.get("run", "")
    ]
    assert publishers == ["test"]
    assert all(
        "GITHUB_STEP_SUMMARY" not in step.get("run", "")
        for job in workflow["jobs"].values()
        for step in job["steps"]
    )


def test_all_published_checks_match_explicit_native_step_names(
    full_stage_context, capsys
):
    import yaml

    workflow = yaml.safe_load((p.ROOT / ".github/workflows/dispatch.yml").read_text())
    for job in full_stage_context[3]:
        job["steps"] = [
            {"name": step["name"], "status": "completed", "conclusion": "success"}
            for step in workflow["jobs"][job["name"].lower()]["steps"]
            if "name" in step
        ]
    p.stage_summary()
    text = capsys.readouterr().out
    assert "NOT REPORTED" not in text
    assert "Retain the candidate: <strong>PASS</strong>" in text
    assert "<strong>RUNNING</strong>" not in text
