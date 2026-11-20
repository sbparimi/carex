# Practical assignment — Lesson 6.3: Newman legacy compatibility and migration to Postman CLI

## Business context
The CareX collection is the reviewed API automation artefact. The course pipeline must execute it consistently without allowing AI proposals or unsafe environments to bypass review.

## Task
Using the exact CareX collection format, document whether Newman can run it and what would need to change. Check current official documentation, then perform a controlled compatibility test only if the environment and tool are available. Record the collection schema, unsupported features, reporter differences and migration decision. If the run cannot be performed, mark compatibility unverified rather than claiming success.

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
