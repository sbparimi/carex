# Quick reference — Postman Agentic SDLC for API quality

## Responsibility boundaries

| Responsibility | Primary mechanism | Control |
|---|---|---|
| Interpret story language and identify ambiguity | Postman Agent Mode | Preserve source references; raise open questions |
| Propose impacted APIs and candidate tests | Postman Agent Mode with CareX OpenAPI context | Validate every operation and scenario against source evidence |
| Generate/update requests and test scripts | Postman Agent Mode / native Postman AI | Review the diff; do not treat generated code as correct by default |
| Verify proposal structure and policy | Postman collection assertions | Reject missing evidence, forbidden actions and agent release approval |
| Execute API requests and assertions | Postman app / Postman CLI | Retain raw run evidence |
| Automate repeatable execution | GitHub Actions | Run only reviewed, version-controlled collections |
| Enforce mandatory release criteria | Deterministic CI policy | Cannot be overridden by model prose |
| Accept a material risk exception | Authorised human | Record identity, reason, scope and approval |

## API test design

For each changed operation consider:
- positive business path;
- negative and validation path;
- exact and adjacent boundary values;
- authentication and authorisation;
- tenant isolation;
- contract and response schema;
- side effects and idempotency;
- regression impact on connected journeys.

## Evidence chain

Business change → Postman Agent Mode analysis → source-linked requirement → impacted OpenAPI operation → test proposal → human-reviewed collection diff → Postman execution → CLI/CI report → failure analysis → deterministic release policy → human decision.

## Non-negotiable rules
- Agent Mode output is a proposal, not a test result.
- A generated script must be reviewed and independently executed.
- A summary is not raw evidence.
- A mandatory failed gate is not overridden by a model.
- No production write without explicit authorised approval.
- No credentials in prompts, repository assets or screenshots.
- Do not hand-write JavaScript as the course's core skill; use Agent Mode/native AI to generate scripts, then inspect and verify them.
