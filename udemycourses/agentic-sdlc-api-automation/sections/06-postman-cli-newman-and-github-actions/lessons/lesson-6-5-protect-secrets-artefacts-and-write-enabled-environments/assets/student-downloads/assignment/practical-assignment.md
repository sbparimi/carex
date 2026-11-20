# Practical assignment — Lesson 6.5: Protect secrets, artefacts and write-enabled environments

## Business context
The CareX collection is the reviewed API automation artefact. The course pipeline must execute it consistently without allowing AI proposals or unsafe environments to bypass review.

## Task
Review the CI workflow, environment files and retained artefacts for secrets and unsafe write paths. Create a threat checklist covering token storage, log masking, artifact retention, environment targeting, permissions and approval. Demonstrate that a write-enabled job cannot run against the shared preview/production database. Include a failure-handling and credential-rotation procedure.

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
