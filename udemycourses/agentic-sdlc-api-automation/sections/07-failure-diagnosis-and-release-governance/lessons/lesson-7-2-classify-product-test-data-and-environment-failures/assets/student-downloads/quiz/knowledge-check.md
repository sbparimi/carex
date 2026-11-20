# Knowledge check — Lesson 7.2: Classify product, test, data and environment failures

Choose the single best answer.

1. **A request returns 503 and the environment health check also fails. What is the most defensible initial classification?**
   - A. Confirmed product defect
   - B. Likely environment/service availability issue pending evidence
   - C. Confirmed test-data defect
   - D. Release approved

2. **An assertion expects a response field not present in the OpenAPI contract. What failure class is most likely?**
   - A. Test-design/contract mismatch
   - B. Environment outage
   - C. Database capacity
   - D. User permission

3. **A booking test fails because its slot ID expired before execution. What class is this?**
   - A. Product defect by default
   - B. Test-data/state setup issue
   - C. Agent hallucination
   - D. Release policy failure

## Answer key and explanations
1. **B.** Correlated health evidence points toward environment/service availability, but diagnosis remains evidence-based.

2. **A.** The test expectation is unsupported by the contract and should be corrected or investigated.

3. **B.** Stale or invalid test data is distinct from product behaviour.
