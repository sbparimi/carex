# Practical assignment — Lesson 7.3: Prevent an AI diagnosis from becoming an unchecked gate

## Business context
The CareX appointment-booking workflow is executed through Postman and Postman CLI. AI-generated diagnosis may assist the team, but mandatory deterministic checks and authorised human decisions remain in control.

## Task
Create a failure-triage prompt for Postman Agent Mode that accepts only redacted run evidence and returns classification, supporting evidence, counter-evidence, confidence limitations and next action. Feed it a failure record. Define a deterministic rule that keeps the required CI check failed until an authorised human records an exception. Demonstrate that the agent's recommendation cannot change the gate result.

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
