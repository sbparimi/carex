# Knowledge check — Lesson 3.4: Retries, timeouts, idempotency and audit trail

Choose the single best answer.

1. **An Agent Mode analysis times out before producing an output. What is the safest retry approach?**
   - A. Retry the bounded, read-only analysis with the same versioned inputs and record the attempt
   - B. Repeat every API write request
   - C. Assume the previous run completed
   - D. Disable validation

2. **A booking POST times out and the client does not know whether the server created the booking. What should the test workflow do?**
   - A. Blindly send a new POST with a new key
   - B. Inspect the existing request outcome and use the API's documented idempotency contract
   - C. Delete all appointments
   - D. Mark the test passed

3. **Which evidence best supports an audit trail?**
   - A. A screenshot of a green badge only
   - B. A prompt without inputs
   - C. Versioned change, prompt/output, collection diff, run ID and reviewer decision
   - D. A model's confidence score alone

## Answer key and explanations
1. **A.** Read-only analysis can be retried with bounded policy and traceable inputs.

2. **B.** A timeout leaves outcome uncertain; duplicate side effects must be prevented.

3. **C.** The audit trail needs traceable inputs, changes, execution and approval.
