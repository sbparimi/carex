# Production Handover — Agentic SDLC for API Automation

**Course branch:** `course/agentic-sdlc-api-automation`  
**Repository:** `https://github.com/sbparimi/carex`  
**Course root:** `udemycourses/agentic-sdlc-api-automation/`  
**Current handover baseline:** commit `672124b1064632fbe04ce0c3f9c93c5953022b3b`  
**Course status:** production in progress; not recording-ready.

## 1. Purpose and authority

This document governs the handover to Codex (course engineering and repository work) and Instinct.com (video-production coordination and, only where supported by connected tools, lesson-video production).

The repository is the source of truth. Read the course root README, course manifest, ALIGNMENT-AUDIT.md, student-resources, section READMEs and all 35 lesson READMEs before modifying or producing anything. Then inspect each lesson's instructor script, slide storyboard, Agent Mode prompt, starter, expected-results, solution, quiz and assignment. Never assume a file exists or that its contents are complete; inspect the actual branch.

Do not redesign the curriculum. Do not substitute a different course objective. If a source conflict, missing evidence or ambiguity is found, record it and stop the affected production task until it is resolved.

## 2. Fixed course identity

**Title:** Agentic SDLC for API Automation  
**Subtitle:** Build Autonomous API Quality Engineering with Postman, Postman CLI and GitHub Actions  
**Planned duration:** approximately 11 hours  
**Audience:** QA automation engineers, SDETs, API test engineers, test architects, QA managers, release engineers, developers and DevOps engineers.  
**Level:** intermediate to advanced.  
**Capstone:** CareX appointment-booking API change, from requirement intake to release assessment.

**Course promise:** learners will use Postman Agent Mode and native Postman AI to assist the API quality lifecycle: interpret a business change, build a traceable test plan, review generated collection changes, execute deterministic API checks, run Postman CLI in GitHub Actions, diagnose failures using evidence, and make a controlled release recommendation.

The course is Postman-first and AI-first. It is not a Python agent-engineering course.

## 3. Immutable technical boundaries

- Postman Agent Mode/native Postman AI is the primary agent experience. Learners use natural-language prompts to generate or update requests and tests, inspect the resulting changes, and verify them.
- Postman collections and their assertions are the primary API automation artefacts.
- Postman CLI is the primary command-line runner for new workflows.
- GitHub Actions is the CI/CD execution environment.
- Git/GitHub provide version control, human review and traceability.
- Newman is legacy compatibility and migration context only. Do not teach it as an equal alternative to Postman CLI.
- Python is not a core learner prerequisite and must not replace Postman in course demos. CareX itself is implemented with FastAPI/Python; learners test this API rather than build a Python automation framework.
- Agents propose and explain. Deterministic tools validate and execute. Humans approve high-impact changes and release decisions.
- AI output never overrides deterministic release gates.
- Do not invent API status codes, response bodies, schemas, business rules, product UI states or Postman features. Verify them against the pinned source or live application.
- The CareX 24-hour cancellation rule in the synthetic change fixture is a proposed change, not existing behaviour. Existing source distinguishes a 120-minute online change restriction from a 24-hour late-cancel classification flag. Staff/system cancellation behaviour differs. Read Section 04 implementation evidence before producing any cancellation explanation or demo.

## 4. Required lesson teaching pattern

Every lesson follows this exact seven-part sequence:

1. Opening — state the learner outcome and the business problem.
2. Concept — explain the minimum concepts needed, progressively.
3. Why — explain business/engineering consequences and why the approach matters.
4. Demo — instructor demonstrates the real workflow, explaining decisions.
5. Build — learner performs a guided task with a meaningful prediction or decision.
6. Verify — compare actual results with expected results; diagnose an intentional failure where relevant.
7. Recap — summarise the transferable method and hand off to the next lesson.

Do not collapse these into a generic lecture. Use the exact seven headings in the script and storyboard. Keep the seven-part order even when a section is short; a part may be brief if the lesson outcome does not require a long treatment.

## 5. Mandatory instructional design standard

Each lesson must teach a capability, not merely describe a topic. Learners must be able to understand, reproduce, diagnose and independently verify the skill.

