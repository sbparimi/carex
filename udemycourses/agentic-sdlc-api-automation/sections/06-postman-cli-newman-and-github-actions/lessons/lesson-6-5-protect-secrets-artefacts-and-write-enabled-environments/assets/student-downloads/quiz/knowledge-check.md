# Knowledge check — Lesson 6.5: Protect secrets, artefacts and write-enabled environments

Choose the single best answer.

1. **A failed CI run prints an access token in the log. What is the priority?**
   - A. Keep the log for debugging
   - B. Treat the token as exposed, revoke/rotate it and remove further secret exposure
   - C. Ignore it if the job failed
   - D. Move it into the collection JSON

2. **When may a write-enabled environment be used in training?**
   - A. Whenever the URL responds
   - B. Only after verifying a dedicated disposable non-production target and the required approval controls
   - C. Against preview if it looks separate
   - D. With production credentials

3. **Can an Agent Mode recommendation override a failed mandatory CI gate?**
   - A. Yes, if confidence is high
   - B. Yes, if it says retry
   - C. No; deterministic mandatory policy and authorised human process remain in force
   - D. Only for release builds

## Answer key and explanations
1. **B.** A leaked credential must be treated as compromised.

2. **B.** Write permission must be tied to an isolated and verified target.

3. **C.** AI recommendations cannot override mandatory release controls.
