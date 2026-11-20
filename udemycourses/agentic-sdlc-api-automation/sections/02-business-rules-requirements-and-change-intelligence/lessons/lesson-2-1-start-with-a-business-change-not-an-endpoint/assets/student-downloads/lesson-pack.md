# Lesson 2.1 — Start with a business change, not an endpoint

## Outcome
Convert a business change into a source-linked change brief separating facts, assumptions, unknowns and candidate journeys.

## CareX scenario
Product proposes patient self-service appointment cancellation before a cancellation cutoff. The cutoff duration, boundary inclusivity, timezone, staff scope and inside-window behaviour are not initially defined.

## Seven-part lesson activity
- **Opening:** A green API suite does not prove an untested business rule.
- **Concept:** Start from outcome, actor, policy, source revision and constraints.
- **Why:** Endpoint-first analysis misses business journeys and ambiguity.
- **Demo:** Decompose the supplied story into confirmed facts and open questions.
- **Build:** Complete the starter change brief.
- **Verify:** Another learner must trace each fact to its source field and identify every unknown.
- **Recap:** Do not turn assumptions into requirements.

## Starter fixture
```json
{
  "change_id": "CAREX-214",
  "source_revision": "demo-story-v1",
  "business_statement": "Patients should be able to cancel an appointment themselves before the cancellation cutoff.",
  "known_facts": ["Patient self-service is in scope", "Appointments have scheduled start times"],
  "unknowns": ["Cutoff duration and inclusivity", "Clinic timezone or UTC", "Staff-created appointment scope", "Inside-window behaviour"],
  "constraints": ["Do not infer policy values", "Never write to production"],
  "requested_outputs": ["change brief", "open questions", "candidate journeys"]
}
```

## Knowledge check
1. Correct starting point? **Business outcome and source change**, not guessed endpoint.
2. “Easy cancellation” has no cutoff. **Record ambiguity and ask for a decision**; do not invent 24 hours.
3. Why pin source revision? **Reproducibility and provenance.**

## Practical assignment
Produce `change-brief.md` and `open-questions.csv`. Separate facts, assumptions, unknowns and constraints. Cite source fields. Rank questions by whether they block test design. Identify patient and staff journeys as candidate impacts, with staff scope marked unconfirmed.

## Reference solution
State the self-service capability; keep duration, boundary, timezone, appointment origin and inside-window behaviour unresolved. Do not invent 24 hours. Product must resolve blocking policy questions before final test design.

## Verification checklist
- [ ] No unsupported policy values
- [ ] Every fact has a source reference
- [ ] Unknowns have an owner or next action
- [ ] Candidate journeys are distinguished from confirmed scope
