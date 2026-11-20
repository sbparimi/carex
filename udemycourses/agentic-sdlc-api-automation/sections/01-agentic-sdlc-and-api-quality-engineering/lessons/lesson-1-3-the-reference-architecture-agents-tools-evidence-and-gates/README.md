# Lesson 1.3 — The reference architecture: agents, tools, evidence and gates

**Section:** 01 — Agentic SDLC and API Quality Engineering  
**Status:** Learner materials authored; live Postman Agent Mode demonstration and app-level rehearsal remain open.

## Measurable outcome
Given a CareX business change, learners can map the Agentic SDLC stages, identify what Postman Agent Mode proposes, what Postman tests and CLI execute, what GitHub Actions automates, what evidence is retained, and where human approval is mandatory.

## Seven-part lesson
1. **Opening:** Show a change request that could affect appointment cancellation.
2. **Concept:** Separate AI reasoning, deterministic API assertions/execution and human authority.
3. **Why:** Explain why unreviewed AI changes can create false coverage and unsafe writes.
4. **Demo:** Use Postman Agent Mode to produce a structured test proposal; validate safe and unsafe examples with the Postman governance lab.
5. **Build:** Learners map the workflow and adapt the proposal prompt.
6. **Verify:** Run safe, unsafe and learner-proposal requests; inspect each assertion and identify what it does not prove.
7. **Recap:** Carry the workflow map and validated proposal into Section 2.

## Demo and learner assets
- [Postman Agentic SDLC Governance lab](assets/demo/postman-agentic-governance-lab/README.md)
- [Importable Postman collection](assets/demo/postman-agentic-governance-lab/CareX-Agentic-SDLC-Governance.postman_collection.json)
- [Agent Mode prompt](assets/demo/postman-agentic-governance-lab/agent-proposal-prompt.md)
- [Learner resources](assets/student-downloads/README.md)

## Technology boundary
Postman Agent Mode is the learner-facing AI agent. Postman collection scripts validate the proposal and API behaviour. Postman CLI runs collections later in the course. GitHub Actions automates CI. No Python policy gate is required.

## Acceptance evidence
Do not mark this lesson complete until the Agent Mode interaction is recorded, the imported collection runs successfully in a safe non-production environment, learners complete the independent task, and all applicable 13 lesson-quality criteria score 10/10 with evidence.
