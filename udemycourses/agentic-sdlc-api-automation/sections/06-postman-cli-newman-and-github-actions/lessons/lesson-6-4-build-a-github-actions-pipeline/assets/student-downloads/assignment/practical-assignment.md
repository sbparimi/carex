# Practical assignment — Lesson 6.4: Build a GitHub Actions pipeline

## Business context
The CareX collection is the reviewed API automation artefact. The course pipeline must execute it consistently without allowing AI proposals or unsafe environments to bypass review.

## Task
Create a GitHub Actions workflow that checks out the training repository, runs the CareX Postman collection using the documented Postman CLI GitHub Action or command, and retains the run output as an artefact. Use GitHub Secrets only if the chosen workflow requires authentication. Add a deliberate failing assertion and prove that the workflow fails. Keep write operations disabled and use a verified non-production environment.

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
