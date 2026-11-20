# Expected result — Lesson 4.4

Learners should identify at least seven distinct defects.

| Defect | Why it is invalid | Corrective action |
|---|---|---|
| PATCH method | Checked-in collection shows POST; OpenAPI must confirm final method | Use POST only after pinned contract confirms |
| Invented response.cancelled field | No response schema evidence | Remove until schema proves it |
| Invented 403 | No pinned response contract | Mark HTTP expectation unverified |
| Invented error_code property | No response schema evidence | Do not assert it |
| Missing exact 24-hour boundary | Core business boundary omitted | Add exact 24h and near-boundary cases |
| Ownership result treated as proven 404 | Implementation may hide resource, but contract not pinned | Assert business privacy outcome; verify exact response separately |
| Staff receives patient threshold | Contradicts explicit change scope | Keep staff cancellation governed by existing permissions |
| Wrong staff operation path | Patient endpoint reused for staff workflow | Inspect pinned OpenAPI and collection for staff cancellation |
| Duplicate 30h/31h happy paths | Adds rows without increasing boundary coverage | Replace one with 24h+1s |
| Status-only assertions | A status alone may not prove business state | Assert documented response contract and verify persisted state in isolated test setup |

## Verification standard
A defect is closed only when the revised scenario has source evidence, a meaningful expected business outcome and a contract-backed request/response expectation. Agent Mode's own statement that it fixed the issue is not verification.
