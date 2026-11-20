# Knowledge check — Lesson 5.3: Assertions that verify business outcomes

Choose the single best answer.

1. **A request returns HTTP 200 but the appointment belongs to a different patient. What should the test conclude?**
   - A. Pass because status is 200
   - B. Fail because the business ownership invariant is violated
   - C. Skip the test
   - D. Change the expected patient

2. **Where should an expected response field be sourced from?**
   - A. A model guess
   - B. OpenAPI contract or verified implementation
   - C. A random example online
   - D. A response from another tenant

3. **For a strict >24-hour cancellation rule, which test set is strongest?**
   - A. Only 48 hours
   - B. Just over 24h, exactly 24h and just under 24h
   - C. Only a past appointment
   - D. Only a successful cancellation

## Answer key and explanations
1. **B.** Business assertions must verify the actual invariant, not just transport success.

2. **B.** Assertions must be grounded in the authoritative API contract.

3. **B.** Boundary tests distinguish strict greater-than from inclusive comparisons.
