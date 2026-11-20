# Knowledge check — Lesson 6.4: Build a GitHub Actions pipeline

Choose the single best answer.

1. **What should a CI pipeline run?**
   - A. The agent’s unreviewed draft
   - B. A reviewed, version-controlled Postman collection
   - C. A production write-enabled collection by default
   - D. Only a health request

2. **Where should a Postman API key be stored when cloud authentication is required?**
   - A. Committed environment JSON
   - B. Workflow secret
   - C. Collection description
   - D. Console output

3. **What is the correct response to a failing required assertion?**
   - A. Force the job to pass
   - B. Preserve failure status and report evidence for diagnosis
   - C. Delete the assertion
   - D. Allow the agent to approve release

## Answer key and explanations
1. **B.** CI should execute a reviewed artefact, not an unreviewed proposal.

2. **B.** Secrets belong in the CI secret store and must not be printed.

3. **B.** Mandatory quality failures must remain visible to the pipeline.
