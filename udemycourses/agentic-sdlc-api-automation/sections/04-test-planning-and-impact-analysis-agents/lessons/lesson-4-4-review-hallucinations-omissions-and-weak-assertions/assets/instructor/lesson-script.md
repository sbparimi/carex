# Instructor script — Lesson 4.4 (25 minutes)

## Outcome
Learners can identify hallucinated API facts, missing scenarios, duplicate coverage and weak assertions in an Agent Mode proposal, then produce a human-reviewed correction.

## 1. Opening — 2 min
Show the flawed proposal without revealing the intentional-defect list. Ask learners to mark the first item they would refuse to merge into a Postman collection.

## 2. Concept — 4 min
Explain four review lenses: contract fidelity, business-rule coverage, actor/ownership scope and assertion strength. A test is not strong merely because it checks an HTTP status.

## 3. Why — 3 min
An invented response field can make the collection brittle or false-green. Missing the exact boundary can leave the most important rule untested. A self-review by the same AI is not independent verification.

## 4. Demo — 6 min
Use Postman Agent Mode to inspect the flawed proposal. Ask it to list unsupported claims and omissions before revising anything. Compare its defect log with the reference defect table. Do not let it edit the live collection.

## 5. Build — 5 min
Learners annotate each defect, provide evidence and ask Agent Mode to revise the proposal. They preserve both the raw and revised outputs.

## 6. Verify — 4 min
Use the defect review CSV. Confirm all critical/high defects have a source-backed correction and a verification method. Check that the exact boundary exists and staff permissions remain a separate concern.

## 7. Recap — 1 min
Learners approve the scenario plan for Section 5 only after contract mapping and human review. No Agent Mode proposal self-approves.

## Safety
Use a copy of the collection and synthetic fixture. No mutating API execution during this lesson.
