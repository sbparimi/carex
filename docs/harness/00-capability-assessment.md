# Milestone 1 — Capability Assessment, ADR, Plan, Risks

Project: White-label AI-assisted patient appointment booking (PRD v0.2)
Date: 2026-10-14 · Status: DRAFT for Product Owner approval
Scope of this document: what exists *now*, what the harness must add, and the smallest first loop. No product code has been written.

---

## 1. Repository and environment audit

| Item | Finding | Evidence |
|---|---|---|
| Target repository | **None found.** The cloud workspace has an empty home directory and is not a git repo. | `ls -la`, `git` check: "Is a git repository: false" |
| Your computer | Linked (Mac, arm64), but **no folder is connected**, so no existing monorepo is reachable yet. | `get_device_info.connectedFolders = []` |
| Toolchain (cloud workspace) | Node 22.22, npm 10.9, pnpm 10.28, Python 3.13, git 2.43, Docker CLI, gh CLI, 2 vCPU / 7 GB RAM | probe command |
| Browser testing | Playwright 1.56 present, Chromium preinstalled at `/opt/pw-browsers` | probe command |
| CI / remote | No git remote and no CI config. Nothing to retrieve results from yet. | no repo |
| Existing automation | None in the workspace. | empty dir |

**Consequence:** the "preserve the monorepo" constraint cannot be applied until a repository is connected or a new one is approved. Everything below is designed to be repo-agnostic.

## 2. Capability matrix

Legend: **Native** = Claude provides it; **Partial** = exists but must be wrapped; **Build** = harness must supply it; **Unverified** = not yet proven in this session.

| Required capability (from directive) | Status | Mechanism available | Gap / what the harness adds |
|---|---|---|---|
| Specialist workers | Native | Subagent tool with selectable agent types; role prompts stored as files | Role definitions + strict worker contract (JSON schema) |
| Parallel execution | Native (Unverified at scale) | Multiple subagents per turn; git worktrees | Concurrency cap, file-ownership locks. Only 2 vCPU, so cap at 2–3 workers |
| Isolated workspaces | Native | Worktree isolation for subagents, plain `git worktree` | Branch naming + integration worker that merges |
| Repo access and test execution | Native | Shell, file tools, Playwright | Needs an actual repo |
| Durable task state | **Build** | Session task list is UI-only and not a source of truth | Repo-local `harness/state/*.json` (task graph, evidence, approvals), committed |
| Dependency-aware scheduling | **Build** | None | Deterministic DAG scheduler (code, not prompt) |
| Verification with evidence | Partial | Can run tests | Runner that records command, exit code, output hash, timestamp; a task cannot reach `done` without an evidence record the runner itself wrote |
| Independent review | Partial | Separate subagent with no write access to the code under review | Reviewer contract + gate verdict file |
| Bounded self-repair | **Build** | None | Retry counters, failure classifier, repair-task generator, hard caps |
| Budget controls | Partial | Token budget is visible to the session only | Harness-level counters: workers, wall time, retries; token use recorded as estimate only |
| Human approval gates | Partial | Permission prompts, hooks | Hook/deny-list on restricted actions plus an `approvals.json` the orchestrator checks. Gate must fail closed |
| Resumability | **Build** | Session can end; files persist only if the repo is saved | Idempotent tasks, checkpoint after every state transition, `harness resume` command |
| CI result retrieval | Unverified | `gh` CLI exists | Needs a GitHub remote and your authorization |
| Figma artifacts | **Not available** | No Figma connector is attached | PRD §22 says no Figma source exists. Design work is limited to specs and the mockup image until a connector or file is provided |
| External credentials | Blocked by design | n/a | Per your standing preference, secrets are never pasted into chat; the harness reads env vars from local `.env` that you fill yourself |

Honest limitation: parallel subagents and session continuity are native, but **nothing native enforces** the loop, the gates, or the evidence rule. That enforcement is the thing to build, and it must be ordinary deterministic code rather than instructions to a model.

## 3. Architecture Decision Record

