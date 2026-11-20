# Expected architecture checks — Lesson 1.3

A correct architecture includes:
- A source/change intake with revision identity.
- Specialist agents with narrow, read-oriented responsibilities.
- A deterministic schema validator between generated output and downstream execution.
- A human review boundary for high-impact or ambiguous decisions.
- A deterministic Postman execution component isolated to a test environment.
- A policy evaluator that reads authoritative test evidence and a versioned policy.
- An evidence store that preserves source, proposal, validation, run and decision artefacts.

The provided JSON example is structurally suitable for the supplied schema. It intentionally leaves the exact expected error response unresolved and requires approval. This fixture is not a live CareX execution result.
