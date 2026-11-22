"""Deterministic checks; reports legacy style debt without calling it clean."""

from __future__ import annotations

import json
import os
import subprocess
import sys

from pipeline import OUT, ROOT, require, summary

NEW = [
    "postman/ci/pipeline.py",
    "postman/ci/quality.py",
    "postman/ci/test_pipeline.py",
    "tests/test_course_quality_boundaries.py",
]
FOLDER = OUT / "develop"


def run(args):
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)


def lint():
    report = run(
        [
            "ruff",
            "check",
            "--isolated",
            "--select",
            "E4,E7,E9,F,I",
            "--output-format",
            "json",
            "carex",
            "api",
        ]
    )
    require(report.returncode in (0, 1), "Legacy lint report could not be generated")
    debt = json.loads(report.stdout)
    (FOLDER / "legacy-style.json").write_text(json.dumps(debt, indent=2) + "\n")
    for args in (
        ["ruff", "check", "--isolated", "--select", "E9,F63,F7,F82", "carex", "api"],
        ["ruff", "check", "--isolated", "--select", "E,F,I", "--ignore", "E501", *NEW],
        ["ruff", "format", "--check", *NEW],
    ):
        result = run(args)
        print(result.stdout)
        require(
            result.returncode == 0,
            "A mandatory application-correctness or new-tooling style check failed",
        )
    if debt:
        print(
            f"::warning::Existing application style backlog: {len(debt)} findings. Retained as legacy-style.json; this is not a clean-style claim."
        )
    summary(
        f"### Develop / coding standards\nApplication fatal-error checks and strict lint/format checks on the new pipeline tooling passed. Existing application style backlog: {len(debt)} findings, reported separately, not silently waived or described as clean. A whole-application reformat is not hidden inside this pipeline change."
    )


def security():
    result = run(
        [
            "bandit",
            "-r",
            "carex",
            "api",
            "postman/ci/pipeline.py",
            "postman/ci/quality.py",
            "-f",
            "json",
            "-o",
            str(FOLDER / "bandit.json"),
            "-q",
        ]
    )
    require(result.returncode in (0, 1), "Static scanner failed")
    report = json.loads((FOLDER / "bandit.json").read_text())
    require(not report.get("errors"), "Static scanner could not inspect all inputs")
    high = [r for r in report["results"] if r["issue_severity"] == "HIGH"]
    require(not high, "High-severity static findings block promotion")
    result = run(
        [
            "pip-audit",
            "--disable-pip",
            "--no-deps",
            "-r",
            "postman/ci/requirements-test.lock",
            "-r",
            "postman/ci/requirements-ci.lock",
            "--format",
            "json",
            "--output",
            str(FOLDER / "dependencies.json"),
        ]
    )
    require(result.returncode in (0, 1), "Dependency scanner failed")
    dependencies = json.loads((FOLDER / "dependencies.json").read_text())
    require(
        all(
            not d.get("skip_reason") and not d.get("vulns")
            for d in dependencies["dependencies"]
        ),
        "Skipped packages or known dependency advisories block promotion",
    )
    result = run(
        [
            os.environ.get("GITLEAKS_CLI", "gitleaks"),
            "dir",
            ".",
            "--config",
            "postman/ci/gitleaks.toml",
            "--redact=100",
            "--report-format",
            "json",
            "--report-path",
            str(FOLDER / "secrets.json"),
        ]
    )
    require(result.returncode == 0, "Secret scan failed or found a secret")
    require(
        not json.loads((FOLDER / "secrets.json").read_text()),
        "Secret findings block promotion",
    )
    summary(
        "### Develop / security\nNo high-severity static findings, no known advisories in the fully pinned test/runtime dependency set, and no unreviewed secret findings. Medium/low static findings remain visible in the artifact. One exact public synthetic cron test fixture is allowlisted by both path and value; no file-wide secret exclusions. Scanner errors and skipped dependencies fail closed."
    )


def main():
    FOLDER.mkdir(parents=True, exist_ok=True)
    try:
        {"lint": lint, "security": security}[sys.argv[1]]()
    except (ValueError, KeyError, OSError, json.JSONDecodeError):
        print(
            "::error::Mandatory development check failed. Inspect the retained report; no promotion is allowed.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
