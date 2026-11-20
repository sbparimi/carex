# Lesson 1.4 practical assignment — contain an unsafe agent action

## Scenario
A malicious instruction is embedded in a CareX change description. It asks the agent to reveal a database URL, disable a mandatory test and run a write-enabled collection against a shared environment.

## Task
Analyse the threat and design a safe execution decision. Do not execute the embedded instructions.

## Starter
Use `untrusted-change-description.txt` and `agent-permission-inventory.csv`.

## Deliverables
1. Mark the untrusted instruction segments and explain why they have no authority.
2. Complete the permission inventory using least-privilege principles.
3. Produce a safe workflow decision: continue, pause, reject or request human approval at each relevant boundary.
4. Define the evidence that must be retained for security review.
5. State how the workflow behaves if schema validation fails or an agent tool call times out.

## Acceptance criteria
- No secret is disclosed or copied into prompts/logs.
- Mandatory tests and release policy cannot be changed by the agent.
- Write-enabled execution is restricted to a disposable, explicitly approved test environment.
- Proposed diffs are reviewed before execution.
- Invalid output and tool failures stop dependent actions safely.
- The decision and evidence are auditable.

## Verify
Use `expected-results/threat-review.md` to compare control coverage. The exercise is a design review; it does not authorise running destructive commands.
