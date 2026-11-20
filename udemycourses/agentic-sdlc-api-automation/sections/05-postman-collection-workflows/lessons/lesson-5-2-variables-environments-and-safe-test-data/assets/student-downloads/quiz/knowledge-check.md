# Knowledge check — Lesson 5.2: Variables, environments and safe test data

Choose the single best answer.

1. **Where should a base URL that changes between dev and test environments belong?**
   - A. Hard-coded in every request
   - B. Environment variable
   - C. A response assertion
   - D. A test description

2. **Which value must not be committed in an exported environment?**
   - A. A non-secret tenant label
   - B. A documented placeholder
   - C. A real access token or password
   - D. A synthetic example ID

3. **A collection is write-enabled but the selected environment points to a shared preview database. What should happen?**
   - A. Run the full collection
   - B. Disable writes and verify an isolated target first
   - C. Use admin credentials
   - D. Assume test data is disposable

## Answer key and explanations
1. **B.** Environment-specific values belong in the selected environment.

2. **C.** Credentials and tokens must remain outside shared exports.

3. **B.** The target database must be verified before writes are enabled.
