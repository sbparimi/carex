# Executable lab — deterministic gate around agent proposals

## Learning objective
Run a small Python policy gate and prove that an agent proposal cannot silently perform write actions or approve a release.

## Requirements
- Python 3.11+
- No third-party packages
- Run from this directory

## Files
- `policy_gate.py`: validator and CLI
- `examples/safe-proposal.json`: evidence-backed proposal
- `examples/unsafe-proposal.json`: unsafe write and release approval
- `test_policy_gate.py`: five standard-library unit tests
- [Test execution record](test-execution-record.md)

## Run the tests
```bash
python -m unittest -v
```
Expected: 5 tests pass.

## Run the safe proposal
```bash
python policy_gate.py examples/safe-proposal.json
```
Expected: exit code 0 and `VALIDATED_FOR_REVIEW`. This is not execution or release approval.

## Run the unsafe proposal
```bash
python policy_gate.py examples/unsafe-proposal.json
```
Expected: exit code 2 and `BLOCKED`; write actions require separate human approval and release approval is never accepted.

## Instructor demonstration sequence
1. Ask learners to predict the unsafe result.
2. Run the safe example and inspect the evidence references.
3. Run the unsafe example; point out both blocked writes and prohibited release approval.
4. Remove the evidence_ref from the safe example and rerun.
5. Add an unknown action such as `send_customer_email`; rerun.
6. Run unit tests and interpret each test as a safety invariant.

## Intentional limitation
This is a deterministic teaching harness, not an agent framework or a production authorization service. The `--human-approved` flag simulates a separate approval decision and is not an identity or access-control mechanism. No network calls, database writes or real releases occur.