Every lesson must contain evidence for all 13 quality criteria:
1. Outcome-first
2. Meaningful business context
3. Progressive concept explanation
4. Instructor demonstration with reasoning
5. Learner prediction before a result is revealed
6. Intentional failure and troubleshooting
7. Independent learner practice
8. Expected-result interpretation and verification
9. Completed reference solution/checkpoint
10. Continuity with the CareX project and previous/next lesson
11. Natural narration synchronized with the actual visual
12. Appropriate pacing, with time to inspect UI and results
13. Learner resources and clear instructions

Score every criterion separately from 0–10. No averaging. A lesson passes only when every criterion is 10/10 and evidence is linked. Do not award 10/10 for an intention, placeholder, generated script or untested mock-up. Retain a scorecard for every lesson.

## 6. Video production rules for Instinct

- Treat the lesson README, instructor script, storyboard, Agent Mode prompt and learner artefacts as the approved production brief.
- Preserve the lesson outcome, sequence, duration intent, terminology, examples, business rules and assessment alignment.
- Use real Postman application capture for Postman workflows. Use the exact application version and workspace/environment shown in the recording notes. Never fabricate a Postman UI, AI Agent Mode response, CLI output, GitHub Actions result, API response or test report.
- If a live feature, account entitlement, consent, tool connection or environment is unavailable, mark the demo BLOCKED and produce a shot list or placeholder storyboard. Do not simulate a successful run and label it real.
- Screen demonstrations must be readable at 1080p. Use 16:9 landscape for the main Udemy lesson unless a specific storyboard requires another aspect ratio. Keep UI text legible; zoom rather than shrinking.
- Use the visual modes A–D only as defined in the existing lesson storyboard/production notes. Do not invent new meanings for these modes.
- Narration must explain the decision being made, not simply read slide text. Use concise natural speech, appropriate pauses and synchronized cursor/highlight actions.
- Show prompts, generated output, human review, edits, execution and verification as distinct steps. Do not jump from prompt to a claimed successful result.
- Include prediction pauses, intentional failure, troubleshooting and independent learner task where the lesson calls for them.
- Do not add decorative stock footage or cinematic effects that obscure technical learning. Technical screen capture and annotated diagrams take priority.
- Keep learner-facing video, captions, slides, downloadable artefacts and assessment separate from instructor-only production notes.
- Provide editable source project and export. Include a clean transcript, captions (SRT or VTT), slide source and a scene/shot list. Use consistent lesson IDs and filenames.
- Do not publish, upload publicly, spend credits, purchase subscriptions, connect accounts, authorize integrations or sign in without explicit user approval.

## 7. Codex responsibilities

Codex owns course engineering and repository quality:
- Read all current course materials before changes.
- Implement missing technical artefacts, runnable labs, test fixtures, CI workflows and documentation.
- Validate JSON/YAML/CSV and scripts; verify relative links; run tests in a safe disposable environment; retain commands and outputs.
- Keep student-facing assets separate from instructor/production materials.
- Update lesson scorecards and the alignment audit with evidence, not claims.
- Maintain the current course branch. Do not merge to main, publish a release, change repository settings or expose secrets.
- Never seed or mutate production/shared databases. The CareX test suite uses a dedicated empty Neon test branch; do not use shared Vercel Preview where its database variables point at production.
- Never commit credentials, API keys, database URLs, access tokens, real personal data or private learner data.
- Do not claim Postman Agent Mode, Postman CLI, GitHub Actions or capstone execution has passed unless it was actually executed and evidence retained.

## 8. Instinct responsibilities and capability check

Instinct owns video-production coordination and production tasks that its available tools actually support. Before starting:
1. Inspect the connected tools and available capabilities in the user's Instinct workspace.
2. Confirm whether a video-generation/editing/rendering tool is connected and whether it can produce screen-recording-based software tutorials, voiceover, captions and 1080p exports.
3. If no suitable video capability exists, report the limitation and identify the required connection/tool. Do not claim that Instinct itself can render video.
4. Do not connect a new service, sign in, grant OAuth, authorize MCP access or spend credits without explicit user approval.
5. If the connected generator cannot capture a real Postman desktop/browser workflow, use a real screen recording supplied by the user or flag that segment as blocked. Do not substitute fabricated UI.

