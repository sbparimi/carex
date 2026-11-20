# Postman-first lab — Agent Mode proposal and deterministic verification

## Learner outcome
Use Postman Agent Mode to analyse a CareX business change and produce a structured API test proposal. Transfer that output into a Postman collection variable, then run deterministic Postman assertions for traceability, action permissions and release authority.

## Requirements
- Postman app with Agent Mode enabled and AI terms accepted
- CareX course workspace and API contract/collection available as Agent Mode context
- Non-production CareX environment for read-only health checks

Agent Mode availability and account/plan requirements can change. Check current Postman documentation and account access before recording. A static fixture must never be represented as a live AI response.

## Instructor fixtures
1. Import `CareX-Agentic-SDLC-Governance.postman_collection.json`.
2. Select the CareX Dev environment and verify `baseUrl` and `tenant`.
3. Confirm the URL is non-production.
4. Run requests 01 and 02. Both issue only GET health requests; the unsafe proposal is test data, never an executed action.

## Actual AI-assisted workflow
1. Open Postman Agent Mode in the CareX workspace.
2. Submit the prompt in `agent-proposal-prompt.md` with the CareX API contract/collection available as context.
3. Ask for JSON only. Review the result; do not approve write actions.
4. Copy the JSON into the collection variable `agentProposal` (no Markdown fences).
5. Run request 03 and inspect all assertions.
6. Diagnose any failed assertion; do not weaken policy merely to obtain a green result.

## Expected results
- Request 01: safe fixture passes traceability, allow-list/evidence and release-authority checks.
- Request 02: unsafe fixture is identified as containing forbidden actions and an invalid release decision.
- Request 03: actual Agent Mode output passes only when it has change/source traceability, permitted evidence-backed actions and a non-approval release recommendation.
- No proposed action is executed. All HTTP calls are read-only health checks.

## Seven-part lesson sequence
Opening: introduce the CareX change and autonomy risk.  
Concept: distinguish AI reasoning, deterministic validation and human authority.  
Why: explain traceability and release safety.  
Demo: generate a proposal with Agent Mode and run safe/unsafe fixtures.  
Build: adapt the prompt and generate a learner proposal.  
Verify: validate the actual JSON output with Postman.  
Recap: separate proposal, API execution and release approval.

## Independent task
Ask Agent Mode to add a test scenario for cancellation exactly 24 hours before appointment start. Require an evidence reference. Verify that the proposal classifies the case as rejected based on the business rule. Do not infer an HTTP status or response schema.

## Limitations
The collection checks a narrow proposal contract. It does not prove semantic completeness, execute generated test scenarios, secure Postman or enforce server-side permissions. A passing assertion is not release approval.
