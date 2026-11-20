# Reference architecture notes — Lesson 1.3

The orchestrator owns workflow state and routes typed artefacts. It does not decide whether the booking policy is correct. The Requirement Analyst extracts rules and ambiguity; the Impact Analyst proposes affected operations; the Test Planner proposes scenarios. Each agent receives only the context and tools needed for its task.

A deterministic schema validator rejects malformed hand-offs. A human reviews unresolved business questions and risky collection changes. The Postman runner executes only approved collections in an isolated test environment. A deterministic policy evaluator consumes the raw report and policy version. The evidence store retains immutable references to each stage.

The sample plan is a proposal, not a test execution result. Its expected response remains pending contract confirmation.
