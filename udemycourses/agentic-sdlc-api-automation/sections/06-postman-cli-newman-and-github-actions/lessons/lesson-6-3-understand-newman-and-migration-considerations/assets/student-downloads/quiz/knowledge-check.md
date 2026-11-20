# Knowledge check — Lesson 6.3: Newman legacy compatibility and migration to Postman CLI

Choose the single best answer.

1. **Why is Newman not the primary runner for new Postman v12 workflows?**
   - A. It is a database
   - B. Current Postman documentation says Newman cannot run collections created or updated in Postman v12 and later
   - C. It requires GitHub Actions
   - D. It only runs GET requests

2. **What is the correct migration approach?**
   - A. Assume every collection is compatible
   - B. Run a representative collection and compare scripts, auth, reporters and outputs
   - C. Delete all legacy tests
   - D. Migrate without a baseline

3. **Which claim should be avoided without an actual test?**
   - A. Newman is a legacy option
   - B. Postman CLI is primary in this course
   - C. This exact CareX collection runs unchanged in Newman
   - D. Migration requires review

## Answer key and explanations
1. **B.** Compatibility must be checked against the current Postman format and tool support.

2. **B.** Migration requires evidence-based compatibility checks.

3. **C.** Never claim compatibility without executing the actual collection.
