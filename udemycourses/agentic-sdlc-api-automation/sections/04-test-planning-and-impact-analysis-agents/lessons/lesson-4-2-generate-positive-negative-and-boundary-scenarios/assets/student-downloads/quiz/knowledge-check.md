# Knowledge check — Lesson 4.2: Generate positive, negative and boundary scenarios

Choose the single best answer.

1. **For a strict more-than-24-hours rule, which boundary values must be considered?**
   - A. Only 48 hours
   - B. Just over 24 hours, exactly 24 hours and just under 24 hours
   - C. Only 1 hour
   - D. Any three random dates

2. **Which is a negative ownership scenario?**
   - A. Patient cancels their own eligible appointment
   - B. Staff cancels under existing permission
   - C. Patient attempts to cancel another patient's appointment
   - D. Patient reads public clinic details

3. **Agent Mode generates 12 positive cases but no negative cases. What should the reviewer do?**
   - A. Accept because quantity is high
   - B. Ask for negative/authorization/boundary coverage and inspect evidence
   - C. Assume the model considered them
   - D. Delete the acceptance criteria

## Answer key and explanations
1. **B.** Boundary tests distinguish > from >= and expose off-by-one errors.

2. **C.** Ownership is an authorization boundary and must be tested.

3. **B.** Scenario count does not demonstrate coverage across risk classes.
