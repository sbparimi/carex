# Milestone 2 — Task contracts and durable state model

Status: implemented locally; 15 automated tests pass; typecheck clean (run 2026-10-14).

## What exists
- `harness/src/schemas.ts` — zod schemas: Task (with required checks, scope, budget), WorkerResult, Evidence, Approval, State.
- `harness/src/dag.ts` — dependency validation (unknown dependency, self-dependency, cycles).
- `harness/src/store.ts` — `StateStore`: atomic checkpointing (validate, write temp, rename), legal status transitions, retry budget, approvals.
- `harness/test/store.test.ts` — 15 tests.

## Rules enforced in code (not in prompts)
1. `done` is unreachable through `transition()`. Only `markDone()` sets it, and only if every required check has runner-written evidence whose exit code matches. A later failing run revokes earlier passing evidence.
2. A worker result of "completed" only moves the task to `needs_review`. Worker output is advisory.
3. Evidence is accepted only with `recordedBy: "runner"` and only for a check the task declared.
4. A task cannot become `ready` while any dependency is not `done`.
5. Retries are bounded by the task budget; after that the only exit is `escalated`.
6. Restricted actions are denied unless a human-granted approval exists (fail closed).
7. A corrupt or cyclic state file is refused on load rather than repaired by guesswork.
8. Every transition is checkpointed to disk and logged, so a new session can resume from the repo.

## Known limitations (carried into later milestones)
- `recordedBy: "runner"` is a convention inside the store API. Nothing yet stops a worker with shell access from editing `harness/state/*.json` directly. M4/M6 must add file-scope enforcement and a state-file integrity check (e.g. hash chain or write-protection) before this is trustworthy.
- No runner exists yet, so evidence is only created by tests. The runner is Milestone 5.
- No scheduler, no worker dispatch, no worktree isolation (Milestones 3–4).
- Defaults from the capability assessment (mock scheduling service, guest booking, AI off by default, synthetic data, WCAG 2.2 AA) are assumed, not yet approved.
- Used npm instead of pnpm because pnpm is not installed on the local shell.
