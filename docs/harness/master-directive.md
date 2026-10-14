# Build an autonomous engineering harness, not a collection of AI personas

For the white-label healthcare booking platform, Claude Cowork needs an engineering operating system that coordinates specialist agents, manages dependencies, verifies implementation, detects failures, and continues working until acceptance criteria are met.

The key distinction is that assigning Claude multiple specialist roles does not create a reliable autonomous engineering team. The harness must enforce how those specialists work, how their outputs are validated, and when the system is allowed to proceed.

Your existing project direction is to use Claude Cowork as the builder, work incrementally, preserve the monorepo, and keep the eventual production runtime independent of Cowork. The harness should follow those constraints.&#x20;

## 1. Target architecture

## Product Owner / Human Approval

Goals · priorities · acceptance criteria · restricted actions

## Autonomous Engineering Control Plane

Planner · task DAG · agent dispatcher · shared state · budget controls · recovery

Specialist agents

Product, design, architecture, implementation, security, QA

Execution engine

Dependencies, isolated changes, retries, checkpoints

Engineering state

Requirements, tasks, decisions, evidence, artifacts

Independent assurance

Tests, reviews, security checks, release gates

### Controlled engineering changes

Repository · Figma artifacts · tests · documentation · deployment pipeline

The control plane is the central authority. Specialist agents are workers, not independent decision-makers with unrestricted repository access.

## 2. Specialist team design

Use persistent role definitions and task-specific workers. Do not launch every specialist for every task; dispatch agents based on dependencies and risk.

| Agent                     | Responsibility                                                                  | Required output                                     |
| ------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| Product manager           | Convert requirements into testable user stories and acceptance criteria         | Prioritized backlog and traceability                |
| UX/UI designer            | Define screens, interactions, accessibility, and tenant branding                | Design specifications and component states          |
| Principal architect       | Define boundaries, interfaces, data models, and integration contracts           | Architecture decisions and dependency graph         |
| Frontend engineer         | Implement responsive booking screens and components                             | Code and frontend tests                             |
| Backend engineer          | Implement booking rules, APIs, and persistence                                  | Code, contracts, and integration tests              |
| AI engineer               | Build optional conversational assistance and recommendations                    | AI interfaces, evaluation cases, fallback behaviour |
| Security/privacy engineer | Review tenant isolation, authorization, data flows, and sensitive-data handling | Findings and remediation requirements               |
| QA automation engineer    | Validate user journeys and failure cases independently                          | Playwright tests and execution evidence             |
| SRE/DevOps engineer       | Validate CI, environments, observability, and release readiness                 | Pipeline checks and operational runbooks            |
| Independent reviewer      | Challenge implementation decisions and inspect evidence                         | Review findings and gate verdict                    |

A single agent may hold multiple roles on small tasks. High-risk implementation work should have a separate reviewer.

## 3. The autonomous control loop

This is the core of the harness. It must run repeatedly rather than stop after generating a plan or writing code.

