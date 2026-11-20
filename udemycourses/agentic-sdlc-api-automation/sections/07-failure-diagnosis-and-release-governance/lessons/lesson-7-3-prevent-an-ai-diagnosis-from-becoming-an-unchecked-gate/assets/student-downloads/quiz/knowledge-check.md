# Knowledge check — Lesson 7.3: Prevent an AI diagnosis from becoming an unchecked gate

Choose the single best answer.

1. **Agent Mode labels a failed test as flaky and recommends rerun. What should the pipeline do?**
   - A. Ignore the failure automatically
   - B. Apply the documented retry policy and retain both original and retry evidence
   - C. Mark release approved
   - D. Delete the original run

2. **What is required before a failure can be waived?**
   - A. Agent confidence above 90%
   - B. A documented authorised human decision under release policy
   - C. A green unrelated test
   - D. A prompt rewrite

3. **A failure classification conflicts with a mandatory deterministic gate. Which wins?**
   - A. Agent diagnosis
   - B. Model preference
   - C. Mandatory deterministic gate
   - D. Most recent chat message

## Answer key and explanations
1. **B.** AI diagnosis is a hypothesis; deterministic retry rules and evidence remain authoritative.

2. **B.** Only authorised human governance can approve exceptions where policy allows.

3. **C.** Agents cannot override mandatory release controls.
