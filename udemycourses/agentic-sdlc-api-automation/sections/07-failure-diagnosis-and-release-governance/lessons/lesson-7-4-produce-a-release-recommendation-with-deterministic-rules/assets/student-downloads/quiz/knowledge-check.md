# Knowledge check — Lesson 7.4: Produce a release recommendation with deterministic rules

Choose the single best answer.

1. **All mandatory tests pass but the required business-rule evidence is missing. What is the release state?**
   - A. Approved
   - B. Blocked or pending evidence according to policy
   - C. Approved by Agent Mode
   - D. Ignore the missing evidence

2. **What should the AI failure analyst contribute to a release assessment?**
   - A. Final release approval
   - B. Evidence-linked analysis and limitations
   - C. Permission to bypass CI
   - D. Secret values

3. **Which release recommendation is defensible?**
   - A. Ship because the model sounds confident
   - B. A recommendation referencing required gates, run evidence, unresolved risks and human decision owner
   - C. Ship because only one test failed
   - D. Approve based on HTTP 200

## Answer key and explanations
1. **B.** Passing tests do not waive missing mandatory evidence.

2. **B.** The agent can summarise evidence but does not hold release authority.

3. **B.** Release assessment must be traceable to explicit evidence and policy.
