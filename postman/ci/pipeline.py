"""Course-only delivery controls. Never changes a repository setting or approves a run."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from pathlib import Path

from guard_lab import validate

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "course-ci-output"
BRANCH = "course/agentic-sdlc-api-automation"
REPO = "sbparimi/carex"
BASE = "1ca151e37b1a975e5ffeb8fc3effc02ff049fe6c"
ENVIRONMENT = "course-isolated-lab"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def command(args, *, cwd=ROOT, env=None, check=True):
    return subprocess.run(
        args, cwd=cwd, env=env, text=True, capture_output=True, check=check
    )


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def identity():
    return command(["git", "rev-parse", "HEAD"]).stdout.strip()


def summary(text):
    print(text)
    if path := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(path, "a") as f:
            f.write(text + "\n")


def bind_lab():
    value = os.environ.get("DATABASE_URL", "")
    validate(value, json.loads((ROOT / "postman/ci/lab.json").read_text()))
    require(
        os.environ.get("GITHUB_REF", "refs/heads/" + BRANCH) == "refs/heads/" + BRANCH,
        "Wrong branch",
    )
    for key in ("RESEND_API_KEY", "SMTP_PASSWORD", "TWILIO_AUTH_TOKEN"):
        require(not os.environ.get(key), "Messaging credentials must be absent")
    return value


def github(path, *, data=None):
    repo_path = f"repos/{REPO}"
    require(
        path == repo_path or path.startswith(repo_path + "/"),
        "Unexpected repository API target",
    )
    require(not path.endswith("/"), "GitHub API path must use its canonical endpoint")
    if data is not None:
        require(
            path == f"repos/{REPO}/actions/workflows/ci.yml/dispatches"
            and data.get("ref") == BRANCH
            and data.get("inputs", {}).get("mode") == "promote-lab",
            "Only built-in course lab dispatch is allowed; no approval or settings writes",
        )
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "CareX-course-pipeline",
    }
    if token := os.environ.get("GH_TOKEN"):
        headers["Authorization"] = "Bearer " + token
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(
        "https://api.github.com/" + path, data=body, headers=headers
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = response.read()
            return json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        raise ValueError(f"GitHub API HTTP {status}") from None


def validate_lab_window(lab, now=None):
    require(lab["sourceBranch"] == BRANCH, "Lab binding names another source branch")
    require(
        (now or datetime.now(UTC)) + timedelta(minutes=45)
        < datetime.fromisoformat(lab["expiresAt"]),
        "Less than 45 minutes remain before disposable lab expiry; do not start",
    )


def preflight():
    require(os.environ.get("GITHUB_REPOSITORY", REPO) == REPO, "Wrong repository")
    require(
        os.environ.get("GITHUB_REF", "refs/heads/" + BRANCH) == "refs/heads/" + BRANCH,
        "Wrong branch",
    )
    if os.environ.get("GITHUB_ACTIONS"):
        require(
            os.environ.get("FREE_STORAGE_CONFIRMED") == "true",
            "Check account-wide free artifact allowance before starting",
        )
        require(
            os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch",
            "Manual dispatch entry point required",
        )
    validate_lab_window(json.loads((ROOT / "postman/ci/lab.json").read_text()))
    for key in (
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "POSTMAN_API_KEY",
        "RESEND_API_KEY",
        "SMTP_PASSWORD",
        "TWILIO_AUTH_TOKEN",
    ):
        require(
            not os.environ.get(key),
            "Unapproved model, Postman or messaging credential present",
        )
    if os.environ.get("GITHUB_ACTIONS"):
        repo = github(f"repos/{REPO}")
        require(
            repo["private"] is False,
            "Free standard-runner assumption requires a public repository",
        )
        artifacts = github(f"repos/{REPO}/actions/artifacts?per_page=100")
        require(
            artifacts["total_count"] <= 100,
            "Artifact inventory exceeds this bounded budget check",
        )
        caches = github(f"repos/{REPO}/actions/cache/usage")
        require(
            caches["active_caches_size_in_bytes"] + 500_000_000 <= 10_000_000_000,
            "Insufficient room in the included cache envelope",
        )
        used = sum(
            a["size_in_bytes"] for a in artifacts["artifacts"] if not a["expired"]
        )
        require(
            used + 25_000_000 <= 100_000_000,
            "Course repository artifact envelope exceeded",
        )
    summary(
        "### Preflight: constraints and limits\n"
        "**Enforced:** exact repository/course branch; public repository for standard free runners; "
        "bounded artifact/cache checks; at least 45 minutes before bound lab expiry at start; "
        "exact Neon endpoint/database and expiry checked again before database access; "
        "no injected credentials under the six named model/Postman/messaging keys. Mandatory coverage, assertions, skips, "
        "source and candidate digest gates remain unchanged.\n\n"
        "**Human boundary:** successful gates automatically dispatch the built-in lab promotion; "
        "the protected course-isolated-lab job waits for native human approval. "
        "This code never approves. The GitHub helper permits only the scoped promotion dispatch "
        "as a write, not settings or deployment-review writes. Workflow tokens cannot merge main.\n\n"
        "**Documented/account checks:** account-wide artifact allowance needs the dispatch confirmation; "
        "repository limits cannot prove another repository has not consumed it. No paid use is authorized. "
        "No new secret, OAuth, settings, branch or main merge is part of this workflow. "
        "Postman Agent Mode and browser Copilot author/review are separately started manual sessions, "
        "not unattended CI model calls. Their credits and consent are not read or reset here; stop "
        "those sessions on quota/auth failures, never substitute a fake agent result. "
        "The lab API stops after smoke checks; staging and production are DRY RUN ONLY. "
        "The read-only board uses anonymous reads and 10-minute visible-page refresh; public REST "
        "quota is shared per IP. No promise of unlimited storage, AI, real-time updates or permanent hosting."
    )


def build():
    OUT.mkdir(exist_ok=True)
    path = OUT / "candidate.tar"
    with path.open("wb") as f:
        subprocess.run(
            [
                "git",
                "archive",
                "--format=tar",
                "HEAD",
                "carex",
                "api",
                "tests",
                "postman/ci",
                "requirements.txt",
                "requirements-dev.txt",
                "pyproject.toml",
            ],
            cwd=ROOT,
            stdout=f,
            check=True,
        )
    require(
        path.stat().st_size <= 20_000_000,
        "Candidate exceeds the zero-spend artifact size envelope",
    )
    manifest = {
        "commit": identity(),
        "sha256": digest(path),
        "bytes": path.stat().st_size,
        "branch": BRANCH,
        "scope": "Synthetic course lab only",
        "provenance": "Unsigned source/build manifest, not an attestation",
    }
    write(OUT / "release.json", manifest)
    inventory = []
    for line in (ROOT / "postman/ci/requirements-test.lock").read_text().splitlines():
        if match := re.match(r"^([a-zA-Z0-9_.\[\]-]+)==([^ ;\\]+)", line):
            inventory.append({"name": match[1], "version": match[2]})
    write(
        OUT / "dependency-inventory.json",
        {
            "sourceCommit": identity(),
            "lockSha256": digest(ROOT / "postman/ci/requirements-test.lock"),
            "packages": inventory,
        },
    )
    summary(
        f"### Build once\nCandidate `{manifest['sha256']}` from `{manifest['commit']}`. The inventory and unsigned manifest are retained with it. Test and deploy consume these same bytes."
    )


def unpack(destination):
    manifest = json.loads((OUT / "release.json").read_text())
    require(
        manifest["commit"] == identity(),
        "Candidate commit differs from the checked-out source",
    )
    require(
        manifest["sha256"] == digest(OUT / "candidate.tar"), "Candidate digest mismatch"
    )
    with tarfile.open(OUT / "candidate.tar") as archive:
        for member in archive.getmembers():
            require(
                not member.name.startswith("/") and ".." not in Path(member.name).parts,
                "Unsafe archive path",
            )
            require(
                member.isfile() or member.isdir(),
                "Links and special files are not accepted",
            )
        archive.extractall(destination, filter="data")
    return manifest


def scrub(text, value):
    from urllib.parse import unquote, urlsplit

    text = text.replace(value, "<redacted-lab-connection>")
    password = urlsplit(value).password
    if password:
        text = text.replace(password, "<redacted>").replace(
            unquote(password), "<redacted>"
        )
    return text


def runtime_environment(value, *, testing=False):
    allowed = ("PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "SYSTEMROOT")
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    env.update(DATABASE_URL=value, CAREX_ENV="course-isolated-lab")
    if testing:
        env["CAREX_TEST_DATABASE_URL"] = value
    return env


def prepare_data(value, candidate):
    """The exact lab guard must pass before the intentionally destructive reset."""
    bind_lab()
    script = """from carex.db import open_db
