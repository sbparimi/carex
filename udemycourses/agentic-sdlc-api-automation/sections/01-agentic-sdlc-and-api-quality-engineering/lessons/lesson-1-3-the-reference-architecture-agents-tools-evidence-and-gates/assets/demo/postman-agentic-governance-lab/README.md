# Postman-first lab — validate agent proposals with deterministic checks

## Learner outcome
Use a Postman collection to inspect an AI-agent test-plan proposal, verify traceability and allowed actions, and demonstrate that unsafe actions and agent-issued release approvals are rejected.

## Why this is the core lab
The course teaches Agentic SDLC for API automation through Postman. This lab keeps the learner in Postman: collection requests, pre-request scripts, test scripts, variables, collection runs and execution evidence. It does not introduce a separate Python testing framework.

## Requirements
- Postman desktop or web app
- CareX running locally using the course environment setup
- A disposable development tenant/database only; use the existing course safety instructions
- No API write permissions are required for this lab

## Import and run
1. Import `CareX-Agentic-SDLC-Governance.postman_collection.json`.
2. Select the course CareX Dev environment and verify `baseUrl` and `tenant`.
3. Confirm the environment points to a disposable development database. Do not use production.
4. Run the collection.
5. Inspect each request's Test Results and the Postman Console.

## Expected result
- Request 01: three policy assertions pass for an evidence-backed proposal.
- Request 02: three policy assertions pass by confirming that mutating/unknown actions and agent release approval are rejected.
- Both HTTP requests are read-only GET health checks. The lab does not update a collection, write a database, send email, deploy or release anything.

## Instructor demonstration — seven-part lesson flow
1. **Opening:** Show a proposed agent test plan and ask what could go wrong if the agent can directly mutate a collection.
2. **Concept:** Explain proposal versus execution, evidence references, allow-listed actions and human approval.
3. **Why:** Connect these controls to change traceability and release safety.
4. **Demo:** Run the safe proposal, then the unsafe proposal. Ask learners to predict the result before each run.
5. **Build:** Have learners add a proposed action `delete_patient` to the unsafe fixture and add an assertion that it remains blocked.
6. **Verify:** Run the collection and inspect assertion results, response status and console output. Explain why a passing policy assertion is not evidence that a business API behaviour is correct.
7. **Recap:** Distinguish agent proposal, deterministic validation, Postman execution and human release approval.

## Independent learner task
Add a third proposal containing:
- a valid change ID and source revision;
- one evidence-backed `read_contract` action;
- one action not on the allow-list;
- `recommend_review` as the release decision.

Write Postman tests that accept the valid read action, reject the unknown action and prevent agent release approval. Capture the collection run result.

## Important limitation
The policy is intentionally implemented in Postman test scripts for teaching. It is not a production authorization service. A passing test demonstrates the rules encoded in this collection only; it does not secure Postman, GitHub, CareX or production systems. Production permissions must be enforced by the relevant platform and server-side controls.

## Instructor-only legacy material
The adjacent `technical-lab` Python policy-gate example is not a required learner activity and must not be used as the course's primary API automation demonstration. It is retained as an optional instructor reference for discussing deterministic policy logic.
