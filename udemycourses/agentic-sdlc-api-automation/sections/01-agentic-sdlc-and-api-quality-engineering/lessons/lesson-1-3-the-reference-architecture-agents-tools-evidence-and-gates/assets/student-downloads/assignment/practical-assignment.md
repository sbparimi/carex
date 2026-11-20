# Lesson 1.3 practical assignment — design the evidence-driven architecture

## Scenario
Build the architecture for a CareX change workflow. It must accept a Jira-style change request, inspect an OpenAPI contract, propose test impact, request review, execute Postman tests and produce a release assessment.

## Task
Create a component diagram and one structured hand-off contract for the Test Planner agent.

## Starter
Use `workflow-components.csv` and `test-plan-output.example.json`.

## Deliverables
1. Architecture diagram showing orchestrator, specialist agents, deterministic tools, evidence store and human approval.
2. Completed component responsibility matrix.
3. A JSON output contract for a proposed test plan.
4. A short explanation of where schema validation, permission checks and release policy run.
5. One failure path showing how invalid agent output is rejected and recorded.

## Acceptance criteria
- Agents propose; deterministic components validate and execute.
- Human approval is explicit for high-impact changes and risk exceptions.
- Every hand-off has a defined input, output and evidence reference.
- Invalid structured output cannot proceed to execution.
- The release gate consumes raw test evidence and versioned policy, not agent confidence alone.

## Verify
Validate the JSON example against the schema included in the starter pack. Then inspect the diagram and confirm no agent has unrestricted production write access.
