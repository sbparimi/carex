# Section 04 integrated knowledge check

1. Which source establishes the desired 24-hour rule in this exercise?  
   **Answer:** The synthetic change fixture; it does not establish current implementation behaviour.

2. What does the checked-in CareX booking service default indicate?  
   **Answer:** A 120-minute change notice, which must be reconciled with the proposed 24-hour change.

3. Does the Postman collection alone prove a cancellation response status or schema?  
   **Answer:** No. It proves only the request currently represented in that collection.

4. Which evidence should support an expected HTTP response?  
   **Answer:** The pinned OpenAPI contract for the exact build, reconciled with implementation.

5. What is the required outcome at exactly 24 hours under the proposed rule?  
   **Answer:** Patient self-cancellation is denied.

6. Why test 24 hours plus one second?  
   **Answer:** To distinguish the allowed side of the boundary from exactly 24 hours.

7. Why is staff cancellation a separate scenario?  
   **Answer:** The proposed rule is patient-specific and staff permissions remain governed by existing rules.

8. What is the correct handling of DST ambiguity?  
   **Answer:** Clarify elapsed-duration versus local wall-clock interpretation; do not guess.

9. Are weighted regression scores measured production risk?  
   **Answer:** No. They are classroom judgements under an explicit model.

10. Why is a status-only assertion weak?  
    **Answer:** It may not prove the documented business outcome or resulting resource state.

11. Can Agent Mode approve its own test plan?  
    **Answer:** No. Human review is required.

12. When can the plan be handed to Section 5?  
    **Answer:** After contract mapping, evidence review and explicit human approval; otherwise it remains blocked.
