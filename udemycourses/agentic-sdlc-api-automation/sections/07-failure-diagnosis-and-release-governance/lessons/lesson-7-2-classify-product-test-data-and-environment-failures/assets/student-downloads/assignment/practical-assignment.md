# Practical assignment — Lesson 7.2: Classify product, test, data and environment failures

## Business context
The CareX appointment-booking workflow is executed through Postman and Postman CLI. AI-generated diagnosis may assist the team, but mandatory deterministic checks and authorised human decisions remain in control.

## Task
Analyse three supplied CareX failure records (one product-like, one test-design and one environment/data-related). For each, identify observed facts, hypotheses, missing evidence, classification confidence and next diagnostic action. Ask Agent Mode to propose a classification, then independently compare it with the evidence. Do not convert an unverified hypothesis into a confirmed defect.

## Submission
1. Evidence or decision artefact.
2. Agent Mode prompt and output where applicable.
3. Independent evidence review.
4. One failure or exception path and its handling.
5. Clear statement of what remains unverified.

## Acceptance criteria
- Evidence is traceable to the exact collection revision and run.
- Secrets and personal data are redacted.
- AI output is not treated as proof or release authority.
- Mandatory deterministic gates cannot be bypassed by an agent.
- Human exception/approval is explicit and auditable.

Attempt the task before opening the instructor reference solution.
