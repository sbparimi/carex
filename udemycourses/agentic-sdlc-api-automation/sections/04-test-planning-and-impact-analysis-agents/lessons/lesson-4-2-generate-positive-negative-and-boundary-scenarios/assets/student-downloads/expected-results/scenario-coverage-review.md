# Expected result — Lesson 4.2

The reviewed matrix must include:
- Positive: more than 24 hours (for example 25 hours).
- Exact boundary: exactly 24 hours is denied.
- Just below: 23 hours 59 minutes 59 seconds is denied.
- Just above: 24 hours plus one second is allowed, subject to the requirement's exact instant semantics.
- Ownership: a patient cannot cancel another patient's appointment.
- Role regression: staff cancellation remains governed by existing staff permissions, not the patient threshold.
- State: already-cancelled appointment behaviour is an explicit question until implementation/contract evidence establishes it.
- Timezone: a daylight-saving transition requires clarification of elapsed 24-hour duration versus local wall-clock interpretation.

## Verification
Every row must identify the rule, actor, preconditions, evidence reference and business outcome. HTTP codes and response fields remain blank/unverified unless the pinned OpenAPI document supports them.

## Common failure
A generated matrix has only a happy path and “less than 24 hours”. It omits the exact 24-hour boundary, just-over case, ownership and DST semantics. Count scenario classes, not just rows.
