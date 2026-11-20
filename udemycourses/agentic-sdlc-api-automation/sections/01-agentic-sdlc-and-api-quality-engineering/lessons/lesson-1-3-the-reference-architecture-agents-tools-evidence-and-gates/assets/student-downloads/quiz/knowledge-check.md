# Lesson 1.3 knowledge check — Postman Agentic SDLC architecture

**Outcome tested:** Explain the boundary between Postman Agent Mode, Postman collections, Postman CLI, GitHub Actions and human release authority.

## Questions

**1. Which sequence best represents the course's controlled change-to-release workflow?**
- A. Agent Mode approves release → tests run only if requested → report is generated.
- B. Business change → Agent Mode analysis/proposal → human review → Postman collection tests → Postman CLI/GitHub Actions execution → deterministic release gate.
- C. Agent Mode generates tests and marks them passed without execution.
- D. GitHub Actions reads a Jira story and approves production.

**2. What is the primary role of Postman Agent Mode in this course?**
- A. Replace API assertions and release policy.
- B. Assist with API lifecycle tasks such as exploring APIs, creating/updating requests and tests, and debugging, with human review.
- C. Approve every generated collection change.
- D. Replace the CareX API.

**3. Which component should verify actual API behaviour?**
- A. Agent Mode's natural-language summary.
- B. Postman requests and deterministic test assertions executed against the API.
- C. A slide diagram.
- D. A confidence score.

**4. What is the role of Postman CLI and GitHub Actions?**
- A. CLI authors business requirements; Actions approves release.
- B. CLI executes reviewed Postman collections; GitHub Actions automates that execution and retains CI evidence.
- C. They replace the Postman collection.
- D. They grant Agent Mode unrestricted access.

**5. A test report says a mandatory test failed, but Agent Mode says “all critical journeys look healthy.” Which should the release gate consume?**
- A. Only the summary.
- B. The raw test result and deterministic policy evaluation; the summary is supporting context.
- C. Whichever result is newer in chat.
- D. The model's confidence score.

## Answers and explanations
1. **B.** Analysis, review, execution and release authority remain distinct.
2. **B.** Agent Mode assists across the API lifecycle but does not replace deterministic verification or human authority.
3. **B.** The API and its tests provide execution evidence; an AI summary does not prove behaviour.
4. **B.** Postman CLI runs collections; GitHub Actions coordinates repeatable CI execution.
5. **B.** Mandatory gates consume authoritative execution evidence and versioned policy.

**Reflection:** Identify which step is AI-assisted, which step is deterministic, and which decision remains human-owned.
