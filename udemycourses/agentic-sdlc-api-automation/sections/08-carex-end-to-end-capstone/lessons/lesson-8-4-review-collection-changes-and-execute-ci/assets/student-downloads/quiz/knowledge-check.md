# Knowledge check — Lesson 8.4: Review collection changes and execute CI

Choose the single best answer.

1. **What should happen before a generated collection update is executed?**
   - A. Automatic merge
   - B. Human review of the diff and contract traceability
   - C. Production run
   - D. Disable assertions

2. **What should CI execute?**
   - A. The latest unreviewed Agent Mode draft
   - B. The committed reviewed collection revision
   - C. A different test suite
   - D. Only the model's summary

3. **What should happen when a mandatory test fails in GitHub Actions?**
   - A. Mark the workflow successful manually
   - B. Preserve the failed gate and retain evidence for diagnosis
   - C. Delete the run
   - D. Ask Agent Mode to approve release

## Answer key and explanations
1. **B.** AI-generated changes must be reviewed before execution.

2. **B.** CI must execute a versioned approved artefact.

3. **B.** Mandatory failures remain visible and cannot be overridden by the agent.
