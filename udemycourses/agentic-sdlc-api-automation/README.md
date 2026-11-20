# Agentic SDLC for API Automation

**Subtitle:** Use Postman Agent Mode, Postman CLI and GitHub Actions to build evidence-driven API quality workflows  
**Planned duration:** Approximately 11 hours  
**Level:** Intermediate to advanced  
**Status:** Course production workspace — not recording-ready.

## Course objective
Teach learners to apply Postman Agent Mode to the API quality lifecycle: analyse a business change, derive traceable API test scenarios, propose and review Postman collection changes, verify API behaviour with deterministic assertions, execute collections through Postman CLI and GitHub Actions, diagnose failures and prepare an evidence-backed release recommendation.

## Technology boundaries
- **Postman Agent Mode:** primary AI-assisted workflow.
- **Postman collections and scripts:** primary API automation artefact and deterministic functional verification.
- **Postman CLI:** primary command-line runner for new workflows.
- **GitHub Actions:** CI orchestration and evidence retention.
- **Newman:** legacy compatibility/migration context only.
- **Python:** not a core learner prerequisite and not a replacement for Postman in course demonstrations.

## Student experience standard
The course uses one continuous CareX API project. Every practical lesson identifies the download, exact task, expected result, independent verification and checkpoint. Student downloads must be self-contained and separate from instructor production materials.

## Lesson structure
Every lesson follows: Opening → Concept → Why → Demo → Build → Verify → Recap.

## Architecture principle
Agents interpret and propose. Postman tests and CLI execute deterministic checks. GitHub Actions automates reviewed execution. Humans approve high-impact changes and release decisions.

## Capstone
The CareX appointment-cancellation change is the end-to-end capstone. Use synthetic data and a dedicated non-production database branch. Never include credentials, secrets, instructor-only materials or production identifiers in student downloads.

## Production handover
The following documents govern the handover to Codex and Instinct:
- [Master production handover](PRODUCTION-HANDOVER.md) — source of truth, responsibilities, safety boundaries and release gates.
- [Instinct video-production prompt](INSTINCT-VIDEO-PRODUCTION-PROMPT.md) — copy-ready instructions for video production.
- [Codex engineering handover](CODEX-ENGINEERING-HANDOVER.md) — repository, technical implementation and validation instructions.
- [Course alignment audit](ALIGNMENT-AUDIT.md) — deviations corrected and outstanding release blockers.
