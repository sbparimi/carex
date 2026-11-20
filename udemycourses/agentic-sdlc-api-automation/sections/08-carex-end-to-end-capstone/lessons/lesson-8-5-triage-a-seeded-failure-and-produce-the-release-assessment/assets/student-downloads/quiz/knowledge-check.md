# Knowledge check — Lesson 8.5: Triage a seeded failure and produce the release assessment

Choose the single best answer.

1. **Agent Mode classifies the seeded failure as flaky. What proves the classification?**
   - A. Its confidence score
   - B. Correlated run evidence and a documented retry policy
   - C. A green unrelated request
   - D. No evidence is needed

2. **The collection passes but the required exact-boundary test is missing. What is the release state?**
   - A. Approved
   - B. Blocked/pending required evidence
   - C. Approved by Agent Mode
   - D. Unknown but ship

3. **Who owns the final release approval?**
   - A. Postman Agent Mode
   - B. Test Planner agent
   - C. Authorised human under the release policy
   - D. Postman CLI

## Answer key and explanations
1. **B.** The classification must be supported by execution evidence.

2. **B.** Missing mandatory evidence prevents a positive release decision.

3. **C.** Agents and runners provide evidence; release authority remains human.
