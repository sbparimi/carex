# Lesson 1.3 knowledge check — reference architecture

**Outcome tested:** Place agents, tools, evidence stores and policy gates in a safe, auditable workflow.

## Questions

**1. Which sequence best represents a controlled change-to-release workflow?**
- A. Agent decides release → tests run only if requested → report is generated.
- B. Change intake → agent analysis and proposals → schema/policy validation → human review where required → deterministic test execution → evidence-based gate.
- C. LLM generates tests and marks them passed without execution.
- D. Test runner reads a Jira ticket and approves production.

**2. Why should agent outputs be stored as versioned artefacts rather than passed only as conversational text?**
- A. It makes prompts longer.
- B. It enables validation, traceability, replay, review and audit of inputs and decisions.
- C. It guarantees the model is correct.
- D. It removes the need for access control.

**3. What is the correct role of an orchestration layer?**
- A. It should let every agent call every system with administrator rights.
- B. It coordinates state, invokes approved tools, validates hand-offs and records evidence.
- C. It should replace all deterministic components with prompts.
- D. It should hide failures from downstream steps.

**4. A test report says a mandatory test failed, but the agent summary says “all critical journeys look healthy.” Which should the release gate consume?**
- A. Only the summary.
- B. The raw test result and versioned policy evaluation; the summary is supporting context.
- C. Whichever result is newer in chat.
- D. The average sentiment of the agent responses.

## Answers and explanations
1. **B.** The sequence separates analysis, validation, review, execution and release authority.
2. **B.** Structured, versioned artefacts provide an auditable chain. They do not guarantee correctness by themselves.
3. **B.** Orchestration manages workflow and controls; it is not an unrestricted super-agent.
4. **B.** The deterministic gate must use authoritative execution evidence and policy, not a narrative summary.

**Reflection:** Identify the system boundary where you would enforce schema validation and where you would enforce release policy.
