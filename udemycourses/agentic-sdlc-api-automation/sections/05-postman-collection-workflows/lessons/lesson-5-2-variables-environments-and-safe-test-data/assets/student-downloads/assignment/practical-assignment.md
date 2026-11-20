# Practical assignment — Lesson 5.2: Variables, environments and safe test data

## Business context
The CareX API supports patient discovery, authentication, appointment booking and cancellation. The course change requires patient cancellation only when appointment start is more than 24 hours away in clinic-local time; exactly 24 hours is not allowed.

## Task
Refactor the CareX training collection to use environment variables for baseUrl, tenant and synthetic account credentials, and collection variables for runtime IDs such as clinicId, providerId, slotId and appointmentId. Export a safe environment template with secret values blank or placeholders. Use Postman Agent Mode to generate or configure a pre-request guard that blocks unsafe writes unless an explicit local non-production flag is set. Review the generated script and verify both the blocked and permitted cases; do not hand-write the script as the primary task. Verify the exported file contains no credentials.

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
