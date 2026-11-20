# Practical assignment — Lesson 5.3: Assertions that verify business outcomes

## Business context
The CareX API supports patient discovery, authentication, appointment booking and cancellation. The course change requires patient cancellation only when appointment start is more than 24 hours away in clinic-local time; exactly 24 hours is not allowed.

## Task
Ask Postman Agent Mode to generate Postman assertions for the CareX cancellation journey. Supply the approved business rule and verified OpenAPI evidence. Review the generated scripts, then verify the expected outcomes for eligible and ineligible cancellation attempts. Verify response status and schema only where the OpenAPI contract defines them, and assert the business outcome for eligible and ineligible cancellation attempts. Include exactly 24 hours, just over and just under 24 hours, plus an ownership violation. Use controlled clinic-local timestamps. Do not invent error status or payload.

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
