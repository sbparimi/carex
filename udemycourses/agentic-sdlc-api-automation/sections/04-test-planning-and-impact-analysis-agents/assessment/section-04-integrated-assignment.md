# Section 04 integrated assignment — CareX cancellation change test plan

## Objective
Create one human-reviewed test-planning package that can be handed to Section 5 without inventing API behaviour.

## Inputs
- Lesson 4.1 synthetic change fixture, evidence register and test-plan schema.
- Lesson 4.2 scenario seed and reference coverage.
- Lesson 4.3 regression candidates and scoring model.
- Lesson 4.4 intentionally flawed AI proposal and defect review guide.
- CareX Postman training collection.
- OpenAPI document captured from the exact disposable CareX build used in the exercise.

## Required workflow
1. Record the CareX source revision and OpenAPI revision.
2. Use Postman Agent Mode to propose a traceable plan. Preserve its raw output.
3. Generate positive, negative, boundary, ownership, role, state and timezone scenarios.
4. Rank regression candidates and justify coverage depth.
5. Review hallucinations, omissions, duplicate cases and weak assertions.
6. Produce a human-approved plan or explicitly mark it blocked.

## Submission package
- Original Agent Mode prompts and unmodified outputs.
- Source and contract evidence register.
- Structured test-plan JSON.
- Reviewed scenario matrix.
- Ranked regression matrix and scoring rationale.
- Defect log with evidence and corrections.
- Open questions and approval decision.
- A short reflection explaining what the AI could not establish.

## Acceptance criteria
- Every expected business outcome traces to the change fixture.
- Every API operation and response expectation traces to pinned OpenAPI evidence.
- Current implementation behaviour is not confused with the proposed 24-hour rule.
- The 120-minute implementation default is explicitly reconciled.
- Exact 24-hour, just-under and just-over cases are included.
- Patient ownership and staff permission concerns are separate.
- DST interpretation is either resolved by an authoritative rule or left as an explicit blocker.
- Risk ranking is reproducible and does not invent production metrics.
- Human approval is explicit and independent of Agent Mode.

## Release boundary
This assignment approves a plan for collection design only. It does not authorize mutating execution against shared preview or production data.
