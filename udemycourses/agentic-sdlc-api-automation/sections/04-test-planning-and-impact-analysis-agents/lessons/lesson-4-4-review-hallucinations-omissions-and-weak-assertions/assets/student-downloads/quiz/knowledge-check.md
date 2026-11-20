# Knowledge check — Lesson 4.4: Review hallucinations, omissions and weak assertions

Choose the single best answer.

1. **An AI-generated test asserts only status 200 for a booking response. What is missing?**
   - A. Nothing; status is enough
   - B. Business outcome, schema/field checks and relevant invariants supported by contract
   - C. A longer test name
   - D. A second GET request

2. **A proposed assertion checks a response field absent from OpenAPI and implementation. What should happen?**
   - A. Keep it because AI suggested it
   - B. Mark it unsupported and remove or clarify it
   - C. Assume it will exist
   - D. Change the API to match the test

3. **Which review method is strongest?**
   - A. Count generated tests
   - B. Compare each scenario/assertion against source rules, OpenAPI and risk coverage
   - C. Trust Agent Mode summary
   - D. Run only happy path

## Answer key and explanations
1. **B.** HTTP success alone does not prove the business outcome.

2. **B.** Assertions must be grounded in authoritative contract/implementation evidence.

3. **B.** Evidence-based review detects hallucination, omissions and weak checks.