**ADR-001 — Thin deterministic control plane on top of native Claude primitives**

*Context.* The directive asks for an autonomous engineering system, not personas. Models are good workers and unreliable referees of their own work.

*Options considered*
1. Prompt-only: one large instruction file, Claude self-manages. Rejected: no enforcement, state lost on interruption, completion claims unverifiable.
2. Adopt a third-party multi-agent framework. Deferred: adds a dependency and a second runtime before we know what is missing. Revisit if the custom scheduler outgrows ~1k lines.
3. **Chosen:** a small TypeScript CLI (`harness`) that owns the task graph, scheduler, evidence runner, retry limits and approval gates, and uses Claude subagents only as workers.

*Decision.*
- The **orchestrator is code**. It decides what runs, accepts or rejects results, and writes state. The model never edits `harness/state/` directly.
- **Workers** receive a task contract and return a result JSON; they have write scope limited to the files listed in the task.
- **"Done" is computed**, not claimed: a task is done only when every required check in its contract has a runner-written passing evidence record.
- **Approval gates fail closed.** Restricted actions (deploy, merge to main, auth/account connection, destructive infra, credential access, dependency on real PHI) require a matching entry in `approvals.json` signed off by you.
- **Production runtime is independent of the harness.** The harness lives in `/harness` and `/.claude`; the product lives in `/apps` and `/packages` and never imports from it.
- State is plain JSON + Markdown in the repo, so a human or a new session can resume from the repo alone.

*Consequences.* More upfront work than a prompt, but every later milestone becomes testable. The harness itself needs tests, including the acceptance test in §6.

**Proposed layout (once a repo exists)**

```
/apps/web            patient booking UI
/apps/api            booking API + mock scheduling source
/packages/contracts  OpenAPI/zod interface contracts (frontend/backend meet here)
/packages/tenant-config
/harness             orchestrator CLI, scheduler, runner, gates, tests
/harness/roles       role definitions (product, ux, architect, fe, be, ai, security, qa, sre, reviewer)
/harness/state       tasks.json, evidence/, decisions/, approvals.json  (orchestrator-owned)
/docs                ADRs, requirements trace matrix, runbooks
/tests/e2e           Playwright
```

## 4. Requirements baseline extracted from the PRD

IDs already in the PRD are kept: BR-001…BR-012, FR-001…FR-010, plus AI priorities P1/P2 from §20 and constraints in §21. The Product Manager worker's first task is to turn these into a `requirements.json` with testable acceptance criteria and a trace matrix (requirement → task → test → evidence).

**Items the PRD explicitly leaves undecided (they block specific tasks, not the whole project):**

