# Course alignment audit and correction log

**Course:** Agentic SDLC for API Automation  
**Branch:** course/agentic-sdlc-api-automation  
**Review baseline before Section 04 rework:** bc904505d23f26b2e1ee14facc21dfdd83b24819  
**Scope:** All eight sections, 35 lesson folders, course manifest, learner standards, setup, assessments, sample demos and repository structure.

## 1. Non-negotiable objective
Teach learners to use Postman and its AI capabilities, especially Postman Agent Mode, to implement an Agentic SDLC for API automation. Learners move from a business change through AI-assisted analysis and test planning, reviewed Postman collection changes, deterministic API assertions, Postman CLI execution, GitHub Actions, failure diagnosis and an evidence-backed release recommendation.

This is not a general Python agent-engineering course. Python is not a core learner prerequisite and must not replace Postman in demonstrations. Learners should use Agent Mode/native Postman AI to generate or update Postman requests and test scripts, then review and verify the generated work; handwritten JavaScript is not the primary skill being taught.

## 2. Technology boundaries
| Capability | Course technology | Boundary |
|---|---|---|
| AI-assisted API lifecycle tasks | Postman Agent Mode | Primary agent experience; live demonstration required |
| API requests and functional tests | Postman collections/scripts | Primary API automation artefact |
| Deterministic checks | Postman assertions and policy checks | Verify agent output and API behaviour independently |
| Command-line execution | Postman CLI | Primary runner for new workflows |
| CI/CD | GitHub Actions | Execute reviewed collections and retain reports |
| Versioning/review | Git and GitHub | Human review and traceable changes |
| Legacy execution | Newman | Compatibility/migration context only |
| API under test | CareX FastAPI + Neon/PostgreSQL | Learners test the API; they do not build a Python testing curriculum |

## 3. Structural and curriculum corrections completed
- Removed duplicate Lesson 1.3 directory and moved the Postman lab into the canonical path.
- Removed the Python policy-gate lab from the course branch.
- Removed Section 1 folders that incorrectly contained Section 8 lesson resources.
- Removed Section 8 folders that incorrectly contained Section 7 lesson resources.
- Removed a duplicate Section 4 copy of Section 3 Lesson 3.5; the canonical lesson remains in Section 3.
- Confirmed repository contains eight sections, 35 lesson folders, 35 lesson READMEs, 35 knowledge checks and 35 bespoke practical assignments.
- Verified the course tree has no duplicate Lesson 1.3 path, no misplaced Section 7/8 lesson folders, and no Python source files.
- Parsed the Postman governance collection JSON; confirmed its three requests are GET-only and its default agentProposal variable is valid JSON. This is structural validation only, not Postman app execution.
- Reframed learner setup so Python is not a core prerequisite.
- Reframed Section 3 around Postman Agent Mode, bounded task hand-offs, structured proposals and human review. No custom Python orchestrator is required.
- Reframed Section 4 around AI-assisted traceable test planning, positive/negative/boundary coverage, risk-based regression and hallucination review.
- Reframed Section 5 around Postman Agent Mode-generated collection work, variables, safe environments and business assertions.
- Reframed Section 6 so Postman CLI is primary and Newman is legacy migration context.
- Reframed Section 7 around execution evidence, bounded AI diagnosis and deterministic release policy.
- Reframed Section 8 around the full CareX change-to-release capstone.
- Rewrote Section 1 lesson outcomes to align with Postman Agent Mode.
- Added bespoke quiz and practical assignment content across all 35 lessons. This is authoring evidence only; it is not proof of technical execution or recording readiness.
- Integrated Agent Mode into Section 2 requirements and change-intelligence activities.
- Updated the learner standard: use Agent Mode/native Postman AI to generate scripts, then review and verify; do not teach handwritten JS as the core outcome.
- Added a Postman governance lab with safe/unsafe fixtures and a learner hand-off for actual Agent Mode JSON output.

