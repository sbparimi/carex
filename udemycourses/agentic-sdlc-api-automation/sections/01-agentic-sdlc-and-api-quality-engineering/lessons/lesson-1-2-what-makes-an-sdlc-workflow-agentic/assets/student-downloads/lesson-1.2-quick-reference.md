# Lesson 1.2 quick reference — who owns the decision?

| Work type | Primary owner | Typical examples |
|---|---|---|
| Contextual interpretation and planning | Agent | Extract acceptance criteria, identify ambiguity, propose impact |
| Repeatable checks and execution | Deterministic component | Schema validation, API assertions, collection execution, policy gate |
| Accountable authority | Human | Approve risk exception, authorise high-impact production action |

## Rule of thumb

Agents reason and recommend. Deterministic components validate, execute and enforce pre-approved policy. Humans own decisions requiring accountability or explicit authority.

## Release conflict

If a mandatory test fails, the deterministic release policy blocks the release even when an agent recommends GO. Keep the agent's summary separate from the raw report and policy result.