| Open decision | Blocks | Proposed default to keep moving (needs your OK) |
|---|---|---|
| Scheduling system / API | Real integration, atomic reservation semantics | Build against a **mock scheduling service behind a contract**; real adapter is a later task |
| Patient identity (guest vs login) | Booking payload, auth | Guest booking with minimal fields in MVP; **no authentication work without your approval** |
| Tenant entry strategy | Tenant resolution (FR-001) | Subdomain/path-based resolution behind an interface |
| Slot holds | Slot race handling | No holds; revalidate atomically at confirm |
| Confirmation delivery | Post-booking | On-screen only |
| Time zone policy | FR-006 | Clinic-local display with explicit zone label |
| Accessibility target | BR-011 | WCAG 2.2 AA (PRD's recommended baseline) pending approval |
| HIPAA/legal applicability | Any real data | Synthetic data only; a hard gate before any real PHI |
| AI provider and data handling | P1 AI features | AI behind a provider interface, **disabled by default**, with a deterministic stub used in tests |
| Figma | Design deliverables | Specs and component inventory only until a Figma connector or file is supplied |

## 5. Implementation plan (mirrors directive §J)

Each milestone ends with working code, automated tests, docs, known limitations, and evidence.

| # | Milestone | Exit evidence |
|---|---|---|
| 1 | **Repo audit + capability assessment** (this document) | Approved by Product Owner |
| 2 | Task contract + durable state model: JSON schemas for task, worker result, evidence, approval; state read/write with validation | Schema tests pass; invalid result rejected |
| 3 | Dependency-aware orchestrator (single worker): DAG scheduler, checkpointing | Tests: blocked task never dispatched; kill and resume reproduces state |
| 4 | Specialist dispatch + isolated execution: worktree per task, scope enforcement, two concurrent workers | Test: out-of-scope file edit is rejected |
| 5 | Independent verification + remediation: evidence runner, reviewer gate, failure classifier, repair-task generator | Test: failing test creates diagnostic + repair task; deleting a test to go green is detected and rejected |
| 6 | Budgets, approvals, observability: retry caps, concurrency cap, fail-closed gates, run log | Test: prohibited action halts with an approval request |
| 7 | Resume/recovery test suite | Interrupt at each state transition; all resume idempotently |
| 8 | End-to-end demo on a small booking slice (state → clinic → visit type, mock scheduling source) | Acceptance test in §6 passes with recorded evidence |

Only after milestone 8 does the harness take on the full PRD journey (provider/slot, review, confirm, idempotency, tenant isolation, AI features).

## 6. Harness acceptance test (from your directive, made concrete)

1. Feed the harness a feature with explicit requirements (FR-003 clinic filtering by state and tenant).
2. It plans, implements, and verifies it.
3. A defect is deliberately injected so one test fails.
4. Verify: failure captured with real output, diagnostic task created, minimal fix applied, failing test and affected regression tests re-run, state persisted, final report quotes actual evidence.
5. Verify the harness **stops** when a worker attempts a restricted action (e.g. `git push` to main, or reading a credential file) and records an approval request instead of proceeding.
6. Verify an interrupted run resumes without redoing completed tasks.

## 7. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Workers claim success without proof | High | High | Evidence written only by the runner; worker claims are advisory |
| Repair loop makes tests pass by weakening them | Medium | High | Protected paths for tests/acceptance criteria; diff check flags deleted/skipped tests; reviewer must approve test-file changes |
| Parallel workers conflict on shared files | Medium | Medium | Per-task file scope, worktrees, integration worker; 2-worker cap on this hardware |
| Runaway cost or time | Medium | Medium | Hard caps on workers, retries, wall time; no recursive delegation (workers cannot spawn workers) |
| State corruption on interruption | Medium | High | Atomic writes, checkpoint per transition, resume tests |
| Prompt injection via PRD, web, or repo content | Medium | High | Workers treat file contents as data; restricted actions gated in code regardless of what text says |
| PHI or secrets leaking into repo, logs, telemetry, or AI provider | Low–Medium | Very high | Synthetic data only, secret scanning in the runner, env-var-only credentials, AI disabled by default, redaction tests |
| False booking confirmation in product | Medium | Very high | Release-gate test: UI success state reachable only from authoritative booking response; timeout-then-reconcile test |
| Duplicate bookings | Medium | Very high | Idempotency-key contract tests; double-click and retry E2E tests |
| Tenant data leakage | Medium | Very high | Tenant-scoped data access layer, cross-tenant regression suite as a required gate |
| Mockup treated as real data or design | Medium | Medium | Mockup names, ratings, insurance labels are illustrative; excluded from fixtures that look real |
| Overstating compliance | Low | High | Docs never claim HIPAA compliance; legal/compliance decision recorded as open |
| Figma deliverable promised but impossible | High | Low | Flagged now; specs only |

## 8. What I need from you to start Milestone 2

1. **Repository:** connect the existing monorepo folder (Add folder in the desktop app), or approve creating a new one (`booking-platform`). I will not guess.
2. **Approve or amend** the default assumptions in §4, especially mock scheduling service, guest booking, and AI disabled by default.
3. **Confirm the layout and the TypeScript/pnpm choice** (matches the Node/pnpm/Playwright tools already present).
4. **Remote/CI:** if you want CI evidence, say which GitHub repo; credentials stay with you in local config, not chat.

Nothing in this milestone merged, pushed, deployed, connected an account, or touched credentials.
