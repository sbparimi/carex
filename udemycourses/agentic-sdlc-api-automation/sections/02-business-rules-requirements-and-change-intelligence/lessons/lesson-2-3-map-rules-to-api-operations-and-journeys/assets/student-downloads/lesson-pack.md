# Lesson 2.3 — Map rules to API operations and journeys

## Outcome
Create traceability from approved rules to journeys, verified OpenAPI operations, Postman requests and evidence.

## Seven-part lesson activity
- **Opening:** A plausible REST path is not proof that an operation exists.
- **Concept:** Rule → journey → operationId → method/path → request/response schema → Postman request → evidence.
- **Why:** Traceability exposes missing tests and unsupported assumptions.
- **Demo:** Inspect a pinned CareX OpenAPI document and locate cancellation operations.
- **Build:** Complete the traceability matrix.
- **Verify:** Every operation reference resolves in the checked-out contract; every Postman ID exists in the collection.
- **Recap:** Unverified mappings remain unverified.

## Starter matrix
| Rule | Journey | Operation ID | Method/path | Postman request | Status |
|---|---|---|---|---|---|
| BR-01 | Patient ownership | — | — | — | Unverified |
| BR-02 | Patient allowed cancellation | — | — | — | Unverified |
| BR-03 | Exact 24h boundary | — | — | — | Unverified |
| BR-04 | Staff cancellation | — | — | — | Unverified |

Candidate path for search only: `DELETE /t/{tenant}/api/v1/patient/appointments/{appointment_id}`. Do not treat it as confirmed until checked against the pinned contract.

## Knowledge check
1. Trustworthy mapping requires **versioned contract/implementation evidence**.
2. One operation supports multiple rules? **Represent explicit many-to-many traceability.**
3. Candidate path absent from contract? **Mark unverified and investigate.**

## Practical assignment
Inspect the CareX OpenAPI document from the course branch revision. Complete `traceability.csv` with rule, journey, operationId, method, path, schema refs, Postman request ID and evidence location. Do not infer values from naming conventions.

## Reference solution
Map BR-01 to ownership, BR-02 to allowed cancellation, BR-03 to exact-boundary rejection and BR-04 to staff regression. Populate operation details only from the checked-out contract and Postman request IDs only from the supplied collection. Missing mappings remain investigation tasks.

## Verification checklist
- [ ] OperationId/method/path verified against pinned OpenAPI
- [ ] Schema references resolve
- [ ] Postman request ID exists
- [ ] Each mapping cites evidence and revision
