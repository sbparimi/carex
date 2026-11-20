# Section 04 — Test Planning and Impact Analysis

**Planned duration:** 90 minutes  
**Lessons:** 4  
**Status:** Detailed learning packs authored; Postman app rehearsal and live API verification remain release gates.

## Section outcome
Use Postman Agent Mode to produce a traceable, risk-ranked API test plan from a business change and verified API evidence. Review the proposal, identify unsupported assumptions, and hand a human-approved plan to Section 5 for implementation in Postman collections.

## Lesson sequence
| Lesson | Duration | Learner capability | Carry-forward artefact |
|---|---:|---|---|
| 4.1 Build a traceable test-planning contract | 20 min | Define required evidence and structured output | Test-plan contract and traceability map |
| 4.2 Generate positive, negative and boundary scenarios | 25 min | Derive complete scenario coverage | Reviewed scenario matrix |
| 4.3 Prioritise regression by business impact | 20 min | Select a defensible regression scope | Ranked regression matrix |
| 4.4 Review hallucinations, omissions and weak assertions | 25 min | Reject unsupported AI output and approve a safe plan | Defect log and human-approved plan |

## One continuous CareX change
The section uses the synthetic proposed change CAREX-CHANGE-030-CANCEL-24H: patient self-cancellation is proposed to be denied when the appointment starts 24 hours or less from the current instant, and allowed only when it starts more than 24 hours away. The clinic timezone must be used to interpret appointment time and daylight-saving edge cases must be clarified. This is a planning exercise, not a claim that the rule is already implemented.

## Critical current-implementation distinction
The checked-in source has a 120-minute online change restriction in Scheduling and a separate 24-hour late-cancellation flag. The 24-hour late_cancel calculation classifies a cancellation; it does not block it. Staff/system cancellation bypasses the online change-window guard. See [implementation evidence](IMPLEMENTATION-EVIDENCE.md). The proposed change therefore alters current behaviour; learners must not describe it as already implemented.

## Evidence boundary
- The checked-in Postman training collection contains POST {{baseUrl}}/t/{{tenant}}/api/v1/appointments/{{appointmentId}}/cancel with a JSON body containing reason. This establishes the current training-collection request shape only.
- Before asserting status codes, error bodies, field names or response schemas, learners must inspect the matching OpenAPI document from the running CareX environment at /api/openapi.json and reconcile it with the implementation.
- A collection request is not a substitute for an OpenAPI contract. Source inspection is not deployment evidence.
- Use synthetic data and an isolated development database only. Do not run mutating cancellation tests against shared preview or production data.

## Section-level resources
- [OpenAPI contract-capture checklist](CONTRACT-CAPTURE-CHECKLIST.md)
- [Source implementation evidence](IMPLEMENTATION-EVIDENCE.md)
- [Release evidence ledger](SECTION-04-RELEASE-EVIDENCE.md)
- [Integrated assignment](assessment/section-04-integrated-assignment.md)
- [Integrated knowledge check](assessment/section-04-knowledge-check.md)

## Seven-part delivery pattern
Each lesson uses Opening → Concept → Why → Demo → Build → Verify → Recap. Instructor scripts and storyboards include prediction, deliberate failure, learner practice, expected-result interpretation and a hand-off to the next lesson.

## Release gate
This section is not recording-ready until the prompts have been rehearsed in Postman Agent Mode, contract evidence has been pinned to a specific CareX revision, exercises have been independently completed from a clean checkout, and each lesson passes all 13 mandatory quality criteria at 10/10 with evidence.
