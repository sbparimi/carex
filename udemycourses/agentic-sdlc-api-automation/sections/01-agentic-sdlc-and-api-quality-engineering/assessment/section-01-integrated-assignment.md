# Section 1 integrated assignment — design a safe agentic quality workflow

## Business scenario
CareX is considering a booking-window rule: patients may book only within the next 30 calendar days. The exact timezone, inclusive boundary and staff-booking scope are not yet confirmed. The workflow must analyse the change, propose tests and keep release authority under deterministic policy and accountable human control.

## Your mission
Produce a compact design pack showing how this change moves safely from intake to a testable, reviewable proposal.

## Required artefacts
1. **Change interpretation:** Extract the stated rule and list unresolved questions.
2. **Traceability:** Map the rule to the patient booking journey and candidate API behaviour.
3. **Responsibility boundary:** Identify what the Requirement Analyst, Impact Analyst, Test Planner, deterministic validators, Postman runner, policy evaluator and human reviewer may do.
4. **Architecture:** Draw the workflow and identify hand-off contracts and evidence stores.
5. **Safety review:** Explain how prompt injection, secret exposure and unexpected write operations are contained.
6. **Verification plan:** Define positive, negative and boundary tests without inventing unresolved business semantics.

## Acceptance criteria
- No unstated rule is silently invented.
- Every proposed scenario references a source rule.
- Generated structured output is validated before use.
- Agents have least-privilege permissions and cannot alter release policy.
- Test execution is restricted to a disposable test environment.
- Mandatory failures are evaluated by deterministic policy.
- High-impact changes and risk exceptions have explicit human approval.
- Source, proposal, review, execution and policy evidence are retained.

## Submission format
Submit a folder containing:
- `change-analysis.md`
- `traceability.csv`
- `workflow.mmd` or `workflow.png`
- `test-plan.json`
- `threat-review.md`
- `verification-plan.md`

## Review
Use `section-01-reference-review.md` as a checklist after completing your own work. It is a review guide, not a claim that your implementation has been executed.
