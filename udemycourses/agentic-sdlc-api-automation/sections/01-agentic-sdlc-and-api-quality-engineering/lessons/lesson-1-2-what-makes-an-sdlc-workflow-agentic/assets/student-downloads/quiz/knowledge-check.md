# Lesson 1.2 knowledge check — agent, deterministic tool or human?

**Outcome tested:** Allocate workflow responsibilities without allowing an AI agent to become an unchecked authority.

## Questions

**1. The requirement says “bookings should be made at a convenient time,” with no definition of convenient. What should the requirement-analysis agent do?**
- A. Choose a time range based on common practice.
- B. Record the ambiguity, cite the source and raise an open question.
- C. Mark the requirement as complete.
- D. Ask the test runner to infer the business rule.

**2. The generated requirement object must conform to a JSON Schema. Who should decide whether it is structurally valid?**
- A. The LLM that generated it.
- B. A deterministic schema validator.
- C. The product owner by visual inspection only.
- D. The Postman collection name.

**3. A mandatory tenant-isolation test fails, but the agent recommends GO because 98% of tests passed. What is the correct action?**
- A. Average the results and release.
- B. Let the agent override the failed test.
- C. Apply the versioned release policy; the mandatory failure blocks release.
- D. Delete the failed result and rerun until green.

**4. Which activity requires accountable human authority?**
- A. Parsing a JSON response.
- B. Executing a Postman collection.
- C. Approving a documented production risk exception.
- D. Checking a required response header.

## Answers and explanations
1. **B.** Agents should expose ambiguity rather than silently invent requirements.
2. **B.** Structural validity is objectively testable and should be enforced deterministically.
3. **C.** Mandatory policy gates cannot be overridden by a probabilistic recommendation.
4. **C.** Risk acceptance requires an authorised accountable person and an audit trail.

**Reflection:** Name one action that your agent may propose but must not execute without approval.
