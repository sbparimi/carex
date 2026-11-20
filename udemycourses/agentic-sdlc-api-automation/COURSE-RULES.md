# Course Rules — Agentic SDLC for API Automation

**Course title:** Agentic SDLC for API Automation  
**Subtitle:** Build Autonomous API Quality Engineering with Postman, Postman CLI and GitHub Actions  
**Planned duration:** approximately 11 hours  
**Level:** Intermediate to advanced  
**Course status:** Production in progress; not recording-ready.

These rules govern curriculum scope, technical accuracy, learner experience, course assets, production and release. They are mandatory for Codex, Instinct, reviewers and anyone modifying course materials.

## 1. Course purpose and learner promise

Teach learners to use AI-assisted, evidence-driven practices across the API quality lifecycle:

1. Interpret a business requirement or software change.
2. Derive traceable API scenarios and acceptance checks.
3. Assess change impact and prioritise regression.
4. Use Postman Agent Mode/native Postman AI to propose or update API requests and tests.
5. Review AI-generated changes and verify them deterministically.
6. Execute collections with Postman CLI and automate them in GitHub Actions.
7. Diagnose failures using evidence.
8. Produce a controlled, evidence-backed release recommendation.

The course is not a generic AI overview, a Python automation course or a course about building a custom autonomous agent framework.

## 2. Target learners and prerequisites

**Target learners:** QA automation engineers, SDETs, API test engineers, test architects, QA managers, release engineers, developers and DevOps engineers.

**Expected background:** familiarity with HTTP APIs, JSON, basic API testing concepts, Git/GitHub fundamentals and software delivery workflows. Learners should be comfortable navigating a desktop application and following command-line setup instructions.

Do not assume learners are Python developers. Explain any required terminal or Git operation. State required accounts, software, versions, permissions and potential plan restrictions before the learner reaches a task that depends on them.

## 3. Fixed curriculum structure

The approved course contains eight sections and 35 lessons:

| Section | Topic | Planned time |
|---|---|---:|
| 1 | Agentic SDLC and API Quality Engineering | 1 hour |
| 2 | Business Rules, Requirements and Change Intelligence | 1 hour |
| 3 | Agent Orchestration Architecture | 1.5 hours |
| 4 | Test Planning and Impact Analysis | 1.5 hours |
| 5 | Postman Collection Workflows | 1.5 hours |
| 6 | Postman CLI, Newman and GitHub Actions | 1.5 hours |
| 7 | Failure Diagnosis and Release Governance | 1 hour |
| 8 | CareX End-to-End Capstone | 2 hours |

Do not change the course title, promise, section outcomes, capstone or technology priorities without explicit approval. A proposed change must include the reason, affected lessons, learner impact, dependencies and updated assessment/resource plan.

## 4. Technology rules — mandatory

### Primary learner tools
- **Postman Agent Mode / native Postman AI:** primary AI-assisted workflow. Learners use natural-language prompts to create or update requests, tests and related collection artefacts, then inspect and verify the result.
- **Postman collections:** primary API automation artefact.
- **Postman CLI:** primary command-line collection runner for new workflows.
- **Git and GitHub:** version control, review, traceability and collaboration.
- **GitHub Actions:** CI execution and retained workflow evidence.

### Newman boundary
Newman is legacy compatibility and migration context only. Do not teach Newman as an equal alternative or the recommended runner for new workflows. Explain the distinction accurately and keep the hands-on path Postman CLI-first.

### Python boundary
Python is not a core learner prerequisite and must not replace Postman in demonstrations or assignments. CareX is implemented with FastAPI/Python; learners use it as the API under test. Do not add Python-based learner automation frameworks to the course path.

### Feature and plan accuracy
Verify current Postman Agent Mode availability, consent requirements, plan restrictions and UI behaviour before recording. Never claim a feature is free, universally available or enabled for every learner unless verified against current official documentation and the actual account used for the demo. Provide an alternative path or clearly disclose a dependency when access may vary.

## 5. AI and automation architecture principles

- Agents interpret, reason, generate proposals and explain.
- Deterministic tools validate contracts, execute requests and evaluate explicit assertions.
- Humans review and approve high-impact changes and release decisions.
- AI-generated output is untrusted until inspected and tested.
- AI recommendations cannot override mandatory deterministic release gates.
- A green AI-generated summary is not evidence of API correctness.
- Preserve traceability from business requirement → acceptance criteria → API/journey → test scenario → collection request/assertion → execution evidence → release decision.

## 6. Safety, security and governance

Teach and demonstrate controls for:
- Prompt injection embedded in tickets, API responses, specifications or other untrusted content.
- Secret and personal-data exposure in prompts, environment files, logs, screenshots, commits and recordings.
- Excessive agent permissions and unsafe write operations.
- Unreviewed changes to collections, environments, APIs or CI configuration.
- Non-deterministic AI output and unsupported assertions.
- Uncontrolled test data mutation and cross-tenant data leakage.

Use least privilege, synthetic data, schema/allow-list validation, isolated environments, approval gates, auditable logs and deterministic checks. Keep secrets in approved secret stores; never paste secrets into AI prompts, commit them or display them in recordings.

## 7. CareX project rules

CareX is the continuous teaching project and capstone API. Preserve the existing application and its source of truth.

- Use synthetic demo identities and data only.
- Use a dedicated non-production Neon database branch for write-enabled demonstrations and tests.
- Never seed, truncate or mutate production or shared databases.
- The test suite uses a dedicated empty Neon test branch; it can truncate tables.
- Do not enable writes against a Vercel Preview environment while it shares production database integration variables.
- Never expose database URLs, passwords, API keys, tokens or other credentials in prompts, files, screenshots, logs or learner downloads.
- Verify API behaviour and business rules against the current pinned source before writing scripts or narration.
- Do not invent endpoints, status codes, schemas, response payloads, roles or workflow states.