\#chatgpt-mermaid-\_r_or\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(237, 237, 237);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_or\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_or\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_or\_ .error-icon{fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_or\_ .error-text{fill:rgb(237, 237, 237);stroke:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_or\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_or\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_or\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_or\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_or\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_or\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_or\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_or\_ .marker.cross{stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_or\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_or\_ p{margin:0;}#chatgpt-mermaid-\_r_or\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_or\_ .cluster-label text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_or\_ .cluster-label span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_or\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_or\_ .label text,#chatgpt-mermaid-\_r_or\_ span{fill:rgb(237, 237, 237);color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_or\_ .node rect,#chatgpt-mermaid-\_r_or\_ .node circle,#chatgpt-mermaid-\_r_or\_ .node ellipse,#chatgpt-mermaid-\_r_or\_ .node polygon,#chatgpt-mermaid-\_r_or\_ .node path{fill:rgb(9, 23, 44);stroke:rgb(31, 78, 148);stroke-width:1px;}#chatgpt-mermaid-\_r_or\_ .rough-node .label text,#chatgpt-mermaid-\_r_or\_ .node .label text,#chatgpt-mermaid-\_r_or\_ .image-shape .label,#chatgpt-mermaid-\_r_or\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_or\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_or\_ .rough-node .label,#chatgpt-mermaid-\_r_or\_ .node .label,#chatgpt-mermaid-\_r_or\_ .image-shape .label,#chatgpt-mermaid-\_r_or\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_or\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_or\_ .root .anchor path{fill:rgb(175, 175, 175)!important;stroke-width:0;stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_or\_ .arrowheadPath{fill:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_or\_ .edgePath .path{stroke:rgb(175, 175, 175);stroke-width:1px;}#chatgpt-mermaid-\_r_or\_ .flowchart-link{stroke:rgb(175, 175, 175);fill:none;}#chatgpt-mermaid-\_r_or\_ .edgeLabel{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_or\_ .edgeLabel p{background-color:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_or\_ .edgeLabel rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_or\_ .labelBkg{background-color:rgba(0, 0, 0, 0.5);}#chatgpt-mermaid-\_r_or\_ .cluster rect{fill:rgb(48, 48, 48);stroke:rgba(255, 255, 255, 0.15);stroke-width:1px;}#chatgpt-mermaid-\_r_or\_ .cluster text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_or\_ .cluster span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_or\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(48, 48, 48);border:1px solid rgba(255, 255, 255, 0.15);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_or\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_or\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_or\_ .icon-shape,#chatgpt-mermaid-\_r_or\_ .image-shape{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_or\_ .icon-shape p,#chatgpt-mermaid-\_r_or\_ .image-shape p{background-color:rgb(0, 0, 0);padding:2px;}#chatgpt-mermaid-\_r_or\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_or\_ .image-shape .label rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_or\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_or\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_or\_ .node .neo-node{stroke:rgb(31, 78, 148);}#chatgpt-mermaid-\_r_or\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_or\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_or\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_or\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_or\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_or\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_or\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_or\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_or\_ [data-look="neo"].node .neo-line path{stroke:rgb(31, 78, 148);filter:none;}#chatgpt-mermaid-\_r_or\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_or\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_or\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_or\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_or\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_or\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_or\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_or\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_or\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_or\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_or\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_or\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-width:1px;}#chatgpt-mermaid-\_r_or\_ .node rect,#chatgpt-mermaid-\_r_or\_ .node circle,#chatgpt-mermaid-\_r_or\_ .node ellipse,#chatgpt-mermaid-\_r_or\_ .node polygon,#chatgpt-mermaid-\_r_or\_ .node path{fill:rgb(0, 40, 77);stroke:rgba(255, 255, 255, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_or\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_or\_ .node.mermaid-decision .label-container{fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_or\_ .edgePaths .flowchart-link{stroke:rgb(175, 175, 175);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_or\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_or\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}Read product goal andrepository stateAnalyze requirements andconstraintsBuild dependency-awaretask graphSelect ready tasks withinbudgetDispatch specialist workersCollect code, artifacts andevidenceIndependent review andautomated verificationAcceptance criteria met?Integrate changes and runregression suiteRecoverable failure?Diagnose, create repair taskand retryEscalate blocker withevidenceContinue independent tasksRelease gates passed?Mark milestone completeProduct goal complete?Final evidence-based reportYesNoYesNoYesNoNoYes

### Required harness capabilities

- Planning: decompose a product goal into small, independently verifiable tasks.
- Dependency management: never start work whose prerequisites are unresolved.
- Parallel execution: run independent tasks concurrently while preventing conflicting edits.
- Shared state: maintain a durable record of task status, decisions, artifacts, blockers, and test evidence.
- Verification: require executable evidence rather than accepting an agent's claim that work is complete.
- Recovery: diagnose failed tests, create bounded repair tasks, and retry within configured limits.
- Budget management: track model usage, execution time, retry counts, and remaining work.
- Human approval gates: stop before production deployment, destructive changes, authentication, or other restricted actions.
- Resumability: recover the task graph and completed evidence after a session interruption.

