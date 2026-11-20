# Knowledge check — Lesson 5.1: Model a business journey as API interactions

Choose the single best answer.

1. **What should define the request order in a business-journey collection?**
   - A. Business dependencies and required state transitions
   - B. Alphabetical order
   - C. Agent Mode output order
   - D. HTTP method grouping only

2. **A booking request needs a slot ID returned by availability. How should the collection handle it?**
   - A. Hard-code a live slot ID
   - B. Capture the returned identifier into a variable and use it downstream
   - C. Ask learners to guess
   - D. Skip availability

3. **Agent Mode creates a request for an undocumented endpoint. What is the correct action?**
   - A. Run it against production
   - B. Review against OpenAPI and remove or clarify unsupported operations
   - C. Assume it exists
   - D. Rename it

## Answer key and explanations
1. **A.** The sequence must reflect the actual workflow dependencies.

2. **B.** Runtime data flow keeps the journey reproducible.

3. **B.** Collection requests must be grounded in the API contract.
