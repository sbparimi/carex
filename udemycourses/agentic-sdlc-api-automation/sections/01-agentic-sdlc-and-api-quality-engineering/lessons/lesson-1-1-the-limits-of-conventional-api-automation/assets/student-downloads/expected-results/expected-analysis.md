# Expected analysis — Lesson 1.1

The existing green suite cannot establish that the new 30-day rule is implemented. It may be testing only the previously documented behaviour.

Minimum scenario set:
- Positive: an otherwise valid slot inside the allowed window is accepted.
- Boundary: a slot exactly on day 30 follows the agreed inclusive/exclusive rule.
- Negative: a slot on day 31 is rejected.

Open questions must remain open until a product owner or authoritative requirement resolves them. Do not invent timezone semantics or staff-booking scope.

A passing result requires the learner's traceability row to connect the proposed rule to a concrete API journey and independently verifiable expected result.
