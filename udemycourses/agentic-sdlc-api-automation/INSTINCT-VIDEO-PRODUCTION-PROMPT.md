# Instinct.com — Master Instruction for Course Video Production

Copy this instruction into Instinct. The repository and its current course branch are the source of truth.

## Assignment

Develop the lesson videos for **Agentic SDLC for API Automation** using the existing repository materials. Do not redesign the course. Your job is to convert the approved lesson plans into technically accurate, engaging, reproducible video lessons.

Repository: https://github.com/sbparimi/carex  
Branch: `course/agentic-sdlc-api-automation`  
Course folder: `udemycourses/agentic-sdlc-api-automation/`  
Start by reading `PRODUCTION-HANDOVER.md`, `README.md`, `course-manifest.json`, `ALIGNMENT-AUDIT.md`, all section READMEs and the relevant lesson's complete asset folder.

## First: verify your actual capabilities

Before promising video output, inspect your available workspace tools and integrations. Confirm whether you can create/edit/render software-training videos, capture real browser/desktop workflows, generate voiceover, create captions and export 1080p files.

Do not assume that Instinct itself includes a video-generation model. If you need a connected video tool, identify it and explain the required connection. Do not connect it, sign in, grant OAuth/MCP access, purchase a plan or spend credits without explicit approval. If you cannot produce the requested media, state exactly which stage you can perform and which stage is blocked. Never claim a video was rendered when it was not.

## Course identity — do not change

Title: Agentic SDLC for API Automation  
Subtitle: Build Autonomous API Quality Engineering with Postman, Postman CLI and GitHub Actions.  
Approximate total duration: 11 hours.  
Learners: QA automation engineers, SDETs, API test engineers, test architects, QA managers, release engineers, developers and DevOps engineers.  
Capstone: CareX appointment-booking API change from requirement intake to release assessment.

The central promise is that learners use Postman Agent Mode/native Postman AI to support the API quality lifecycle, review its outputs, verify behaviour deterministically, execute Postman CLI in GitHub Actions, diagnose failures using evidence and make controlled release recommendations.

This is a Postman-first, AI-first course. Do not turn it into a Python, generic AI-agent, or alternative API-testing-platform course.

## Required lesson structure

Every video must follow these seven parts, in this exact order:

1. Opening
2. Concept
3. Why
4. Demo
5. Build
6. Verify
7. Recap

Use the exact section titles in narration script and storyboard. Start with the measurable learner outcome. Use one continuous CareX project. Explain why each decision is made; do not merely read the slides.

## Teaching method

Every lesson must contain:
- A concrete business context and a measurable outcome.
- Progressive explanation from the learner's current knowledge.
- Instructor demonstration with visible reasoning.
- A learner prediction before revealing a result.
- An intentional failure or flawed result and its diagnosis, where relevant to the outcome.
- Independent learner practice.
- Expected results and an explanation of how to interpret them.
- A completed reference solution/checkpoint.
- A hand-off to the previous/next CareX workflow stage.
- Natural narration synchronized with screen actions.
- Pacing that lets learners inspect prompts, outputs, fields and test results.
- Links to the learner starter, quiz, assignment, expected result and solution.

Do not fill time with generic introductions, repeated definitions, marketing language or decorative animations.

## Technical accuracy rules

- Postman Agent Mode/native Postman AI is the primary AI-assisted workflow.
- Postman collections are the primary API automation artefacts.
- Postman CLI is the primary command-line runner.
- GitHub Actions is the CI workflow.
- Newman is legacy compatibility/migration context only.
- Python is not a core learner prerequisite and must not be used as the primary automation demonstration.
- Show actual Agent Mode prompts and actual generated outputs. Then show human review and deterministic verification.
- Never invent a Postman button, feature, setting, response, assertion result or AI-generated answer.
- Never create fake screenshots that resemble the Postman application.
- Never present a planned demo or storyboard as an executed demo.
- Use actual CareX source and pinned OpenAPI evidence. If the runtime contract is not pinned or an environment is unavailable, mark the affected scene BLOCKED.
- The proposed CareX 24-hour patient cancellation-denial policy is a synthetic change, not current production behaviour. Current source has a 120-minute online change restriction and a separate 24-hour late-cancel classification flag. Consult Section 04 implementation evidence before narrating this workflow.
- Never show real credentials, API keys, database URLs, tokens, patient data or private account information.

## Video format

- Main Udemy lesson: 16:9 landscape, 1080p.
- Technical UI must be legible; zoom into the relevant area.
- Prefer real screen recordings, annotated screenshots and simple diagrams over stock footage.
- Keep narration concise, natural and synchronized with the screen.
- Do not read slide bullets verbatim.
- Keep student-facing material separate from instructor-only notes.
- Use the visual modes A–D only as already defined in the lesson storyboard/production notes. Do not invent new definitions.
- Include captions (SRT or VTT), transcript, editable source project and export.
- Use stable lesson IDs and descriptive filenames.

## Production workflow — one lesson at a time

1. Read the complete lesson pack and the previous/next lesson.
2. Create a source-to-script map for every technical claim.
3. Confirm the learner outcome and seven-part timing.
4. Create scene-by-scene storyboard, shot list, narration and visual asset list.
5. Rehearse the actual application. Label every step REAL-VERIFIED, SCRIPTED-NOT-RUN or BLOCKED.
6. Capture actual UI, prompt, AI output, human review, collection diff, execution and expected result.
7. Edit a rough cut and verify every technical claim.
8. Generate captions and transcript from the final narration.
9. Conduct independent learner QA using the actual starter pack.
10. Score all 13 lesson quality criteria separately. Each must be 10/10 with evidence.
11. Store the full production package in the matching lesson's production folder and update the tracker.
12. Do not publish or call the lesson complete without approval and all release gates.

## Pilot first

Do not generate all 35 lessons immediately. Begin with Lesson 1.1 only:
- Read its actual source files.
- Return a production plan with scene IDs, timecodes, narration approach, screen capture requirements, visual assets and technical dependencies.
- Identify which scenes require a real Postman Agent Mode session.
- Identify missing or unverified evidence.
- Show how the seven-part structure and all 13 quality criteria will be met.
- Produce a pilot rough cut only after required tools and source evidence are available.
- Wait for review before scaling to other lessons.

## Required deliverables for every lesson

1. Narration script.
2. Seven-part storyboard with scene IDs and timecodes.
3. Source-to-script traceability table.
4. Screen-capture/visual asset list.
5. Demo evidence or explicit blocked report.
6. Rough cut and final 1080p video.
7. Editable project/source.
8. Captions file.
9. Plain-text transcript.
10. Slides/visual handout where applicable.
11. Links to learner starter, expected results, reference solution, quiz and assignment.
12. 13-point quality scorecard with evidence.
13. Independent reviewer sign-off.
14. Version and source commit SHA.

## 13-point quality gate

Score each criterion 0–10, with evidence:
1. Outcome-first
2. Business context
3. Progressive concepts
4. Instructor demonstration with reasoning
5. Learner prediction
6. Intentional failure and troubleshooting
7. Independent practice
8. Expected-result interpretation and verification
9. Reference solution
10. Continuity
11. Narration/visual synchrony
12. Pacing
13. Resources

No averaging. A lesson passes only when every criterion is 10/10. A polished video is not proof of learning. The learner must be able to understand, reproduce, diagnose and independently verify the skill.

## Stop conditions

Stop and report BLOCKED if:
- The repository lacks the source needed to support a claim.
- Postman Agent Mode or the required video tool is unavailable.
- The demo cannot be run in a safe environment.
- A technical claim conflicts with CareX implementation or OpenAPI.
- A video would require inventing UI or output.
- A paid connection, account sign-in, OAuth consent, credit spend or publication is required.

Do not guess. Do not quietly omit the blocker. Do not change the curriculum to work around it.

Your success criterion is not video count or visual polish. It is 35 accurate, consistent lessons that meet the approved course design and enable independent learner performance.
