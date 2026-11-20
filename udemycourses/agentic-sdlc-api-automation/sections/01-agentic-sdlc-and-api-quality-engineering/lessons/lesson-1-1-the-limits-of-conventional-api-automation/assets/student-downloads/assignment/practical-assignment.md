# Lesson 1.1 practical assignment — expose a coverage blind spot

## Scenario
CareX currently allows a patient to request an available appointment. A new business rule will restrict bookings to the next 30 calendar days. The existing API regression suite reports green, but no test has been mapped to this new rule.

## Task
Create a one-page change-to-test traceability analysis.

## Starter
Use `coverage-gap-template.csv` and `booking-rule-change.json`.

## Deliverables
1. Complete the traceability CSV with the new rule, affected API behaviour, candidate test and evidence required.
2. Identify at least one reason the existing green suite could provide false confidence.
3. Write one positive and two negative/boundary scenarios, including day 30 and day 31.
4. State which parts should be handled by an agent and which require deterministic validation or human approval.

## Acceptance criteria
- The new 30-day rule is explicit and testable.
- Day 30 and day 31 are distinguished.
- Each scenario has a precondition, request input and expected outcome.
- The analysis does not claim the current API already enforces this rule.
- Each proposed test traces to the business rule.

## Verify
A reviewer should be able to derive the same expected outcomes from the stated rule without guessing timezone or inclusive-boundary semantics. If the rule does not specify those details, record them as open questions.
