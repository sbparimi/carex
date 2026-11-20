# Knowledge check — Lesson 5.4: Review and maintain generated collection changes

Choose the single best answer.

1. **Agent Mode proposes changing a shared environment and adding a new write request. What should happen first?**
   - A. Accept both changes
   - B. Review the diff and verify the requirement, contract and target environment before approval
   - C. Run against production
   - D. Disable tests

2. **What is the best evidence that an AI-generated collection change is acceptable?**
   - A. Agent says it is done
   - B. A reviewed diff, contract traceability and passing relevant Postman tests
   - C. A large number of new requests
   - D. A screenshot only

3. **Why commit a reviewed collection checkpoint?**
   - A. To make the AI prompt shorter
   - B. To preserve traceability and enable comparison/rollback
   - C. To bypass Postman tests
   - D. To hide changes

## Answer key and explanations
1. **B.** Agent changes require review, especially when environment or write scope changes.

2. **B.** Review and independent execution evidence support the change.

3. **B.** Version control provides provenance and controlled change history.