## 4. Master instruction for Claude Cowork

# AUTONOMOUS ENGINEERING HARNESS — MASTER DIRECTIVE

## Mission

Build a reliable autonomous engineering workflow for the white-label AI-assisted healthcare appointment booking platform.

Operate as an engineering organization with specialized responsibilities, shared engineering state, dependency-aware execution, independent quality assurance, bounded recovery, and evidence-based completion.

Your objective is not to simulate a team through role-playing. Your objective is to implement and operate the mechanisms that make a multi-agent engineering team reliable.

## A. Establish the harness before scaling implementation

First inspect the repository, available Claude/Cowork execution capabilities, installed tools, existing automation, and project conventions.

Determine which capabilities are genuinely available:

- Specialist agents or delegated workers.
- Parallel task execution.
- Isolated workspaces or branches.
- Repository access and test execution.
- Durable task-state storage.
- CI and test-result retrieval.
- Approval controls and execution budgets.

Do not assume that a capability exists because a prompt describes it.

Separate native Claude capabilities from custom orchestration code. Reuse an established harness where it satisfies the requirements. Build missing capabilities only after identifying the gap.

Produce a capability matrix, architecture decision record, implementation plan, and risk assessment before undertaking a broad implementation.

## B. Implement a central orchestrator

The orchestrator must own the engineering workflow.

It must:

1. Accept a product goal or approved backlog.
2. inspect repository and project state.
3. Retrieve requirements, design references, and architecture decisions.
4. Decompose work into small tasks with explicit dependencies.
5. Assign tasks to appropriate specialist workers.
6. Dispatch only tasks whose dependencies are satisfied.
7. Collect structured results and changed-artifact references.
8. Run independent verification.
9. Create remediation tasks when checks fail.
10. Retry bounded, recoverable failures.
11. Continue independent work while blocked tasks await resolution.
12. checkpoint state and resume after interruptions.
13. Stop at mandatory approval gates.
14. Produce a final report supported by evidence.

Prevent uncontrolled recursive delegation and infinite repair loops.

## C. Define strict worker contracts

Every worker receives:

- Task identifier and objective.
- Specialist responsibility.
- Relevant requirements and acceptance criteria.
- Repository and artifact references.
- Explicit files or modules in scope.
- Dependencies and prerequisite evidence.
- Permitted tools and actions.
- Required tests and verification evidence.
- Time, token, and retry budgets.
- Completion and escalation conditions.

Every worker returns structured information:

- Status: completed, blocked, failed, or needs review.
- Summary of changes.
- Changed file paths and artifact references.
- Tests executed and actual results.
- Acceptance criteria satisfied and unsatisfied.
- Risks, assumptions, and unresolved questions.
- Recommended next task.

Reject unsupported completion claims.

## D. Enforce safe parallel engineering

Parallelize analysis, requirements refinement, design exploration, independent test development, and implementation tasks with clearly separated ownership.

Use isolated workspaces or branches for conflicting code changes whenever supported.

Require explicit interface contracts before parallel frontend and backend implementation.

Do not allow multiple workers to overwrite shared files or silently resolve conflicting architecture decisions.

An integration worker must reconcile changes and run regression tests before changes are accepted.

Do not automatically merge or deploy without the required approval.

## E. Make verification mandatory

Implement verification at multiple levels:

- Requirement and acceptance-criteria review.
- Static analysis and type checking.
- Unit tests.
- API and contract tests.
- Playwright end-to-end tests.
- Accessibility checks.
- Security and tenant-isolation tests.
- Build and integration checks.
- Release-readiness review.

Require a separate reviewer for security-sensitive and high-risk changes.