### Cancellation-policy distinction

The current CareX implementation distinguishes:
1. A 120-minute online change restriction: patient-initiated online cancellation/change is blocked inside this window.
2. A 24-hour late-cancellation classification: a cancellation can be classified as late; this flag does not itself block cancellation.
3. Staff/system cancellation paths have different bypass behaviour.

The course's proposed 24-hour cancellation-denial change is a synthetic change request, not current CareX behaviour. Every lesson and demo must label the proposed behaviour as a change under test and distinguish it from existing implementation. Do not conflate the 120-minute restriction with the 24-hour classification.

## 8. Lesson design and production rules

Every lesson must:
- Follow the exact seven-part structure: Opening → Concept → Why → Demo → Build → Verify → Recap.
- Follow all UCF Instructional Quality Rules in [UCF-INSTRUCTIONAL-QUALITY-RULES.md](UCF-INSTRUCTIONAL-QUALITY-RULES.md).
- Have one clear learner outcome and aligned assessment.
- Use meaningful business context and the continuous CareX project.
- Include prediction, practical learner activity, expected results and independent verification.
- Include a meaningful failure/diagnostic experience where relevant.
- Provide a complete reference solution or checkpoint.
- Use real, verified application demonstrations.
- Keep student-facing resources separate from instructor-only production notes.

A lesson is not complete merely because a script, slide deck, prompt or video exists.

## 9. Required lesson asset package

For each of the 35 lessons, maintain as applicable:
- Lesson README and measurable outcome.
- Instructor narration script.
- Seven-part storyboard and scene/timecode plan.
- Postman Agent Mode prompt pack where relevant.
- Starter files and setup instructions.
- Expected results and verification steps.
- Complete reference solution/checkpoint.
- Knowledge check/quiz with answer rationale.
- Practical assignment and acceptance criteria.
- Student download index.
- Technical execution evidence for runnable activities.
- Production notes, captions, transcript and video.
- UCF 13-point scorecard and independent reviewer sign-off.

Conceptual lessons should use appropriate structured artefacts rather than adding unnecessary code. Technical lessons must contain real, runnable examples where the lesson promises execution.

## 10. Student experience and access

- Keep all learner instructions self-contained and in the order they are needed.
- State setup prerequisites before the activity, not after it fails.
- Identify required files by exact path and filename.
- Explain how to reset the lab safely.
- Include expected output and a way to distinguish pass, fail and inconclusive results.
- Do not require paid access without prominent disclosure and a practical alternative where feasible.
- Do not require real customer data, production credentials or access to the author's private systems.
- Ensure a clean checkout contains the materials needed to complete the course.
- Do not expose instructor scripts, internal scorecards, private production notes or credentials in student downloads.

## 11. Repository and collaboration rules

- The GitHub repository and current course branch are the source of truth.
- Current working branch: `course/agentic-sdlc-api-automation`.
- Keep course changes on this branch unless explicitly directed otherwise.
- Do not merge to `main`, publish releases, change repository settings or rewrite history without explicit approval.
- Inspect the current branch head and files before editing.
- Preserve existing CareX application files unless a change is explicitly required and approved.
- Validate JSON, YAML, CSV, scripts, relative links and learner instructions. Retain actual command output and test evidence.
- Do not claim that a test, Postman workflow, CI run, recording or feature has been verified unless it was actually run and evidence is retained.
- Record blockers, assumptions, source versions and decisions in the relevant audit/lesson files.

## 12. Content integrity rules

Never fabricate:
- Product UI or feature behaviour.
- AI prompts or generated responses presented as actual captures.
- API endpoints, schemas, status codes, business rules or test results.
- Performance figures, quality metrics, customer stories, testimonials or case studies.
- Certifications, credentials, legal entities or endorsements.
- Successful executions, reviewer sign-offs or learner outcomes.

Separate verified facts, synthetic scenarios, proposed changes, assumptions and illustrative examples. Label synthetic or illustrative content clearly.

## 13. UCF quality gate and course release gate

Apply the 13-criterion UCF scorecard to every lesson. Each criterion must score 10/10 with evidence; no averaging is permitted.

A lesson is releasable only after:
1. Technical claims and business rules are source-verified.
2. Required hands-on steps have been executed in a safe environment.
3. Student assets work from a clean checkout.
4. The lesson has been independently rehearsed using learner materials.
5. Video, narration, captions and transcript agree.
6. Quiz and assignment assess the stated outcome.
7. All 13 UCF criteria are 10/10 with evidence.
8. No unresolved blocker remains.

The course is not recording-ready or complete while any mandatory lesson remains below the gate. Do not display or describe the course as finished until all mandatory UCF and course rules pass.

## 14. Approval and account safety

No agent or collaborator may, without explicit user approval:
- Sign in, connect an account, authorize OAuth or grant application/MCP permissions.
- Purchase a subscription or paid service.
- Spend credits or incur usage charges.
- Publish, upload publicly or distribute course videos.
- Merge to the main branch or alter production infrastructure.
- Perform destructive or production data operations.

Do not ask the user to paste passwords, API keys or database credentials into chat. Use approved secret-management mechanisms.

## 15. Status vocabulary

Use these statuses consistently:
- **DRAFT:** content exists but has not passed technical and instructional review.
- **BLOCKED:** a dependency, evidence gap, safety issue or failed criterion prevents progress.
- **IN REVIEW:** all required assets exist and independent review is underway.
- **PASS:** all required gates have passed with retained evidence.
- **PUBLISHED:** publication was explicitly approved and completed.

Never use “complete”, “verified”, “10/10”, “recording-ready” or “published” as an aspirational label. These are evidence-based states.
