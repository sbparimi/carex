# Knowledge check — Lesson 3.2: Design specialist-agent responsibilities

Choose the single best answer.

1. **What makes a specialist-agent task safely reusable?**
   - A. A named role, bounded objective, trusted inputs, output contract and prohibited actions
   - B. A long prompt with no output format
   - C. Permission to modify all workspaces
   - D. A request to decide release readiness

2. **The test-planning prompt cannot find an operation in the supplied OpenAPI contract. What should it return?**
   - A. Invent a likely endpoint
   - B. Use a different tenant
   - C. Record an open question and cite the missing contract evidence
   - D. Generate a passing assertion anyway

3. **Which task belongs to the failure-diagnosis role?**
   - A. Change the API contract to match the test
   - B. Classify a failure using request, response, assertion and environment evidence
   - C. Approve production release
   - D. Rotate a database password

## Answer key and explanations
1. **A.** Reusable tasks require bounded scope, explicit inputs/outputs and permissions.

2. **C.** The agent must expose missing evidence rather than hallucinate API details.

3. **B.** Diagnosis interprets evidence; it does not mutate systems or approve releases.
