# Expected result — Lesson 4.1

A successful learner submission is a structured test-plan proposal, not a set of invented Postman assertions.

## Required observable output
- Change ID exactly CAREX-CHANGE-030-CANCEL-24H.
- Source revision and OpenAPI revision recorded separately.
- Every scenario has a stable ID, rule ID, actor, preconditions, business outcome, risk and evidence references.
- The cancellation operation is mapped to the checked-in collection request only as provisional request evidence until the learner pins the runtime OpenAPI operation.
- HTTP status and response-body expectations remain explicitly unverified until the OpenAPI contract is captured.
- The current 120-minute online change gate is distinguished from the separate 24-hour late_cancel classification flag.
- The proposed 24-hour denial rule is not represented as current behaviour.
- Open questions about DST semantics and route-level staff authorization are retained.

## Interpretation
The plan is blocked from execution if the contract revision is missing, if the deployed implementation revision is unknown, or if the proposed 24-hour rule is represented as current behaviour.

## Common failure
Agent Mode treats the existing 24-hour late_cancel flag as proof that cancellations are denied inside 24 hours. Reject this: the source uses that value to classify a late cancellation, while the online change gate defaults to 120 minutes.
