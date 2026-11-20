# Practical assignment — Lesson 4.4: Review hallucinations, omissions and weak assertions

## Business context
CareX is changing patient appointment cancellation: a patient may cancel their own appointment only when the appointment start is more than 24 hours away in the clinic-local timezone. Exactly 24 hours is not allowed. Staff cancellation follows existing permissions.

## Task
Review a deliberately flawed Agent Mode proposal containing one invented endpoint/field, one missing exact-boundary scenario, one status-only assertion and one duplicated happy path. Annotate each defect with its evidence source and correction. Ask Agent Mode to revise the proposal, then compare the revision against the original requirements and contract. Do not accept its self-review as verification.

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
