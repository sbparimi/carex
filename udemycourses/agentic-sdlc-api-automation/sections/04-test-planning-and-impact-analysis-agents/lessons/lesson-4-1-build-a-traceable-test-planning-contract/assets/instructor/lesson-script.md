# Instructor script — Lesson 4.1 (20 minutes)

## Outcome
Learners can define a traceable test-plan contract and distinguish requirement evidence, collection evidence, OpenAPI evidence and runtime evidence.

## 1. Opening — 2 min
Narration: “A test plan is not a list of endpoints. It is a chain of evidence from a business rule to a scenario, an API operation, an expected outcome and a reproducible execution. Today we will stop an AI-generated plan from crossing the boundary between what is proposed and what is implemented.”

Show the CAREX-CHANGE-030-CANCEL-24H fixture. Ask learners to predict what evidence would be needed before writing a Postman assertion for a rejected cancellation.

## 2. Concept — 3 min
Explain four evidence classes: requirement fixture (desired behaviour), collection (request/navigation shape), OpenAPI (documented operation and schema), and runtime (observed behaviour of one pinned build and environment). Show the evidence register and explain why each source has a different authority.

## 3. Why — 2 min
Explain the risk of an invented status code or response property: the test may pass against a fabricated expectation while the business rule remains unimplemented.

## 4. Demo — 5 min
In Postman Agent Mode, attach the collection, fixture, schema and pinned OpenAPI document. Paste the lesson prompt. Ask learners to predict which evidence gaps the agent should report before running the prompt. Highlight source revision, contract revision, scenario IDs, evidence references, null HTTP expectations and the 120-minute conflict.

Do not claim a live Agent Mode run has been captured until the instructor records the actual Postman session.

## 5. Build — 4 min
Learners use Agent Mode to create a proposal-only test plan. They compare it with the JSON schema and evidence register. They do not let the agent send requests or mutate the collection.

## 6. Verify — 3 min
Introduce a deliberately weak output that asserts 403 and error.code = CANCEL_WINDOW_CLOSED without contract evidence. Learners mark both as unsupported and keep the plan blocked.

## 7. Recap — 1 min
Narration: “The plan is useful because it shows what we know, what we do not know and what evidence would change the decision. Section 5 will turn only approved scenarios into Postman collection changes.”

## Reset and safety
Use the synthetic fixture. Import a pinned OpenAPI file from a disposable CareX environment. Do not use production credentials or run cancellation requests against shared preview data.
