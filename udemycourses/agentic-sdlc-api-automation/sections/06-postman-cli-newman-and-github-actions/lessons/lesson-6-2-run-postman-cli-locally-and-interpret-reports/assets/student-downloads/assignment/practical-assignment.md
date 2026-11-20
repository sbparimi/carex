# Practical assignment — Lesson 6.2: Run Postman CLI locally and interpret reports

## Business context
The CareX collection is the reviewed API automation artefact. The course pipeline must execute it consistently without allowing AI proposals or unsafe environments to bypass review.

## Task
Install Postman CLI using the current official method and record the version. Run the reviewed CareX collection from a local file with the course environment. Capture the exact command, exit code, request count, assertion results and report output. Run one intentionally failing assertion and explain how the CLI reports it. Do not include API keys, tokens or environment secrets in logs.

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
