# Practical assignment — Lesson 5.1: Model a business journey as API interactions

## Business context
The CareX API supports patient discovery, authentication, appointment booking and cancellation. The course change requires patient cancellation only when appointment start is more than 24 hours away in clinic-local time; exactly 24 hours is not allowed.

## Task
Use Postman Agent Mode to propose a collection for the CareX patient booking journey: public discovery, authentication, availability, booking, retrieve booking and cancellation eligibility. Compare every request with the supplied OpenAPI contract. Arrange requests in dependency order, capture identifiers into variables and document prerequisites. Do not invent endpoint paths or response fields.

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
