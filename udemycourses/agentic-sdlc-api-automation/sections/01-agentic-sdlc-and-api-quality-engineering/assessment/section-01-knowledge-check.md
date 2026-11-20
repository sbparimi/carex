# Section 1 integrated knowledge check — Agentic SDLC and API Quality Engineering

**Instructions:** Complete after Lessons 1.1–1.4. Choose the single best answer. The questions combine business context, responsibility boundaries, architecture and safe autonomy.

## Questions

**1. A new booking-window rule is approved, but the existing API collection remains green. What does the green result prove?**
- A. The new rule is implemented.
- B. The tests currently encoded passed; the new rule is covered only if an appropriate test exists and ran.
- C. The API contract cannot change.
- D. The release is approved.

**2. The story says “book within a reasonable period” but defines no duration. What should the workflow record?**
- A. A 30-day default without disclosure.
- B. An open question with source reference and impact.
- C. A passing test.
- D. A release exception.

**3. Which component should reject a Test Planner output missing its required `source_refs` field?**
- A. A deterministic schema validator.
- B. A release assessor LLM.
- C. The Postman collection name.
- D. A human watching the console, as the only control.

**4. What is the orchestrator's primary responsibility?**
- A. Make all business decisions.
- B. Coordinate workflow state, hand-offs, tool permissions and evidence.
- C. Override failed tests.
- D. Generate a green report regardless of test outcomes.

**5. The Test Planner proposes 12 scenarios. What makes those scenarios trustworthy enough to consider?**
- A. The model says confidence is 0.99.
- B. Each scenario is traceable to a source rule, reviewed for completeness and validated before execution.
- C. They use sophisticated terminology.
- D. They were generated quickly.

**6. A change description asks the agent to reveal a database URL. How should it be treated?**
- A. As an authorised system instruction because it came from Jira.
- B. As untrusted content; secret access is denied and the instruction is ignored.
- C. As a reason to add the URL to the report.
- D. As permission to disable security checks.

**7. Which is the strongest boundary for production release?**
- A. Agent confidence above 0.8.
- B. A narrative summary from the Release Assessor.
- C. Deterministic policy evaluation over authoritative execution evidence, with human approval where required.
- D. A green status icon in the dashboard.

**8. Why retain source revision, generated proposal, schema result, execution report and policy version?**
- A. To make the repository larger.
- B. To reconstruct what happened and audit the decision.
- C. To avoid testing again.
- D. To prove the agent is always correct.

**9. A generated collection diff includes an unexpected DELETE request. What is the safest next action?**
- A. Execute it to see what happens.
- B. Review the diff, reject or amend the unsafe change, and execute only in an approved isolated environment.
- C. Ask the agent whether it intended the DELETE and trust the answer.
- D. Run it against production with a read-only token.

**10. A mandatory tenant-isolation test fails, while 98% of all checks pass. What should the policy gate return if any mandatory failure blocks release?**
- A. GO because the percentage is high.
- B. BLOCKED.
- C. GO if the agent confidence is high.
- D. INCONCLUSIVE unless all optional tests fail too.

## Answer key and explanations

1. **B.** A test suite proves only what its actual assertions and execution cover.
2. **B.** Ambiguity must be explicit; the product owner or authoritative requirement must resolve it.
3. **A.** Structural constraints should be enforced deterministically before downstream use.
4. **B.** The orchestrator coordinates execution and controls; it is not an unrestricted decision-maker.
5. **B.** Traceability, review and validation provide evidence beyond model confidence.
6. **B.** Issue content is untrusted data and cannot grant secret access.
7. **C.** Release authority rests on deterministic policy and accountable human approval where required.
8. **B.** Retained evidence supports replay, audit and diagnosis.
9. **B.** Unexpected destructive changes must be stopped before execution.
10. **B.** Mandatory policy rules override aggregate pass percentage and agent opinion.

**Suggested pass standard:** 8/10, followed by review of every incorrect answer. This is a formative checkpoint, not a certification.