from carex.catalog import seed_db
from carex.seed import synthetic_catalog
import os
with_url = os.environ['DATABASE_URL']
db = open_db(with_url)
try:
    names = [r['tablename'] for r in db.all("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename <> 'carex_migrations'")]
    if names:
        from psycopg import sql
        import psycopg
        with psycopg.connect(with_url, autocommit=True) as connection:
            connection.execute(sql.SQL('TRUNCATE {} RESTART IDENTITY CASCADE').format(sql.SQL(',').join(sql.Identifier(n) for n in names)))
    seed_db(db, synthetic_catalog())
    assert db.get('SELECT COUNT(*) AS n FROM tenants')['n'] > 0
finally:
    db.close()
"""
    result = command(
        [sys.executable, "-c", script],
        cwd=candidate,
        env=runtime_environment(value),
        check=False,
    )
    require(
        result.returncode == 0,
        "Synthetic fixture preparation failed; no API tests started",
    )
    write(
        OUT / "test/data-preparation.json",
        {
            "guard": "passed",
            "source": "carex.seed.synthetic_catalog",
            "realDataCopied": False,
            "scope": "exact expiring course Neon branch",
        },
    )


def api_smoke(candidate, value, report_folder):
    env = runtime_environment(value)
    log = tempfile.TemporaryFile(mode="w+")
    process = subprocess.Popen(
        [sys.executable, "-m", "carex.ops", "serve", "--port", "8130"],
        cwd=candidate,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    try:
        ready = command(
            [sys.executable, str(ROOT / "postman/ci/wait_api.py")],
            cwd=ROOT,
            check=False,
        )
        require(ready.returncode == 0, "Packaged API did not become ready")
        cli = os.environ.get("POSTMAN_CLI", "postman")
        result = command(
            [
                cli,
                "collection",
                "run",
                "postman/ci/CareX-CI-Contract.postman_collection.json",
                "-e",
                "postman/ci/CareX-CI.postman_environment.json",
                "--env-var",
                "expectedHealthStatus="
                + os.environ.get("EXPECTED_HEALTH_STATUS", "200"),
                "--output",
                str(report_folder),
                "--no-upload-request-bodies",
                "--no-upload-response-bodies",
                "--no-upload-headers",
                "--no-upload-all-headers-and-bodies",
            ],
            cwd=ROOT,
            check=False,
        )
        print(scrub(result.stdout, value))
        require(
            result.returncode == 0, "Postman CLI reported a failed request/assertion"
        )
        result = command(
            [
                sys.executable,
                "postman/ci/verify_evidence.py",
                str(report_folder),
                "--output",
                str(report_folder.parent / "postman-evidence.json"),
            ],
            check=False,
        )
        require(
            result.returncode == 0,
            "Native Postman evidence was missing, skipped, stale or failed",
        )
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        log.close()


def tests():
    value = bind_lab()
    folder = OUT / "test"
    folder.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="carex-tested-candidate-") as temp:
        candidate = Path(temp)
        unpack(candidate)
        env = runtime_environment(value, testing=True)
        args = [
            sys.executable,
            "-m",
            "pytest",
            "tests",
            "--cov=carex",
            "--cov=api",
            "--cov-report=json:" + str(folder / "coverage.json"),
            "--junitxml=" + str(folder / "pytest.xml"),
            "-q",
        ]
        result = command(args, cwd=candidate, env=env, check=False)
        (folder / "pytest.log").write_text(scrub(result.stdout + result.stderr, value))
        print(scrub(result.stdout[-6000:], value))
        require(
            result.returncode == 0,
            "Full pytest suite failed; inspect the retained sanitized report",
        )
        for path in folder.glob("*.xml"):
            path.write_text(scrub(path.read_text(), value))
        prepare_data(value, candidate)
        api_smoke(candidate, value, folder / "postman")
    summary(
        "### Test\nThe built candidate, not a rebuilt checkout, ran the complete pytest suite against the guarded Neon branch. Synthetic fixtures were prepared separately for the real Postman contract run. API processes were stopped in a finally block. Reports are inputs to the separate gate job."
    )


def changed_lines(diff):
    files, current, line = {}, None, 0
    for text in diff.splitlines():
        if text.startswith("+++ b/"):
            current = text[6:]
            files.setdefault(current, set())
        elif match := re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", text):
            line = int(match[1])
        elif current and text.startswith("+") and not text.startswith("+++"):
            files[current].add(line)
            line += 1
        elif not text.startswith("-") and not text.startswith("\\"):
            line += 1
    return files


def gate():
    policy = json.loads((ROOT / "postman/ci/quality-policy.json").read_text())
    folder = OUT / "test"
    tree = ET.parse(folder / "pytest.xml").getroot()
    suites = [tree] if tree.tag == "testsuite" else list(tree.findall("testsuite"))
    count = sum(int(s.get("tests", 0)) for s in suites)
    require(
        count >= policy["minimumPytestTests"],
        "Mandatory pytest suite was not fully exercised",
    )
    cases = list(tree.iter("testcase"))
    require(len(cases) == count, "JUnit summary and actual test case count differ")
    require(
        len({(case.get("classname"), case.get("name")) for case in cases}) == count,
        "Duplicate test cases cannot satisfy the mandatory suite size",
    )
    for key in ("failures", "errors", "skipped"):
        require(
            sum(int(s.get(key, 0)) for s in suites) == 0, "Unexpected pytest " + key
        )
    coverage = json.loads((folder / "coverage.json").read_text())
    total = coverage["totals"]["percent_covered"]
    require(
        total >= policy["applicationLineCoveragePercent"],
        "Overall application coverage is below the approved threshold",
    )
    diff = command(
        ["git", "diff", "--unified=0", BASE, "HEAD", "--", "carex", "api"]
    ).stdout
    changed = changed_lines(diff)
    executed, missed = 0, 0
    for name, lines in changed.items():
        data = coverage["files"].get(name)
        if not name.endswith(".py"):
            continue
        require(
            data is not None, "Changed production Python file is absent from coverage"
        )
        executed += len(lines & set(data["executed_lines"]))
        missed += len(lines & set(data["missing_lines"]))
    percent = 100 * executed / (executed + missed) if executed + missed else None
    require(
        percent is None or percent >= policy["changedApplicationLineCoveragePercent"],
        "Changed application line coverage is too low",
    )
    evidence = json.loads((folder / "postman-evidence.json").read_text())
    require(
        evidence["gate"] == "passed"
        and evidence["sourceCommit"] == identity()
        and not evidence["rehearsalOnly"],
        "Invalid Postman gate evidence",
    )
    manifest = json.loads((OUT / "release.json").read_text())
    require(manifest["commit"] == identity(), "Release source mismatch")
    output = {
        "gate": "passed",
        "commit": identity(),
        "candidateSha256": manifest["sha256"],
        "pytestTests": count,
        "applicationCoveragePercent": total,
        "changedApplicationCoveragePercent": percent,
        "changedCoverageScope": "Executable carex/ and api/ Python lines since the recorded baseline; null means no changed executable application lines",
        "productionApproved": False,
    }
    write(OUT / "gate.json", output)
    summary(
        f"### Quality gate: PASS\n{count} pytest tests; application coverage {total:.2f}%; changed application coverage: {percent if percent is not None else 'not applicable, no changed executable application lines'}. Zero missing reports, unexpected skips, test errors or failed assertions. The Postman suite is a narrow contract smoke; pytest supplies broader application regression coverage."
    )


def dispatch_promotion():
    require(
        os.environ.get("GITHUB_ACTOR") != "github-actions[bot]",
        "Recursive promotion dispatch is forbidden",
    )
    gate_report = json.loads((OUT / "gate.json").read_text())
    require(
        gate_report["gate"] == "passed" and gate_report["commit"] == identity(),
        "Promotion requires passed, source-bound quality evidence",
    )
    data = {
        "ref": BRANCH,
        "inputs": {
            "mode": "promote-lab",
            "candidate_run_id": os.environ["GITHUB_RUN_ID"],
            "expected_health_status": "200",
            "free_storage_confirmed": "true",
            "request_lab_deploy": "false",
        },
    }
    github(f"repos/{REPO}/actions/workflows/ci.yml/dispatches", data=data)
    summary(
        "### Approval requested\nThe built-in repository-scoped Actions identity dispatched a separate promotion run. The owner must approve the course-isolated-lab environment in Actions. This automation never clicks Approve or posts a deployment review. Verify the actual downstream actor before claiming self-review separation."
    )


def validate_promotion():
    require(
        os.environ.get("GITHUB_ACTOR") == "github-actions[bot]",
        "Promotion must be dispatched by the built-in Actions identity, not the reviewer",
    )
    run_id = os.environ.get("CANDIDATE_RUN_ID", "")
    require(run_id.isdigit(), "A numeric candidate run is required")
    for attempt in range(12):
        run = github(f"repos/{REPO}/actions/runs/{run_id}")
        if run["status"] == "completed":
            break
        time.sleep(5)
    require(
        run["conclusion"] == "success",
        "The parent pipeline did not complete successfully",
    )
    require(
        run["head_sha"] == identity()
        and run["head_branch"] == BRANCH
        and run["event"] == "workflow_dispatch",
        "Candidate run source/event mismatch",
    )
    require(run["path"] == ".github/workflows/ci.yml", "Wrong parent workflow")
    report = json.loads((OUT / "gate.json").read_text())
    release = json.loads((OUT / "release.json").read_text())
    require(
        report["gate"] == "passed"
        and report["commit"] == release["commit"] == identity(),
        "Unbound candidate evidence",
    )
    require(
        report["candidateSha256"] == release["sha256"] == digest(OUT / "candidate.tar"),
        "Candidate evidence digest mismatch",
    )
    summary(
        "### Promotion source verified\nSuccessful parent workflow, exact branch/commit, original artifact and passed gate verified. Native environment approval remains mandatory before the lab job starts."
    )


def deploy():
    value = bind_lab()
    validate_promotion()
    with tempfile.TemporaryDirectory(prefix="carex-lab-release-") as temp:
        candidate = Path(temp)
        manifest = unpack(candidate)
        prepare_data(value, candidate)
        api_smoke(candidate, value, OUT / "deployment/postman")
        write(
            OUT / "deployment/release.json",
            {
                **manifest,
                "deployment": "verified ephemeral runner-lifetime lab API",
                "persistentStaging": False,
                "production": False,
                "rollback": "No long-lived service to switch back; API stopped and synthetic fixtures may be recreated. Destructive migration reversal is not claimed.",
            },
        )
    summary(
        "### Lab deployment verified\nThe approved candidate digest started a real API against the exact isolated Neon branch and passed smoke checks. The temporary API is now stopped. This is not a persistent endpoint, staging deployment or production release.\n\n### Staging / production\nDry-run promotion design only. Separate targets, identities, costs, migration recovery and approval remain required."
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "operation",
        choices=[
            "preflight",
            "build",
            "test",
            "gate",
            "dispatch",
            "validate-promotion",
            "deploy",
        ],
    )
    args = parser.parse_args()
    operations = {
        "preflight": preflight,
        "build": build,
        "test": tests,
        "gate": gate,
        "dispatch": dispatch_promotion,
        "validate-promotion": validate_promotion,
        "deploy": deploy,
    }
    try:
        operations[args.operation]()
    except (
        ValueError,
        KeyError,
        OSError,
        subprocess.SubprocessError,
        ET.ParseError,
    ) as error:
        print(
            "::error::Course pipeline stopped: "
            + (str(error) if isinstance(error, ValueError) else type(error).__name__)
            + ". Inspect sanitized evidence; promotion is blocked.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
