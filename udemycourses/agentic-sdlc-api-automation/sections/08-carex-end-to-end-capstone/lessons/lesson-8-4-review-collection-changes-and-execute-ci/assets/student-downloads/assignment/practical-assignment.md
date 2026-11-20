# Capstone assignment — Lesson 8.4: Review collection changes and execute CI

## Business context
The CareX capstone changes patient cancellation so that a patient may cancel their own appointment only when the appointment start is more than 24 hours away in the clinic-local timezone. Exactly 24 hours is not allowed. Staff cancellation remains governed by existing permissions.

## Task
Ask Postman Agent Mode to propose the collection changes needed for the cancellation scenarios. Inspect the diff, reject unsupported endpoints/fields and unsafe environment changes, then commit the reviewed collection. Run the affected folder locally with Postman CLI. Add or use the course GitHub Actions workflow to run the same approved collection and retain results. Demonstrate a deliberate failing assertion and confirm CI fails.

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
