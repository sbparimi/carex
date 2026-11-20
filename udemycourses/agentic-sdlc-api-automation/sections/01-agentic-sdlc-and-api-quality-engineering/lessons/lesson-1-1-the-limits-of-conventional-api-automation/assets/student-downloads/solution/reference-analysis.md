# Reference analysis — Lesson 1.1

| Rule | Journey | Scenario | Expected result | Status |
|---|---|---|---|---|
| BR-030 | Patient books appointment | Valid slot inside agreed 30-day window | Accepted according to API contract | Proposed test |
| BR-030 | Patient books appointment | Slot exactly on day 30 | Depends on inclusive-boundary decision | Blocked by clarification |
| BR-030 | Patient books appointment | Slot on day 31 | Rejected according to agreed error contract | Proposed test |

The current green suite is insufficient because no traceability evidence shows it covers BR-030. An agent may identify likely affected journeys and propose tests. The product owner must resolve ambiguity. The API test runner must execute the approved cases and record actual responses.

This is a reference analysis, not evidence that the CareX API currently implements the proposed rule.
