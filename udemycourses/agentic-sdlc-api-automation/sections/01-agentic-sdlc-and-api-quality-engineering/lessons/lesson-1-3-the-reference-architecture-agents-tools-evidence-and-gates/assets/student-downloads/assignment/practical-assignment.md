# Lesson 1.3 practical assignment — map the Postman Agentic SDLC architecture

## Scenario
A CareX change request modifies patient appointment cancellation. The workflow must use Postman Agent Mode to analyse the change, propose test scenarios, update a Postman collection under review, execute the tests with Postman CLI and report evidence through GitHub Actions.

## Task
Create an architecture diagram and a responsibility/evidence matrix for the end-to-end workflow.

## Starter
Use the supplied `workflow-components.csv` and `test-plan-output.example.json` as reference inputs. Use the Postman governance lab as the executable example.

## Deliverables
1. A workflow diagram showing business change intake, Postman Agent Mode, human review, Postman collection, Postman assertions, Postman CLI, GitHub Actions, evidence and release decision.
2. A responsibility matrix stating what each component may read, propose, change, execute and approve.
3. One structured Agent Mode test-plan proposal with source references and open questions.
4. One failure path showing how an unsupported endpoint or unsafe proposed action is rejected.
5. A short explanation of why a passing proposal-validation test is not proof that the API behaviour is correct.

## Acceptance criteria
- Postman Agent Mode is the primary learner-facing AI agent.
- Postman collections remain the primary API automation artefact.
- Postman assertions verify actual API behaviour.
- Postman CLI executes reviewed collections; GitHub Actions coordinates CI.
- Agent output is treated as a proposal, not an approval.
- Human review is explicit for collection changes and release decisions.
- No Python policy gate or separate test framework is required.
- Every hand-off has an input, output and evidence reference.

## Verify
Import and run the Postman Agentic SDLC Governance lab. Generate a proposal with Agent Mode, paste it into the `agentProposal` collection variable, and run the learner validation request. Explain what the collection validates and what it does not.
