# Course alignment audit and correction log

**Course:** Agentic SDLC for API Automation  
**Branch baseline reviewed:** `course/agentic-sdlc-api-automation`, commit `a95bfd97a22b1bf9d12bfc35e1d732aa2a87f13b`  
**Scope:** Eight sections, 35 lesson folders, manifest, learner resources, sample lesson assets, Postman collection and repository structure.

## 1. Non-negotiable objective
Teach learners to use **Postman and its AI capabilities, especially Postman Agent Mode, to implement an Agentic SDLC for API automation**. The learner moves from a business change through AI-assisted requirement/test analysis, reviewed Postman collection changes, deterministic API assertions, Postman CLI execution, GitHub Actions, failure diagnosis and an evidence-backed release recommendation.

This is not a general Python agent-engineering course. Python may be part of the CareX service implementation, but learners must not need to build a separate Python test framework or orchestration service to achieve the course outcome.

## 2. Technology boundaries
| Capability | Course technology | Boundary |
|---|---|---|
| AI-assisted API lifecycle tasks | Postman Agent Mode | Primary agent experience; demonstrate live |
| API requests and functional tests | Postman collections/scripts | Primary automation artefact |
| Deterministic checks | Postman assertions and explicit policy checks | Verify agent output and API behaviour independently |
| Command-line execution | Postman CLI | Primary runner for new workflows |
| CI/CD | GitHub Actions | Execute reviewed collections and retain reports |
| Versioning/review | Git and GitHub | Human review and traceable changes |
| Legacy execution | Newman | Compatibility/migration context only |
| API under test | CareX FastAPI + Neon/PostgreSQL | Learners test the API; they do not build a Python testing curriculum |

## 3. Findings and corrections

### Corrected in this review
- Removed duplicate Lesson 1.3 directory and moved the Postman lab to the canonical lesson path.
- Removed the Python policy-gate lab from the course branch; it was not aligned with the learner objective.
- Removed Section 1 folders incorrectly containing Section 8 resources.
- Removed Section 8 folders incorrectly containing Section 7 resources.
- Reframed setup so Python is not a core learner prerequisite.
- Reframed Section 3 around Postman Agent Mode, bounded task hand-offs, structured outputs and review boundaries.
- Reframed Section 6 so Postman CLI is primary and Newman is legacy migration context.
- Replaced Lesson 1.3's placeholder README with a measurable Postman-first outcome.
- Added a learner hand-off for actual Agent Mode output: copy JSON into the Postman collection variable `agentProposal`, then run deterministic validation. Static fixtures are explicitly instructor examples, not live AI output.

### Open defects requiring implementation
- The 35 lesson READMEs are not yet full teaching scripts/storyboards. Several retain placeholder outcomes and asset indexes.
- Many quizzes and assignments remain generic templates rather than lesson-specific assessment items.
- Sections 3–8 do not yet demonstrate a complete Postman Agent Mode workflow in every relevant lesson.
- Section 4 needs traceable scenarios grounded in the actual CareX OpenAPI contract.
- Section 5 needs real Postman collection build/edit exercises.
- Section 6 needs a clean-machine CLI install/run, a working GitHub Actions pipeline, verified report artefacts and an actual Newman compatibility demonstration.
- Section 7 needs reproducible failure evidence and a deterministic release policy.
- Section 8 capstone has not been executed end to end against a dedicated non-production database.
- Postman Agent Mode access, AI consent, account/plan requirements and paid dependencies must be confirmed and disclosed before recording.
- The governance collection has not yet been imported and executed in the Postman app; app-level validation is still open.
- No learner ZIP is approved until clean-checkout and attachment tests pass.

## 4. Lesson release gate
Every lesson must meet all applicable criteria with evidence:
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

Each criterion must score 10/10; no averaging. No score without a concrete artefact or rehearsal evidence. A lesson is not recording-ready until learners can understand, reproduce, diagnose and independently verify the capability.

## 5. Disposition
**Course status: production in progress — not recording-ready.** This review corrected structural and technology-boundary defects. It does not claim the course is complete; the open defects above must be closed and evidenced before release.
