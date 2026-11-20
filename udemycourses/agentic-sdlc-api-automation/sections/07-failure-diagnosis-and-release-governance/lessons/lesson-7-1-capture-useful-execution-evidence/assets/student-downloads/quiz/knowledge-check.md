# Knowledge check — Lesson 7.1: Capture useful execution evidence

Choose the single best answer.

1. **Which evidence set best supports failure diagnosis?**
   - A. A green badge only
   - B. Request, response, assertion, environment, run ID and collection revision
   - C. A model confidence score
   - D. A chat transcript only

2. **Why record the collection commit alongside the run?**
   - A. To make the report longer
   - B. To identify exactly which tests and scripts produced the result
   - C. To replace the run ID
   - D. To avoid reviewing failures

3. **What should be excluded from retained evidence?**
   - A. Redacted request metadata
   - B. Assertion names
   - C. Access tokens and passwords
   - D. Exit code

## Answer key and explanations
1. **B.** Diagnosis requires correlated execution evidence and version context.

2. **B.** The commit ties execution evidence to the tested artefact.

3. **C.** Secrets must not be retained in reports or logs.
