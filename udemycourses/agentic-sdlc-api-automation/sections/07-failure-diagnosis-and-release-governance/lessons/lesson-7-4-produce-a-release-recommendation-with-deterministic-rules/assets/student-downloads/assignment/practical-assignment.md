# Practical assignment — Lesson 7.4: Produce a release recommendation with deterministic rules

## Business context
The CareX appointment-booking workflow is executed through Postman and Postman CLI. AI-generated diagnosis may assist the team, but mandatory deterministic checks and authorised human decisions remain in control.

## Task
Build a CareX release-assessment template that consumes required collection/CLI run evidence, test results, open questions, failure classifications and policy gates. Define deterministic pass/block conditions and an explicit human decision field. Use one all-green scenario and one scenario with missing mandatory evidence. Ask Agent Mode for commentary, but show that it cannot set the final approval field or override a failed gate.

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
