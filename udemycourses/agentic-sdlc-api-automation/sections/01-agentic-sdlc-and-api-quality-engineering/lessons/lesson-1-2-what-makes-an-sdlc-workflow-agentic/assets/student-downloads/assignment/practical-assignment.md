# Lesson 1.2 practical assignment — draw the responsibility boundary

## Scenario
A clinic change enters the CareX delivery workflow. AI agents interpret the story, propose impacted tests and summarise failures. Postman executes approved requests. A deterministic policy blocks release if a mandatory test fails.

## Task
Review `responsibility-matrix.csv` and `scenario-release-conflict.json`. Confirm or amend the responsibility assigned to each activity and resolve the release conflict.

## Deliverables
1. A completed responsibility matrix with a rationale for each owner: agent, deterministic component or human.
2. The correct release decision for run `demo-run-2026-001`.
3. A short explanation separating recommendation, execution evidence, policy evaluation and human exception approval.

## Acceptance criteria
- All ten activity owners are justified.
- The learner identifies `API-TENANT-004` as the mandatory failed test.
- The expected outcome is BLOCKED under `CAREX-RELEASE-POLICY-1`.
- The agent's GO recommendation remains advisory.
- Any exception requires an authorised human and retained approval evidence.

## Verify
Compare your matrix and decision with `expected-results/lesson-1.2-verification.md`. Open the reference answer only after completing your own analysis.
