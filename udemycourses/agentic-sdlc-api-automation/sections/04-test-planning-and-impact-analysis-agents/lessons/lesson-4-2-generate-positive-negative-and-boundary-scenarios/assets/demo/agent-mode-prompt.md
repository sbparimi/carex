# Postman Agent Mode prompt — Lesson 4.2

Using the attached synthetic change fixture and scenario seed CSV, generate a scenario matrix for the proposed CareX 24-hour patient cancellation rule.

Include positive, negative, exact-boundary, just-under, just-over, ownership, staff-regression, state and timezone cases. Give each scenario a stable ID, rule ID, actor, preconditions, boundary value, expected business outcome, evidence reference, risk and unresolved questions.

Do not invent HTTP status codes, response fields or endpoints. Use the existing patient cancellation collection request only as provisional operation evidence. If staff cancellation or ownership behaviour is not proven by the pinned OpenAPI contract, mark that mapping unverified. Do not claim that the proposed 24-hour rule is implemented; the checked-in code default is 120 minutes.

Ask me to approve before creating or editing any collection requests. Do not send API requests or change environment variables. Return the matrix, coverage gaps, duplicates and questions requiring product-owner clarification.
