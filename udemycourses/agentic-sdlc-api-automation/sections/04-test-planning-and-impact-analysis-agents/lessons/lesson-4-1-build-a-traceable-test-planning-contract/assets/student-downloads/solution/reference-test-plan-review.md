# Reference solution — Lesson 4.1

## Correct disposition
**Decision: blocked pending contract and implementation reconciliation.**

The training collection establishes a POST cancellation request at /t/{tenant}/api/v1/appointments/{appointmentId}/cancel with a reason example. It does not establish response status codes or schemas.

The checked-in source has two distinct time rules:
- Scheduling.min_change_notice_minutes defaults to 120. Patient cancellation is rejected by the online change-window guard when the appointment starts less than this many minutes after the current instant.
- tenants.late_cancel_hours defaults to 24 and sets a late_cancel classification flag. It does not itself reject cancellation.

The synthetic change proposes a 24-hour patient cancellation denial threshold. It therefore changes the current 120-minute gate. A learner must not confuse the 24-hour late-cancel flag with a 24-hour cancellation block.

## Minimum traceability chain
CAREX-CHANGE-030-CANCEL-24H → patient self-cancellation rule → scenario ID → cancellation request in Postman → pinned OpenAPI operation → implementation revision → isolated execution evidence.

## Review checklist
1. Is the rule sourced from the synthetic change fixture?
2. Is current behaviour distinguished from desired behaviour?
3. Are the 120-minute gate and 24-hour late-cancel flag kept separate?
4. Is the OpenAPI revision pinned?
5. Are status and response schema claims supported?
6. Are elapsed-time versus local wall-clock semantics clarified?
7. Are staff permissions treated as a separate regression concern?

## Approval condition
Approve the plan for collection design only after the OpenAPI operation and implementation change are reconciled. Approval for collection design is not approval to execute against shared data.
