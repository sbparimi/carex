# Practical assignment — Lesson 4.2: Generate positive, negative and boundary scenarios

## Business context
CareX is changing patient appointment cancellation: a patient may cancel their own appointment only when the appointment start is more than 24 hours away in the clinic-local timezone. Exactly 24 hours is not allowed. Staff cancellation follows existing permissions.

## Task
Prompt Postman Agent Mode to generate positive, negative, exact-boundary, just-over, just-under, ownership and staff-regression scenarios for the cancellation rule. Build a coverage matrix with one row per rule and columns for scenario class, actor, boundary, evidence and expected business outcome. Identify duplicate scenarios and at least one omission. Use Postman Agent Mode to add only contract-backed cases to the Postman collection. Review the generated requests and test scripts before running them.

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
