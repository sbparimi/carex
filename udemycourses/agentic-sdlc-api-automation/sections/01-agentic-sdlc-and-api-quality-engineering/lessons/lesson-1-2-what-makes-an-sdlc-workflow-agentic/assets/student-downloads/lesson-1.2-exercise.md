# Lesson 1.2 exercise — assign responsibility

## Scenario

A clinic changes its appointment-booking rule. AI agents interpret work items and propose test coverage. Postman executes API tests. A deterministic release policy blocks a release when a mandatory test fails.

## Your task

Open `responsibility-matrix.csv`. Review each of the ten activities and confirm or amend the suggested owner and rationale. For every row, explain why that responsibility belongs to an agent, deterministic component or human.

Then open `scenario-release-conflict.json` and answer:

1. What is the correct release outcome?
2. Which test result causes that outcome?
3. Why is the agent's GO recommendation not authoritative?
4. What can the agent still do to help investigate?
5. Who can approve an exception, and what evidence must be retained?

## Prediction pause

Do not inspect the answer key until you have written your own decision for the conflicting GO recommendation and failed mandatory test.

## Completion criteria

- All ten classifications are justified.
- You identify the mandatory failed test by ID.
- You apply the stated policy without allowing the agent to override it.
- You distinguish advisory explanation from authoritative test and policy evidence.
