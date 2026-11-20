# Postman Agent Mode prompt — Lesson 4.1

Attach the CareX training collection, the synthetic change fixture, the test-plan schema and the pinned CareX OpenAPI specification to this Agent Mode conversation.

Act as an API test-planning assistant. Analyse the attached CareX collection, OpenAPI specification, implementation evidence and change fixture CAREX-CHANGE-030-CANCEL-24H. Produce a structured test-plan proposal using the attached schema.

Rules:
- Treat the 24-hour cancellation denial policy as a proposed change, not current behaviour.
- The checked-in source has a 120-minute online change gate. Separately, a 24-hour late_cancel flag classifies late cancellation and does not itself reject cancellation. Do not conflate them.
- Report the source revision and OpenAPI revision you actually inspected. If either is unavailable, stop and list it as missing.
- Use only operations, parameters, request bodies, response codes and schemas present in the attached OpenAPI document.
- Use the collection's cancellation request only as a navigation clue. Do not infer response contracts from its name or URL.
- Include positive, negative, exact-boundary, just-over, just-under, ownership, role and state scenarios where supported.
- Do not invent endpoints, fields, status codes, response properties, database state or policy exceptions.
- Preserve unresolved questions. Mark HTTP expectations null when the contract does not establish them.
- Do not send requests, mutate collections, create tests or change environments. This is a proposal-only task.

Return: (1) JSON proposal, (2) evidence-to-claim table, (3) open questions, (4) assumptions rejected, and (5) execution blockers.
