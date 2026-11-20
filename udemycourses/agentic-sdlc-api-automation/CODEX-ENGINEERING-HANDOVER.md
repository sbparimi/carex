# Codex — Engineering Handover

## Assignment

Continue engineering the existing **Agentic SDLC for API Automation** course repository. Do not redesign the curriculum or change the learner promise.

Repository: https://github.com/sbparimi/carex  
Branch: `course/agentic-sdlc-api-automation`  
Course root: `udemycourses/agentic-sdlc-api-automation/`  
Handover baseline: `672124b1064632fbe04ce0c3f9c93c5953022b3b`

Read `PRODUCTION-HANDOVER.md`, `README.md`, `course-manifest.json`, `ALIGNMENT-AUDIT.md`, all eight section READMEs, and all 35 lesson packs before making changes.

## Primary responsibilities

1. Audit the complete 35-lesson course and report missing, generic, contradictory or broken artefacts.
2. Preserve the seven-part lesson format: Opening, Concept, Why, Demo, Build, Verify, Recap.
3. Ensure all lessons have a measurable outcome, bespoke quiz, practical assignment, starter, expected results and completed reference solution where appropriate.
4. Build runnable Postman collections, environment fixtures, Agent Mode prompt packs and deterministic verification steps.
5. Build and validate Postman CLI and GitHub Actions workflows using current official documentation.
6. Create reproducible failure fixtures, evidence-based triage exercises and deterministic release gates.
7. Execute CareX integration/capstone tests only against a dedicated disposable Neon branch.
8. Produce a source-to-script evidence map and production-ready technical notes for Instinct.
9. Maintain the 13-point scorecard for every lesson and update the alignment audit with evidence.
10. Keep all student assets distinct from instructor scripts, storyboards and production notes.

## Fixed technical boundaries

- Postman Agent Mode/native Postman AI is the primary agent experience.
- Postman collections are the primary API automation artefacts.
- Postman CLI is the primary runner.
- GitHub Actions is the CI/CD workflow.
- Newman is legacy compatibility/migration context only.
- Python is not a core learner prerequisite and must not replace Postman in demonstrations.
- Agents propose; deterministic tools verify and execute; humans approve high-impact changes and release decisions.
- Do not invent API contracts, status codes, response schemas, business rules or runtime behaviour.
- Consult Section 04 implementation evidence: the proposed 24-hour cancellation-denial change is synthetic; current CareX source has a 120-minute online change restriction and a separate 24-hour late-cancel classification flag.

## Safety and repository rules

- Work only on `course/agentic-sdlc-api-automation`.
- Never merge to main.
- Never change repository settings or branch protections.
- Never commit secrets, tokens, database URLs, credentials or real personal data.
- Never seed or write to production/shared databases.
- Do not use Vercel Preview for mutating tests while its Neon variables are shared with production.
- The CareX test suite requires a dedicated empty Neon test branch because tests truncate tables.
- Do not sign in, connect accounts, grant OAuth consent, install paid services, spend credits, upload publicly or publish without explicit user approval.
- Never claim a test, demo, build or lesson is verified unless it ran and evidence is retained.

## Definition of done

A lesson is ready only when its technical artefacts work from a clean checkout, the demo has been run, the reference solution is reproducible, all relative links resolve, an independent learner can complete the task, and all 13 criteria score 10/10 with evidence. No averaging.

A course is not recording-ready while any lesson has an unresolved release blocker. Update the production tracker and `ALIGNMENT-AUDIT.md` after each verified change. Report exact commit SHAs, commands run, outcomes, evidence paths and blockers.
