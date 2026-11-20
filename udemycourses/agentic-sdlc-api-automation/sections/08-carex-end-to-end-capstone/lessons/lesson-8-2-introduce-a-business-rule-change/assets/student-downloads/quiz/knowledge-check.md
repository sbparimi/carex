# Knowledge check — Lesson 8.2: Introduce a business-rule change

Choose the single best answer.

1. **What is the exact cancellation boundary?**
   - A. At least 24 hours
   - B. More than 24 hours; exactly 24 hours is not allowed
   - C. Less than 24 hours
   - D. Any time if patient is logged in

2. **What timezone applies to the cancellation comparison?**
   - A. Learner laptop timezone
   - B. UTC by assumption
   - C. Clinic-local timezone
   - D. Browser locale

3. **Staff cancellation is changed by the new rule. True or false?**
   - A. Yes, same rule applies to staff
   - B. No; existing staff permissions remain in force
   - C. Staff can cancel any tenant
   - D. Staff approvals are removed

## Answer key and explanations
1. **B.** The policy uses a strict greater-than boundary.

2. **C.** The approved rule explicitly uses clinic-local time.

3. **B.** The change applies to patient self-cancellation; staff permissions remain existing policy.
