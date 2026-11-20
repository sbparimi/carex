"""Deterministic safety gate for an agent-proposed API test plan.

Python 3.11+, standard library only.
This is a teaching harness: it validates a proposal; it does not call CareX,
Postman, Jira, an LLM, or any external service.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from typing import Any

ALLOWED_ACTIONS = {"read_contract", "propose_test", "run_read_only_check"}
WRITE_ACTIONS = {"create_test", "update_collection", "write_database", "deploy", "release"}
REQUIRED_TOP_LEVEL = {"change_id", "source_revision", "proposed_actions", "release_decision"}


def validate_proposal(proposal: dict[str, Any], *, human_approved: bool = False) -> list[str]:
    errors: list[str] = []
    missing = REQUIRED_TOP_LEVEL - proposal.keys()
    if missing:
        errors.append("missing fields: " + ", ".join(sorted(missing)))
        return errors
    if not proposal["change_id"] or not proposal["source_revision"]:
        errors.append("change_id and source_revision must be non-empty")
    actions = proposal["proposed_actions"]
    if not isinstance(actions, list):
        errors.append("proposed_actions must be a list")
        return errors
    for index, action in enumerate(actions):
        if not isinstance(action, dict):
            errors.append(f"action[{index}] must be an object")
            continue
        name = action.get("action")
        if name in WRITE_ACTIONS and not human_approved:
            errors.append(f"action[{index}] '{name}' blocked: explicit human approval required")
        elif name not in ALLOWED_ACTIONS and name not in WRITE_ACTIONS:
            errors.append(f"action[{index}] '{name}' is not allow-listed")
        if name in ALLOWED_ACTIONS and not action.get("evidence_ref"):
            errors.append(f"action[{index}] '{name}' requires evidence_ref")
    decision = proposal["release_decision"]
    if decision not in {"not_assessed", "recommend_hold", "recommend_review"}:
        errors.append("release_decision cannot approve or execute a release")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("proposal", type=Path)
    parser.add_argument("--human-approved", action="store_true",
                        help="Teaching flag simulating a separate human approval.")
    args = parser.parse_args()
    proposal = json.loads(args.proposal.read_text(encoding="utf-8"))
    errors = validate_proposal(proposal, human_approved=args.human_approved)
    if errors:
        print(json.dumps({"result": "BLOCKED", "errors": errors}, indent=2))
        return 2
    print(json.dumps({"result": "VALIDATED_FOR_REVIEW",
                      "release_decision": proposal["release_decision"],
                      "note": "Validation is not execution or release approval."}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
