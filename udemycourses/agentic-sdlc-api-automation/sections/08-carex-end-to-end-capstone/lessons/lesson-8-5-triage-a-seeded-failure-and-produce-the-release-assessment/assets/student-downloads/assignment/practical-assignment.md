# Capstone assignment — Lesson 8.5: Triage a seeded failure and produce the release assessment

## Business context
The CareX capstone changes patient cancellation so that a patient may cancel their own appointment only when the appointment start is more than 24 hours away in the clinic-local timezone. Exactly 24 hours is not allowed. Staff cancellation remains governed by existing permissions.

## Task
Execute the capstone suite and inspect the seeded failure evidence. Use Postman Agent Mode to propose a diagnosis with supporting and counter-evidence. Independently classify the failure and record what remains unknown. Evaluate mandatory deterministic release gates, prepare a release assessment with run IDs and collection commit, and leave the final approval field for an authorised human. Do not seed or mutate a shared/production database.

## Required evidence
1. Change/requirement reference and source revision.
2. Postman Agent Mode prompt and unmodified output where applicable.
3. Human-reviewed artefact or diff.
4. Postman/CLI run evidence and Git revision.
5. Failure analysis, open risks and release assessment.

## Acceptance criteria
- All proposed API operations and assertions are supported by CareX contract/implementation evidence.
- Exact boundary, ownership and staff regression are considered.
- Collection changes are reviewed before execution.
- CLI/CI runs execute the reviewed commit and retain evidence.
- Only synthetic data and a dedicated disposable non-production database are used.
- AI cannot execute prohibited writes, waive mandatory gates or approve release.
- The learner can reproduce and explain the final result independently.

Do not mark the capstone complete until the full workflow has executed and all evidence is retained.
