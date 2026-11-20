# Practical assignment — Lesson 5.4: Review and maintain generated collection changes

## Business context
The CareX API supports patient discovery, authentication, appointment booking and cancellation. The course change requires patient cancellation only when appointment start is more than 24 hours away in clinic-local time; exactly 24 hours is not allowed.

## Task
Give Postman Agent Mode a change request to add a cancellation eligibility test to the CareX collection. Inspect every changed request, variable, pre-request script and test script. Compare the diff with the requirement and OpenAPI contract. Reject any invented field, endpoint or write-enabled environment change. Run the affected folder, capture the run result, commit only the reviewed collection and record the commit hash.

## Submission
1. Updated Postman collection/environment artefact.
2. Agent Mode prompt/output and human-reviewed diff where applicable.
3. Relevant Postman run evidence.
4. One negative/boundary case and its interpretation.
5. Source reference and unresolved questions.

## Acceptance criteria
- Requests and assertions are supported by the CareX contract/implementation.
- Runtime data is captured through variables rather than hard-coded live IDs.
- Secrets and real data are not committed.
- The collection is reproducible from the learner checkpoint.
- AI-generated changes are reviewed before execution.
- Only verified non-production environments are used.

Attempt the task before opening the instructor reference solution.