## 4. Section 04 rework — authored assets and source findings
Section 04 now has a 90-minute four-lesson progression:
1. 4.1 Build a traceable test-planning contract.
2. 4.2 Generate positive, negative and boundary scenarios.
3. 4.3 Prioritise regression by business impact.
4. 4.4 Review hallucinations, omissions and weak assertions.

Added:
- Postman Agent Mode proposal-only prompts for all four lessons.
- Synthetic CareX change fixture, evidence register and JSON test-plan schema.
- Scenario seed CSV and completed reference scenario matrix.
- Regression candidate matrix, explicit weighted scoring model and corrected reference ranking.
- Deliberately flawed Agent Mode proposal and evidence-based defect review.
- Expected-result guides and reference solutions.
- Four instructor scripts and four editable slide storyboards.
- Integrated Section 04 assignment and 12-question knowledge check.
- OpenAPI contract-capture checklist and section release-evidence ledger.

**Important CareX source finding:** the checked-in Scheduling service defaults its online change gate to 120 minutes. Patient cancellation invokes that guard. Separately, tenants.late_cancel_hours defaults to 24 and sets a late_cancel classification flag; that flag does not itself block cancellation. Staff/system actors bypass the online change-window guard. The synthetic proposed 24-hour cancellation-denial rule is therefore a change to existing behaviour, not an existing feature. This distinction is documented in Section 04 implementation evidence and must be retained in teaching materials.

The checked-in Postman training collection shows a POST patient cancellation request and a separate staff cancellation request. The collection does not prove response status codes or response schemas. The runtime OpenAPI document has not yet been pinned.

## 5. Remaining release blockers
- The Postman governance collection has not yet been imported and executed in the Postman app.
- Live Agent Mode demonstrations and feature-access checks have not been recorded/rehearsed for every relevant section, including Section 04.
- Several lessons across the course still need full instructor scripts, visual storyboards, timed narration and learner rehearsal.
- Section 04 prompts and artefacts are authored, but actual Postman Agent Mode output, pinned runtime OpenAPI evidence, and independent learner completion are still outstanding.
- Starter files, expected results and tested reference solutions remain incomplete for a number of lessons outside the Section 04 work completed in this revision. README placeholders are not proof of working labs.
- Section 5 requires end-to-end Postman Agent Mode generation and review of collection requests, variables and assertions.
- Section 6 requires a clean-machine Postman CLI run, working GitHub Actions workflow, retained reports and a controlled Newman compatibility demonstration.
- Section 7 requires reproducible failure fixtures and actual evidence-backed diagnosis/release-gate execution.
- Section 8 capstone has not been executed end to end against a dedicated disposable non-production database.
- Postman Agent Mode account access, AI consent, plan constraints and any paid dependencies must be confirmed and disclosed before recording.
- No learner ZIP is approved until clean-checkout, link, attachment and independent learner tests pass.
- No 13-point lesson scorecard has been evidenced at 10/10 for every lesson.

## 6. Mandatory lesson release gate
Every lesson must score 10/10 on all applicable criteria with retained evidence:
1. Outcome-first
2. Business context
3. Progressive concepts
4. Instructor demonstration with reasoning
5. Learner prediction
6. Intentional failure and troubleshooting
7. Independent learner practice
8. Expected-result interpretation and verification
9. Completed reference solution
10. Continuity across the CareX project
11. Narration synchronized with visuals
12. Appropriate pacing
13. Learner resources

No averaging. A score without a concrete artefact or rehearsal evidence is invalid. A lesson is not recording-ready until learners can understand, reproduce, diagnose and independently verify the capability.

## 7. Disposition
**Course status: production in progress — not recording-ready.** Structural, curriculum and technology-boundary deviations have been corrected. Section 04 has received a substantive asset rework, but its live Postman, OpenAPI, runtime and learner-rehearsal gates remain open. The remaining blockers above require implementation and evidence before course release.
