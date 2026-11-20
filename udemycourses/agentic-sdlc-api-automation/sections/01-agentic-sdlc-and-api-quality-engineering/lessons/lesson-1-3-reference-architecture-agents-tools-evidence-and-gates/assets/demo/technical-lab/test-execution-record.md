# Test execution record — Section 1 technical lab

**Artifact:** deterministic proposal policy gate  
**Test command:** `python -m unittest -v`  
**Runtime:** Python standard library; isolated temporary directory  
**Result:** PASS — 5 tests, 0 failures, 0 errors; process exit code 0.

| Test | Result | Safety property |
|---|---|---|
| Evidence-backed read proposal | PASS | Valid proposal reaches review state |
| Write action without human approval | PASS | Mutating action is blocked |
| Unknown action | PASS | Unlisted capability is rejected |
| Agent release approval | PASS | Agent cannot approve/execute release |
| Missing evidence reference | PASS | Read/proposal actions require provenance |

**Scope:** This validates the policy function's unit tests. It does not validate integration with CareX, Postman, Jira, GitHub Actions, an LLM, production identity controls or a real approval workflow. The CLI examples have not been recorded as separately executed in this evidence note.
