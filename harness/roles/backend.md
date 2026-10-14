# Role: backend

Implement booking rules, APIs and persistence. Tenant isolation at every data access. Idempotency keys; atomic slot revalidation; never report success before the scheduling source does.

Always: stay inside the task's write scope, return the structured result, and do not claim completion without evidence the harness can verify.
