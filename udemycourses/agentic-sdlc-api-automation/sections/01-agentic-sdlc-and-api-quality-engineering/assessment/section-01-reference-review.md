# Section 1 reference review checklist

A strong submission should demonstrate the following:

- The 30-day rule is treated as proposed and unresolved details remain visible.
- Boundary tests are proposed only after the inclusive/exclusive and timezone semantics are confirmed; otherwise they are explicitly marked blocked pending clarification.
- An agent may extract requirements, map impact and propose scenarios, but does not approve business policy or production release.
- A deterministic schema validator rejects malformed hand-offs.
- Postman executes only approved tests in an isolated test environment.
- The evidence store retains source revision, requirement proposal, schema validation, reviewer decision, raw run report and policy version.
- Prompt injection is treated as untrusted data; secrets are not available to the agent.
- The policy gate blocks on any failed mandatory test, regardless of aggregate pass percentage or model confidence.

Do not treat this checklist as a completed technical solution. The learner must provide their own artefacts and explain the decisions.
