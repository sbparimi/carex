# Practical assignment — Lesson 3.4: Retries, timeouts, idempotency and audit trail

## Business context
CareX is changing its appointment-cancellation quality workflow. A patient may cancel their own appointment only when the appointment start is more than 24 hours away in the clinic-local timezone; exactly 24 hours is not allowed. Staff cancellation remains governed by existing permissions.

## Task
Build a retry decision matrix for Agent Mode requirement analysis, OpenAPI read, Postman GET, CareX booking POST with the documented idempotency key, and release approval. For each, define retry safety, maximum retry policy, idempotency/evidence requirement and human escalation. Use the actual CareX API contract to confirm the booking idempotency header; do not invent retry behaviour or timeouts.

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
