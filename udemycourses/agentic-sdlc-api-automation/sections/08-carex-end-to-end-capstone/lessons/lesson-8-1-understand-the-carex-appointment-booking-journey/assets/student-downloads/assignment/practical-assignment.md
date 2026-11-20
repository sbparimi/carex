# Capstone assignment — Lesson 8.1: Understand the CareX appointment-booking journey

## Business context
The CareX capstone changes patient cancellation so that a patient may cancel their own appointment only when the appointment start is more than 24 hours away in the clinic-local timezone. Exactly 24 hours is not allowed. Staff cancellation remains governed by existing permissions.

## Task
Import the CareX collection and trace the booking journey from public discovery through patient authentication, availability, booking and retrieval. Map request dependencies, variables, authentication and business state transitions. Confirm current behaviour against the supplied OpenAPI/implementation. Run a safe baseline in the dedicated course environment and record the collection revision and results.

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
