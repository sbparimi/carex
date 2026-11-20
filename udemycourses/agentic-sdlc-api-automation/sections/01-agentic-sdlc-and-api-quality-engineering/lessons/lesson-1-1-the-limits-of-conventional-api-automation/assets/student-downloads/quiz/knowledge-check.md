# Lesson 1.1 knowledge check — conventional API automation

**Outcome tested:** Explain where conventional API automation provides reliable control and where it fails to interpret business change without additional engineering.

## Questions

**1. A clinic changes its rule from “patients may book any available slot” to “patients may book only slots within the next 30 days.” The existing Postman collection still passes. What is the most important conclusion?**
- A. The change is safe because the collection is green.
- B. The collection may not cover the new business rule; passing tests only proves the assertions currently encoded.
- C. Postman should infer the new rule from the Jira title.
- D. The API no longer needs regression testing.

**2. Which task is best suited to a deterministic API test?**
- A. Decide whether a vague product request expresses a fair booking policy.
- B. Infer an unstated business intention from a stakeholder conversation.
- C. Assert that a request for a slot 45 days ahead is rejected with the documented response.
- D. Decide whether the product owner should accept a business risk.

**3. A team has 500 API tests but cannot show which acceptance criteria they protect. What is the primary weakness?**
- A. Too many tests always reduce quality.
- B. Lack of traceability between business rules, API behaviour and test evidence.
- C. The team should replace all tests with an LLM.
- D. The team should run tests less often.

**4. What is the strongest reason to introduce agentic assistance rather than replace the test runner?**
- A. Agents can make all release decisions.
- B. Agents can help interpret change, map impact and propose coverage while deterministic tests continue to execute and verify behaviour.
- C. Agents remove the need for API contracts.
- D. Agents guarantee complete test coverage.

## Answers and explanations
1. **B.** A green suite says nothing about an unencoded rule. Test coverage must be updated against the changed requirement.
2. **C.** This is an objective, repeatable assertion against a documented rule.
3. **B.** Test volume without traceability makes risk coverage difficult to assess.
4. **B.** Agentic reasoning can assist analysis and planning; deterministic execution remains essential.

**Reflection:** Identify one test in a real API project that could pass while an important business rule is still broken.
