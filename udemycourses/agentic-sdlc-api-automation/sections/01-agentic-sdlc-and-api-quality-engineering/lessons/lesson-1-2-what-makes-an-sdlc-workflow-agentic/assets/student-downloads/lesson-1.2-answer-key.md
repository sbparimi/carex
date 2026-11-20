# Lesson 1.2 answer key

Open this file only after completing the exercise.

| # | Primary owner | Rationale |
|---:|---|---|
| 1 | Agent | Natural-language interpretation; preserve source references and ambiguity. |
| 2 | Agent | Detect the missing timezone and raise an open question; do not invent the business rule. |
| 3 | Deterministic | Schema validation is objectively checkable and repeatable. |
| 4 | Agent | Semantic impact mapping proposes candidates; validate against contract and repository evidence. |
| 5 | Deterministic | The runner executes requests and records results. |
| 6 | Deterministic | An assertion compares actual and expected values. |
| 7 | Agent | Summarisation helps investigation, but the evidence links and raw report remain authoritative. |
| 8 | Deterministic | The versioned policy enforces the mandatory release rule. |
| 9 | Human | Risk acceptance requires an authorised accountable person and audit record. |
| 10 | Deterministic | Fixed, tested redaction rules must be consistently applied. |

## Scenario answer

**Expected outcome: BLOCKED.** Test `API-TENANT-004` failed and is marked mandatory. The raw test report and versioned release policy are authoritative. The model's GO summary is advisory and cannot change the gate result. The agent may explain the failure, correlate related evidence and propose investigation steps. An authorised human may approve an exception only through the documented risk process, with the approval recorded and scoped.

## Verification

Check the run identifier, mandatory test ID and raw status; confirm the policy version and rule; confirm the gate output is BLOCKED; confirm the model recommendation is stored separately.
