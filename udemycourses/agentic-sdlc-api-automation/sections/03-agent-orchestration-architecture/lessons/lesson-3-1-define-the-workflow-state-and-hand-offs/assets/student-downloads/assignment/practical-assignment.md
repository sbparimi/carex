# Practical assignment — Lesson 3.1: Define the workflow state and hand-offs

## Business context
CareX is changing its appointment-cancellation quality workflow. A patient may cancel their own appointment only when the appointment start is more than 24 hours away in the clinic-local timezone; exactly 24 hours is not allowed. Staff cancellation remains governed by existing permissions.

## Task
Create a CareX workflow-state diagram from change intake to release recommendation. Include received, analysed, clarification-required, proposal-ready, human-review, collection-updated, executed, triaged, release-assessed and blocked. For every transition, identify required evidence and actor (Postman Agent Mode, Postman, CLI, GitHub Actions or human). Include an ambiguous-requirement path and forbidden-write path. Use Mermaid or a structured table. Verify that no path moves directly from agent proposal to production release.

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
