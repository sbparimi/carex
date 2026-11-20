# Practical assignment — Lesson 4.1: Build a traceable test-planning contract

## Business context
CareX is changing patient appointment cancellation: a patient may cancel their own appointment only when the appointment start is more than 24 hours away in the clinic-local timezone. Exactly 24 hours is not allowed. Staff cancellation follows existing permissions.

## Task
In Postman Agent Mode, ask for a test-plan proposal for the CareX 24-hour cancellation change. Require scenario IDs, rule IDs, actor, preconditions, boundary values, operation reference, expected business outcome, evidence source, risk and open questions. Map each scenario to an existing CareX operation only when the supplied OpenAPI contract proves the mapping. Validate the proposal with a peer review table and reject any invented status code or schema.

## Submission
1. Agent Mode prompt and unmodified output.
2. Reviewed artefact with source/evidence references.
3. Defects, assumptions and open questions.
4. Verification evidence and interpretation.
5. One paragraph explaining what the AI did not establish.

## Acceptance criteria
- All expected outcomes trace to the requirement or verified API contract.
- Positive, negative and boundary coverage is considered where relevant.
- No unsupported endpoint, status, field or response schema is invented.
- Human review is visible and separate from AI output.
- The work is reproducible using synthetic data and the course environment.

Attempt the task before opening the instructor reference solution.
