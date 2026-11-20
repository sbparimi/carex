# Section 2 integrated assignment — CareX requirements to impact-ranked test proposal

## Approved scenario
Patients may cancel their own appointments only when the appointment start is more than 24 hours away in the clinic-local timezone. At exactly 24 hours cancellation is not allowed. Staff cancellation follows existing staff permissions.

## Deliverables
1. `change-brief.md`: intent, source revision, facts, assumptions and open questions.
2. `business-rules.csv` and `acceptance-criteria.md`: atomic rules and Given/When/Then.
3. `traceability.csv`: rule → journey → verified OpenAPI operation → Postman request → evidence.
4. `impact-analysis.csv`: changed file/symbol → impacted rule/journey/test → priority and rationale.
5. `test-selection.md`: positive, negative, boundary, timezone, ownership and staff regression.
6. `decision-log.md`: unresolved questions, owners and approvals.

## Constraints
Inspect the checked-out CareX contract and implementation. Candidate paths and synthetic diffs in lesson fixtures are not confirmed live facts. Never invent status codes or schemas. Use synthetic accounts and non-production data only. Generated mappings are proposals until validated.

## Acceptance criteria
- Every test traces to an approved rule.
- Every operation mapping cites a pinned source revision.
- Exactly 24h is rejected; just over 24h is allowed under a controlled clinic-local clock.
- Ownership and staff permission regression are represented.
- Impact priorities have evidence and rationale.
- Unresolved contract details remain blocked, not guessed.