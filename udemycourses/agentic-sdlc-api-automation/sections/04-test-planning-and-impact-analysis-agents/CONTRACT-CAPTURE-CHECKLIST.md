# CareX OpenAPI contract capture checklist — Section 04

This checklist is a learner procedure, not evidence that a contract has already been captured.

1. Start the CareX application against a dedicated disposable development database.
2. Confirm the base URL points to that environment and not a shared preview or production deployment.
3. Open the API OpenAPI document at /api/openapi.json for that exact running build.
4. Save the document as a local file and record the CareX Git commit or deployment revision, capture date and base URL.
5. Import the saved OpenAPI file into Postman. Do not import a moving URL as the only evidence.
6. Locate the patient cancellation operation and verify method, path, parameters, request body, documented success responses, error responses and schemas.
7. Locate the staff cancellation operation separately and verify its documented security requirements.
8. Compare the contract with the checked-in Postman training collection. Record mismatches; do not silently rewrite either source.
9. Compare the contract and implementation with the synthetic proposed 24-hour rule. The checked-in source currently has a 120-minute online change gate; the separate 24-hour late_cancel flag does not block cancellation.
10. Add the OpenAPI file hash and source revision to the evidence register.
11. Only after review, derive response assertions and prepare a separate disposable test dataset.
12. Never seed, cancel, or otherwise mutate production data. The Vercel Preview environment must not be assumed safe for writes when it shares production Neon variables.

## Evidence record
- CareX source revision:
- Deployment/build identifier:
- OpenAPI file SHA-256:
- Capture timestamp:
- Base URL (non-secret):
- Patient cancellation operation:
- Staff cancellation operation:
- Response schema references:
- Reviewer:
- Unresolved contract questions:
