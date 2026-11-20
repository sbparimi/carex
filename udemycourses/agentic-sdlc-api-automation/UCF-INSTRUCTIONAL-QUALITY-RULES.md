# UCF Instructional Quality Rules

**Applies to:** Every lesson, section, exercise, demonstration and assessment in this course.  
**Authority:** Mandatory instructional-design standard defined for this course. These are project-specific UCF rules, not a claim that Udemy publishes or endorses this exact framework.

## 1. Core learning standard

A lesson is successful only when a learner can:

1. Explain the concept in their own words.
2. Reproduce the demonstrated workflow without copying blindly.
3. Diagnose a meaningful failure or incorrect result.
4. Verify the outcome independently using stated evidence.

A polished video, completed slide deck or instructor demonstration alone does not prove learning.

## 2. Mandatory seven-part lesson structure

Every lesson must follow this sequence. Use these exact headings in lesson scripts and storyboards.

1. **Opening** — State one measurable learner outcome, establish the business problem and explain what the learner will produce.
2. **Concept** — Explain the required concepts progressively, from prerequisite knowledge to the new capability.
3. **Why** — Explain the business, customer, quality, delivery or operational consequence. Make the cost of getting it wrong concrete.
4. **Demo** — Demonstrate the real workflow. Narrate decisions, trade-offs, checks and reasons; do not merely read the screen.
5. **Build** — Give the learner a guided task. Include a prediction or decision before revealing the result.
6. **Verify** — Compare actual and expected results. Include an intentional failure or diagnostic exercise where relevant. Explain how to distinguish a genuine pass from a superficial success.
7. **Recap** — Reinforce the reusable method, state the evidence of completion and connect to the next lesson.

Do not reorder, omit or merge these parts. A part may be concise when the learning outcome does not require extended treatment.

## 3. Thirteen mandatory quality criteria

Score each criterion independently from 0 to 10. A lesson passes only when **all 13 criteria score 10/10** and each score links to observable evidence. Scores must not be averaged.

| # | Criterion | Evidence required for 10/10 |
|---|---|---|
| 1 | Outcome-first | A specific, observable learner outcome appears at the start and is assessed by the end. |
| 2 | Business context | A credible, relevant business problem motivates the skill and remains connected to the task. |
| 3 | Progressive explanation | Concepts build in a logical sequence; prerequisites and terminology are explained before use. |
| 4 | Instructor demonstration | A real end-to-end demonstration shows the steps and explains why decisions are made. |
| 5 | Learner prediction | Learners must predict, choose or reason before the result is disclosed. |
| 6 | Intentional failure | A meaningful failure, weak result or edge case is deliberately introduced and diagnosed. |
| 7 | Independent practice | Learners complete a task without simply following the instructor's exact clicks or copying the solution. |
| 8 | Verification | Expected and actual outcomes are compared using explicit, reproducible evidence. |
| 9 | Reference solution | A complete, tested reference solution and checkpoint are available, with reasoning where useful. |
| 10 | Continuity | The lesson builds on the course project and prior learning and prepares the next lesson. |
| 11 | Narration/visual synchrony | Spoken explanation matches the actual screen, diagram or result at the moment it appears. |
| 12 | Pacing | Learners have enough time to read, reason, perform actions and inspect results; no critical step is rushed. |
| 13 | Learner resources | Required downloads, setup, instructions, expected results, assessment and support references are complete and accessible. |

A score of 10 means the criterion is fully demonstrated, not that the author intended to include it. Placeholders, plans, mock outputs and unexecuted scripts cannot earn full evidence credit.

## 4. Demonstration and explanation rules

- Start from the learner's likely starting state. State required setup and assumptions.
- Show the actual application or environment for software demonstrations.
- Explain the decision being made, the evidence inspected and the reason for the next action.
- Distinguish what the AI proposes from what the learner accepts.
- Do not skip intermediate states that are necessary to reproduce the result.
- Use zoom, callouts and cursor emphasis to make important UI details readable.
- Do not fabricate screens, tool responses, API output, logs, test reports or successful executions.
- If a demonstration cannot be executed, mark it BLOCKED or SCRIPTED-NOT-RUN. Never present it as verified.

## 5. Prediction, failure and diagnosis

- Ask the learner to predict an outcome before revealing it. A pause or explicit decision prompt is acceptable.
- Choose failures that teach a transferable diagnostic skill, not arbitrary errors added for drama.
- Show the symptom, inspect evidence, form a hypothesis, test it, identify the cause and verify the correction.
- Explain false positives and misleading green results where relevant.
- Do not hide the failure or edit the recording to imply that the first attempt succeeded.
- Where an intentional failure is unsafe or destructive, use a disposable fixture or a clearly labelled recorded example.

## 6. Independent practice and assessment

Each practical lesson must provide:
- A clearly identified starter asset or starting state.
- Exact task instructions and constraints.
- A learner decision or prediction.
- A measurable expected outcome.
- A verification method.
- A completed reference solution or checkpoint.
- A knowledge check aligned to the stated outcome.

Assessment must test understanding and application, not recall of incidental UI labels. Distractors must be plausible and technically defensible. Practical tasks must be achievable with the supplied resources and must not require undisclosed paid access.

## 7. Narration, visuals and pacing

- Narration must sound natural and explain the reasoning behind actions.
- Do not read dense slide text word-for-word.
- Keep screen recordings legible at 1080p in 16:9 landscape unless a lesson-specific requirement is documented.
- Keep the relevant UI large enough to read. Prefer focused capture and zoom over tiny full-screen layouts.
- Synchronize narration, cursor movement, highlights, captions and visible application state.
- Pause after prompts, decisions, important outputs and learner tasks.
- Use diagrams to clarify architecture or relationships; do not use decorative motion that competes with the lesson.
- Captions and transcript must match the final audio and technical terminology.

## 8. Continuity and course project

- Use the shared CareX project consistently.
- Reuse established terms, identities, API contracts and business rules.
- Explain any intentional change to the project state or scenario.
- Make dependencies explicit: what the learner should already know and what the next lesson will use.
- Do not silently change an earlier lesson's assumptions or expected result.
- Keep a traceable link from lesson outcome to demo, learner task, assessment and reference solution.

## 9. Evidence and review

Each lesson must retain:
- Script and seven-part storyboard.
- Outcome-to-assessment traceability.
- Demo evidence and environment/version details.
- Starter, expected result and reference solution.
- Quiz and practical assignment.
- Final video, transcript and captions.
- Completed 13-point scorecard with evidence links.
- Independent reviewer sign-off.
- Version/commit identifier.

The reviewer must be able to follow the lesson using only the learner-facing materials. Any missing, inaccessible, contradictory or unverified evidence blocks the lesson.

## 10. Release decision

- **PASS:** all 13 criteria are 10/10 with evidence; technical rehearsal and independent learner rehearsal pass; no blockers remain.
- **BLOCKED:** any criterion is below 10, evidence is missing, or a required capability/environment is unavailable.
- **DRAFT:** work exists but has not completed independent review.

No averaging across criteria or lessons. Do not label a lesson complete, final, recording-ready or published without satisfying the gate. The course is not complete while any mandatory lesson remains BLOCKED or DRAFT.
