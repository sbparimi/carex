# Instructor script — Lesson 4.3 (20 minutes)

## Outcome
Learners can rank CareX regression journeys using explicit business and change-risk dimensions and defend the chosen scope.

## 1. Opening — 2 min
Show eight regression candidates. Ask learners which three they would run first if time were constrained. Capture their predictions before showing the model.

## 2. Concept — 4 min
Explain impact, change proximity, blast radius and likelihood. Introduce the exercise's weighted model. State clearly that the weights are a teaching heuristic, not a validated production risk model. Likelihood is a judgement and must carry a rationale.

## 3. Why — 2 min
Running everything in arbitrary order hides the highest-risk behaviour when the release window is short. Ranking by convenience or endpoint count is not risk-based testing.

## 4. Demo — 5 min
Ask Postman Agent Mode to rank the candidate CSV. Inspect the score calculation and evidence. Intentionally challenge a ranking that puts public discovery above patient cancellation because it has more requests.

## 5. Build — 3 min
Learners create their own ranked list and select full, focused or smoke coverage for each journey. They document exclusions.

## 6. Verify — 3 min
Compare with the reference solution. Accept alternate rankings only when supported by evidence and transparent rationale. Check arithmetic and confirm the highest direct-change risks are not omitted.

## 7. Recap — 1 min
The ranked regression plan and scenario matrix become the implementation backlog for Section 5.

## Teaching note
Never describe the sample weighted scores as measured CareX risk or production telemetry. They are illustrative scoring outputs based on explicit classroom assumptions.
