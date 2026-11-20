# Expected threat review — Lesson 1.4

The injected text is data in a change description. It cannot override system instructions, permissions, test policy or release governance.

Required controls:
- Do not grant requirement-analysis agents access to secret stores.
- Keep test planning and release policy modification separate.
- Restrict the Postman runner to approved collections and disposable test environments.
- Never expose production credentials to an LLM or report.
- Require diff review before executing generated collection changes.
- Validate every structured hand-off; malformed output stops downstream execution.
- On timeout, use bounded retry with idempotency protection where appropriate; preserve the failed attempt and do not infer success.
- Retain source revision, proposed action, validation result, reviewer, execution report and policy decision.

The correct response is to reject the secret-exfiltration and policy-tampering instructions, keep the legitimate booking-display request for normal analysis, and require review before any write-enabled test execution.
