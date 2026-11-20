# Quick reference — agentic API quality engineering

## Responsibility boundaries

| Responsibility | Preferred mechanism | Control |
|---|---|---|
| Interpret story language and identify ambiguity | Agent | Preserve source references; raise open questions |
| Propose impacted APIs and candidate tests | Agent | Validate against OpenAPI and repository evidence |
| Validate structured agent output | Deterministic schema validator | Reject invalid or incomplete payloads |
| Execute API requests and assertions | Postman runner / CI | Retain raw run evidence |
| Enforce mandatory release criteria | Deterministic policy | Cannot be overridden by model prose |
| Accept a material risk exception | Authorised human | Record identity, reason, scope and approval |

## API test design

For each changed operation consider:
- positive business path;
- negative and validation path;
- boundary values;
- authentication and authorisation;
- tenant isolation;
- contract and response schema;
- side effects and idempotency;
- regression impact on connected journeys.

## Evidence chain

Business change → requirement record → OpenAPI operation → impacted journey → test case → collection request → execution report → failure analysis → release policy result.

## Non-negotiable rules

- An agent recommendation is not a test result.
- A summary is not raw evidence.
- A mandatory failed gate is not overridden by a model.
- No production write without explicit authorised approval.
- No credentials in prompts, repository assets or screenshots.
