# Practical assignment — Lesson 3.3: Structured outputs, schemas and validation

## Business context
CareX is changing its appointment-cancellation quality workflow. A patient may cancel their own appointment only when the appointment start is more than 24 hours away in the clinic-local timezone; exactly 24 hours is not allowed. Staff cancellation remains governed by existing permissions.

## Task
Take the supplied Agent Mode JSON proposal format. Add a required evidence reference, allowed action enum, explicit release-decision enum and non-empty proposed_actions rule. Generate one valid and two invalid proposals (missing evidence; forbidden action or release approval). Paste each into the Postman collection variable and demonstrate the expected validation result. Record structural and semantic review separately.

## Submission
1. Completed artefact.
2. Source references and assumptions.
3. One failure, ambiguity or prohibited action considered.
4. Evidence of Postman Agent Mode output where required.
5. Postman verification evidence and a short interpretation.

## Acceptance criteria
- The artefact directly demonstrates this lesson's outcome.
- Agent output is treated as a proposal, not proof.
- No endpoint, status code, schema or policy is invented.
- Deterministic verification is separate from AI self-assessment.
- No write action or release approval is performed by an agent.
- Only synthetic data and a verified non-production environment are used.

Attempt the task before opening the instructor reference solution.