A failed test must create a diagnostic and remediation task, not be ignored or removed merely to achieve a green pipeline.

A task is complete only when its acceptance criteria and required evidence are satisfied.

## F. Implement bounded self-repair

When a check fails:

1. Capture the actual error and reproduction context.
2. Determine whether the failure is caused by code, test assumptions, configuration, infrastructure, or an external dependency.
3. Assign a bounded diagnostic task.
4. Create a minimal remediation change.
5. Rerun the relevant failing test.
6. Rerun regression checks affected by the change.
7. Escalate if retry limits are exhausted or evidence remains inconclusive.

Never modify acceptance criteria solely to conceal a failure.

Never fabricate successful test results.

## G. Maintain durable engineering state

Maintain a machine-readable task graph and human-readable project documentation.

Record:

- Requirements and their identifiers.
- Task status and dependencies.
- Agent assignments.
- Architecture decisions.
- Artifact and commit references.
- Test results and evidence.
- Blockers and external dependencies.
- Retry counts and resource consumption.
- Approval decisions.
- Milestone and release status.

Make task execution resumable and idempotent where possible.

The repository must remain understandable to a human engineer without requiring the entire previous conversation.

## H. Apply product-specific guardrails

The product is a multi-tenant US healthcare appointment booking platform.

Preserve:

- Configurable hospital branding and service catalogs.
- State-to-clinic filtering.
- Clinic-to-visit-type eligibility.
- Provider and slot validation.
- Explicit patient confirmation.
- Authoritative booking outcomes.
- Duplicate-booking prevention.
- Optional AI assistance.
- Tenant isolation and privacy-aware engineering.
- Accessible, responsive user interfaces.
- Automated Playwright regression coverage.

AI must not invent availability, override authorization, or falsely confirm a booking.

Keep synthetic data separate from real patient data.

## I. Control execution and approvals

Use configurable limits for:

- Concurrent workers.
- Task duration.
- Model and token expenditure.
- Retry counts.
- Repository write scope.
- External tool calls.

Pause when a required credential, API contract, product decision, or external approval is missing.

Do not perform authentication, account connections, production deployment, destructive infrastructure operations, or unapproved merges without explicit authorization.

## J. Build incrementally

Implement the harness in verifiable milestones:

1. Repository audit and capability assessment.
2. Task contracts and durable state model.
3. Dependency-aware orchestrator.
4. Specialist dispatch and isolated execution.
5. Independent verification and remediation.
6. Budget controls, approvals, and observability.
7. Resume/recovery testing.
8. End-to-end demonstration on the appointment booking project.

At every milestone, provide working code, automated tests, architecture documentation, known limitations, and evidence.

Do not begin a broad rewrite before the current repository and execution environment have been inspected.

Start with the capability assessment and harness architecture. Then implement the smallest end-to-end autonomous loop and prove that it works before expanding parallelism.

## 5. How to make this scale reliably

Start with a small operational harness, then increase the number of workers only after it can reliably recover from failure.

## 1

Single orchestrator, two workers

Prove task dispatch, structured results, isolated changes, test verification, and state persistence.

## 2

Dependency-aware specialist team

Add product, design, frontend, backend, and QA responsibilities with interface contracts and independent reviews.

## 3

Self-repair and recovery

Introduce bounded retries, diagnostic tasks, checkpoint recovery, and failure escalation.

## 4

Controlled scale

Increase concurrency and add security, AI evaluation, accessibility, CI/CD, and release-governance specialists.

The acceptance test for the harness itself: give it a booking feature with explicit requirements, allow it to plan and implement the feature, deliberately introduce a failing test, and verify that it diagnoses the failure, repairs the implementation, reruns tests, persists its state, and reports the actual evidence. It must also demonstrate that it stops at a prohibited action rather than bypassing approval.

That is the difference between a coding assistant with several personas and an autonomous engineering system.