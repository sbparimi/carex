# Lesson 2.4 — Change detection and impact analysis

## Outcome
Compare pinned revisions, connect changed contract/implementation evidence to impacted rules and journeys, and rank test impact.

## Scenario
A PR changes cancellation-window validation and its OpenAPI description. The change-intelligence workflow must propose focused regression, not autonomously modify tests or approve release.

## Seven-part lesson activity
- **Opening:** Changed files alone are not a test impact analysis.
- **Concept:** Diff base/head; resolve changed symbols and contract operations; trace to rules/journeys/tests; rank risk.
- **Why:** Semantic changes can hide behind description-only or shared-code changes.
- **Demo:** Review a synthetic diff summary and separate observed changes from hypotheses.
- **Build:** Complete the impact matrix.
- **Verify:** Every priority has evidence and rationale; shared dependencies are inspected.
- **Recap:** An agent proposes; a reviewer approves.

## Starter change facts (synthetic)
- Base revision: `carex-base-demo-01`
- Head revision: `carex-head-demo-02`
- `carex/api/patient_appointments.py`: validation logic changed.
- `openapi/carex-openapi.yaml`: cancellation description and response documentation changed.
- No evidence yet that staff cancellation code changed.

## Impact matrix
| Rule | Journey | Evidence | Priority | Proposed test |
|---|---|---|---|---|
| BR-02 | Allowed patient cancellation | Validation changed | P0 | >24h allowed |
| BR-03 | Exact boundary | Validation changed | P0 | exactly 24h rejected |
| BR-01 | Ownership | Dependency review required | P1 | cross-patient cancellation denied |
| BR-04 | Staff cancellation | Check shared code | P1/P2 | staff policy regression |

## Knowledge check
1. Strongest change evidence? **Reproducible diff between pinned base/head revisions.**
2. Description-only change can matter? **Yes; semantic meaning can change without schema shape changes.**
3. Test priority basis? **Business impact, likelihood, exposure and change reach with rationale.**

## Practical assignment
Create `impact-analysis.csv` and `test-selection.md`. Link changed files/symbols to rules, journeys and existing tests. Rank P0/P1/P2. Include boundary, timezone, ownership and staff regression. Explain excluded tests and inspect shared dependencies. Treat the starter diff as synthetic, not a real repo diff.

## Reference solution
P0: >24h eligibility and exact boundary. P1: timezone conversion and ownership. Staff regression remains in scope until shared validation dependencies are inspected. A filename-only inference is insufficient. Each priority cites a changed symbol, contract diff or dependency.

## Verification checklist
- [ ] Base/head revisions pinned
- [ ] Changed symbols and contract operations identified
- [ ] Rule/journey/test traceability present
- [ ] Priority rationale evidence-backed
- [ ] Shared dependencies reviewed
