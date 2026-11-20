# Knowledge check — Lesson 3.3: Structured outputs, schemas and validation

Choose the single best answer.

1. **A JSON proposal passes schema validation but contains a scenario unsupported by the requirement. What does that prove?**
   - A. The scenario is correct
   - B. Only that the output conforms structurally; semantic review is still required
   - C. The API endpoint exists
   - D. The release is approved

2. **Which field is essential for tracing a proposed scenario to its source?**
   - A. A colourful label
   - B. A source/evidence reference
   - C. A model name
   - D. A free-form confidence adjective

3. **The agent returns action=update_collection but the allow-list permits only read_contract and propose_test. What should Postman validation do?**
   - A. Silently ignore the action
   - B. Execute it if the JSON is valid
   - C. Fail the policy assertion and require human review
   - D. Change the allow-list automatically

## Answer key and explanations
1. **B.** Structural validity is not semantic correctness or source verification.

2. **B.** Evidence references make proposals reviewable and traceable.

3. **C.** A syntactically valid proposal can still violate deterministic policy.
