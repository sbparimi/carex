# Practical assignment — Lesson 6.1: Collection execution options and tool roles

## Business context
The CareX collection is the reviewed API automation artefact. The course pipeline must execute it consistently without allowing AI proposals or unsafe environments to bypass review.

## Task
Create a tool-responsibility matrix for Postman Agent Mode, Postman app/Collection Runner, Postman CLI, GitHub Actions and Newman. For each, state what it does, what it does not do, required inputs, output evidence and course role. Verify each statement against current official Postman documentation and identify any account/plan constraints.

## Submission
1. Relevant command, configuration or decision record.
2. Exact tool/version and environment assumptions.
3. Run evidence, exit code and interpretation where execution is required.
4. One deliberate failure or security condition and its handling.
5. A statement of anything not tested or not supported.

## Acceptance criteria
- Use current official Postman CLI guidance.
- Execute only reviewed collection changes.
- Do not expose credentials in source, logs or artefacts.
- Keep write operations disabled unless a disposable non-production target is verified.
- Preserve failing mandatory gates; no AI override.
- Do not claim Newman compatibility or cloud upload without evidence.

Attempt the task before opening the instructor reference solution.
