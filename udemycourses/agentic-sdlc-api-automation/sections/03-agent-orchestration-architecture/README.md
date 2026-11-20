# Section 03 — Agent Orchestration Architecture

**Planned section:** 03 of 08  
**Lessons:** 5  
**Status:** Production in progress

## Learning outcome
Design a bounded Agentic SDLC workflow using Postman Agent Mode and the Postman API project context. Learners define specialist responsibilities as repeatable AI tasks, pass structured proposals between stages, validate outputs and preserve human approval boundaries. This section does not require a custom Python orchestration framework.

## Lesson focus
- **3.1 — Define workflow state and hand-offs:** map change intake, Agent Mode analysis, proposal review, Postman collection updates, CLI execution, diagnosis and release assessment.
- **3.2 — Design specialist-agent responsibilities:** define prompts and evidence inputs for requirement analysis, impact analysis, test planning, collection review and failure diagnosis.
- **3.3 — Structured outputs, schemas and validation:** constrain Agent Mode outputs to reviewable JSON and validate required fields/evidence in Postman.
- **3.4 — Retries, timeouts, idempotency and audit trail:** distinguish repeatable analysis from side-effecting API actions; preserve run evidence and Git history.
- **3.5 — Human review and permission boundaries:** review proposed collection edits, environment changes and CI actions; humans retain approval authority.

## Technology boundary
Postman Agent Mode is the primary learner-facing agent experience. Postman collections and scripts provide deterministic API assertions. Postman CLI executes collections. GitHub Actions coordinates CI. Python is not a required learner implementation and must not replace Postman in demonstrations.

## Carry-forward artefact
A reviewed workflow map, specialist prompt set, structured proposal example and Postman validation result. Lesson-specific artefacts and independent verification remain required.