Instinct must not alter course scope, rewrite approved technical facts, invent missing steps, or publish content. It may propose editorial improvements, but must log them and obtain approval before changing learning outcomes or technical claims.

## 9. Per-lesson production workflow

For each lesson, complete these stages in order:

**A. Source audit**
- Record branch and commit SHA.
- Read lesson README, script, storyboard, prompt, starter, expected result, solution, quiz and assignment.
- Check section context and previous/next lesson dependencies.
- List contradictions, missing files and unresolved evidence.

**B. Pre-production**
- Produce a source-to-script traceability table: each key claim → source file/evidence → scene number.
- Confirm the single measurable learner outcome.
- Confirm the seven-part structure and intended duration.
- Produce a scene/shot list, screen-capture checklist, narration script and asset list.
- Mark each demo step as REAL-VERIFIED, SCRIPTED-NOT-RUN or BLOCKED.

**C. Technical rehearsal**
- Rehearse the actual application steps in the correct environment.
- Capture actual prompt, Agent Mode output, human review, collection changes, execution and expected result.
- Preserve failure evidence and explain the diagnosis.
- Never use production data or secrets.

**D. Video assembly**
- Produce a rough cut first.
- Verify every spoken technical claim against source evidence.
- Verify cursor movement, UI state, captions, terminology and scene transitions.
- Keep slides visually supportive rather than text-heavy.
- Export 1080p 16:9 video plus captions, transcript and editable project.

**E. Independent QA**
- A reviewer who did not assemble the video follows it using the learner starter pack.
- Confirm that the learner can reproduce the task, trigger/recognise the intended failure, and verify the expected result.
- Check quiz and assignment alignment.
- Record all 13 quality scores and evidence links.
- Mark PASS only when every criterion is 10/10.

**F. Handover**
- Store source, export, transcript, captions, storyboard, QA checklist and scorecard under the corresponding lesson's production folder.
- Update the production tracker and audit.
- Keep unapproved or blocked output clearly marked as DRAFT / BLOCKED.
- Do not publish.

## 10. Required per-lesson deliverables

Each lesson production package must contain:
- Approved instructor narration script
- Seven-part storyboard with scene IDs and timecodes
- Source-to-script traceability matrix
- Screen-capture/visual asset list
- Real demo evidence or explicit blocked status
- Rough cut and final 1080p export
- Editable project/source
- SRT or VTT captions
- Plain-text transcript
- Learner slide deck or visual handout where applicable
- Learner starter, expected results and reference solution links
- Quiz and practical assignment links
- 13-point scorecard with evidence
- Independent reviewer sign-off
- Version/commit and production date

## 11. Release gates

A lesson cannot be labelled READY or PUBLISHED until:
- Technical claims are evidence-backed.
- Real demonstrations have been executed and retained.
- All learner files and links work from a clean checkout.
- Video, captions and transcript match.
- Independent learner rehearsal passes.
- Every one of the 13 quality criteria scores 10/10 with evidence.
- No unresolved BLOCKED items remain.

A course cannot be labelled recording-ready or complete while any lesson fails a gate. Do not average lesson scores across the course.

## 12. First tasks for both agents

**Codex first:** perform a fresh branch audit; report the current head SHA, inventory the 35 lesson packs, identify missing/incomplete artefacts and broken relative links, then work through technical blockers without changing the course objective. Update the production tracker and audit.

**Instinct first:** inspect its actual video and connected-tool capabilities; then read the repository handover and produce a single pilot lesson package plan for Lesson 1.1. Do not render all 35 lessons in one batch. The pilot must be reviewed against the 13-point gate before scaling the production workflow.

## 13. Non-negotiable prohibitions

- No curriculum redesign without approval.
- No replacing Postman Agent Mode with Python, custom agents or another API test platform.
- No fabricated UI, AI output, logs, API responses, test results, metrics, customer stories or testimonials.
- No unsupported claims about current CareX behaviour.
- No credentials or real personal data in prompts, recordings, commits or learner files.
- No production database writes.
- No account connection, sign-in, OAuth consent, paid plan, credit spend, upload or publication without explicit approval.
- No merge to main.
- No “complete”, “10/10”, “verified”, “recording-ready” or “published” status without evidence.

**The goal is not to produce 35 attractive videos. The goal is to produce 35 accurate lessons that enable independent learner performance.**
