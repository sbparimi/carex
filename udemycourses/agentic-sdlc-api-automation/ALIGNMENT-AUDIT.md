# Course alignment audit and correction log

**Course:** Agentic SDLC for API Automation  
**Branch:** `course/agentic-sdlc-api-automation`  
**Latest reviewed baseline before this audit update:** `88700a79bfd58c0afbee029b9032d177f3321c0a`  
**Scope:** All eight sections, 35 lesson folders, course manifest, learner standards, setup, assessments, sample demos and repository structure.

## 1. Non-negotiable objective
Teach learners to use **Postman and its AI capabilities, especially Postman Agent Mode, to implement an Agentic SDLC for API automation**. Learners move from a business change through AI-assisted analysis and test planning, reviewed Postman collection changes, deterministic API assertions, Postman CLI execution, GitHub Actions, failure diagnosis and an evidence-backed release recommendation.

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
- Confirmed repository contains eight sections, 35 lesson folders, 35 lesson READMEs, 35 knowledge checks and 35 practical assignments.
- Reframed learner setup so Python is not a core prerequisite.
- Reframed Section 3 around Postman Agent Mode, bounded task hand-offs, structured proposals and human review.
- Reframed Section 4 around AI-assisted traceable test planning and risk-based impact analysis.
- Reframed Section 5 around Postman Agent Mode-generated collection work, variables, safe environments and business assertions.
- Reframed Section 6 so Postman CLI is primary and Newman is legacy migration context.
- Reframed Section 7 around execution evidence, bounded AI diagnosis and deterministic release policy.
- Reframed Section 8 around the full CareX change-to-release capstone.
- Rewrote Section 1 lesson outcomes to align with Postman Agent Mode.
- Added bespoke quiz and practical assignment content across all 35 lessons. This is authoring evidence only; it is not proof of technical execution or recording readiness.
- Integrated Agent Mode into Section 2 requirements and change-intelligence activities.
- Added official Postman documentation references.
- Updated the learner standard: use Agent Mode/native Postman AI to generate scripts, then review and verify; do not teach handwritten JS as the core outcome.
- Added a Postman governance lab with safe/unsafe fixtures and a learner hand-off for actual Agent Mode JSON output.

## 4. Remaining release blockers
- The Postman governance collection has not yet been imported and executed in the Postman app.
- Live Agent Mode demonstrations and feature-access checks have not been recorded/rehearsed for every relevant section.
- Several lessons still need full instructor scripts, visual storyboards, timed narration and learner rehearsal.
- Starter files, expected results and tested reference solutions are incomplete for a number of lessons. README placeholders are not proof of working labs.
- Section 4 requires contract-grounded scenario generation against the pinned CareX OpenAPI revision.
- Section 5 requires end-to-end Postman Agent Mode generation and review of collection requests, variables and assertions.
- Section 6 requires a clean-machine Postman CLI run, working GitHub Actions workflow, retained reports and a controlled Newman compatibility demonstration.
- Section 7 requires reproducible failure fixtures and actual evidence-backed diagnosis/release-gate execution.
- Section 8 capstone has not been executed end to end against a dedicated disposable non-production database.
- Postman Agent Mode account access, AI consent, plan constraints and any paid dependencies must be confirmed and disclosed before recording.
- No learner ZIP is approved until clean-checkout, link, attachment and independent learner tests pass.
- No 13-point lesson scorecard has been evidenced at 10/10 for every lesson.

## 5. Mandatory lesson release gate
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

## 6. Disposition
**Course status: production in progress — not recording-ready.** Structural, curriculum and technology-boundary deviations have been corrected. The remaining blockers above require implementation and evidence before course release.
