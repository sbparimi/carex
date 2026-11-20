# Lesson 2.2 — Extract rules, acceptance criteria and ambiguity

## Outcome
Transform a narrative into atomic, testable business rules and acceptance criteria while preserving provenance.

## Approved CareX policy
Patients may cancel their own appointments only when the appointment start is **more than 24 hours away** in the clinic-local timezone. At exactly 24 hours cancellation is not allowed. Staff cancellation follows existing staff permissions.

## Seven-part lesson activity
- **Opening:** “24 hours” is not enough unless the boundary and clock basis are explicit.
- **Concept:** Atomic rule = actor + resource + condition + outcome + source.
- **Why:** Ambiguous criteria create inconsistent tests and false release confidence.
- **Demo:** Turn policy sentences into BR-01…BR-04 and Given/When/Then.
- **Build:** Complete rules and criteria below.
- **Verify:** Check exact boundary, just-over, just-under, ownership and staff regression.
- **Recap:** Verify response status/schema from the actual contract; never invent it.

## Starter rules
| ID | Rule | Source |
|---|---|---|
| BR-01 | Patient may cancel only their own appointment | Approved policy |
| BR-02 | Patient cancellation allowed only when clinic-local start is >24h away | Approved policy |
| BR-03 | Exactly 24h before start is not allowed | Approved policy |
| BR-04 | Staff cancellation follows existing staff permissions | Approved policy |

## Knowledge check
1. Atomic rule? **Patient may cancel own appointment only when clinic-local start is >24h away.**
2. At exactly 24h? **Reject.**
3. Why include actor, condition and outcome? **To derive unambiguous executable scenarios.**

## Postman Agent Mode demonstration
Give Agent Mode the approved CareX cancellation policy and ask it to extract atomic rules and Given/When/Then acceptance criteria. Require the strict `>24 hours` boundary and clinic-local timezone to be explicit. Ask it to list response-contract details that remain unknown. Review every generated criterion against the approved policy; do not allow it to infer status codes or error schemas.

## Practical assignment
Ask Postman Agent Mode to draft the atomic rules and acceptance criteria, then create `business-rules.csv` and `acceptance-criteria.md`. Include positive, exact-boundary, just-inside, ownership violation and staff-permission regression. Keep unknown HTTP status/error schema as a verification task.

## Reference solution
Allowed: patient owns appointment and >24h remains. Rejected: exactly 24h; less than 24h; another patient's appointment. Staff cancellation remains governed by existing roles. Use controlled clinic-local timestamps and verify API response contract from checked-in OpenAPI/implementation.

## Verification checklist
- [ ] BR-01…BR-04 atomic and source-linked
- [ ] Strict > comparison represented correctly
- [ ] Clinic-local timezone explicit
- [ ] Unknown error response contract not guessed
