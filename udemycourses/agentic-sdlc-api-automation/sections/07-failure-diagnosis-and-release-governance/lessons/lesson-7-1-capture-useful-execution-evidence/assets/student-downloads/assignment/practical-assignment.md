# Practical assignment — Lesson 7.1: Capture useful execution evidence

## Business context
The CareX appointment-booking workflow is executed through Postman and Postman CLI. AI-generated diagnosis may assist the team, but mandatory deterministic checks and authorised human decisions remain in control.

## Task
Run the reviewed CareX collection in Postman and, where available, Postman CLI. Build an evidence record containing collection commit, environment name (not secrets), request name, method/path template, response status, assertion results, run identifier, timestamp and CLI exit code. Redact tokens and personal data. Include one failed assertion and show how another engineer can reproduce it.

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
