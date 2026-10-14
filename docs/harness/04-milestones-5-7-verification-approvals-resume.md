# Milestones 5–7 — Verification, remediation, approvals, budgets, resume

Status: implemented locally; 62 tests pass; typecheck clean (2026-10-14).

## Milestone 5 — Independent verification and remediation
- `runner.ts`: executes each required check in the task's worktree; records real exit code, output hash and output tail as evidence (`recordedBy: "runner"`). Timeouts give exit 124. Restricted commands are refused (exit 126).
- `tamper.ts`: compares the worktree to the base commit. Deleted test files, newly skipped/focused tests and reduced assertion counts fail every check with `harness tamper-check` evidence. Adding tests is allowed.
- `classify.ts`: classifies failed output (code_or_test, configuration, infrastructure, external_dependency, timeout, policy, unknown). Infrastructure, external and policy failures are not retried; they escalate.
- Repair: a failed verification stores a `Diagnosis` on the task (category, guidance, reproduce command, output tail). The next attempt's prompt includes it with "smallest fix, never weaken tests". Retries stay bounded by the task budget. Each new attempt discards earlier evidence so old passes cannot complete it.
- Review gate: `highRisk` tasks cannot be done without a passing verdict from a reviewer whose role differs from the author's.

## Milestone 6 — Budgets, approvals, observability
- Budgets: `maxConcurrent`, per-task retries and minutes, run-level `maxDispatches` and `maxWallMs`; the run reports `budget_exhausted`.
- `policy.mjs`: shared pattern list for restricted commands (push, merge to main, deploy/publish, destructive infra and git, pipe-to-shell, credential reads, authentication, account connection).
- `guard.ts`: `guardCommand` denies restricted commands and records one approval request; only a human `decideApproval("granted")` allows them, scoped to the task.
- `hooks/pretooluse.mjs`: Claude Code PreToolUse hook for real workers. Blocks restricted Bash commands, writes to protected paths and reads of credential files (exit 2), writes an approval request file, and fails closed on unreadable input. Not yet wired into a `.claude/settings.json` for a live run.
- `addTask` rejects tasks whose required checks use restricted commands.
- `report.ts`: markdown report generated only from recorded state, quoting real failure output.

## Milestone 7 — Resume and recovery
- `resume.test.ts` crashes the run at every checkpoint (both before and after the write, plus a torn temp file) and resumes. Every case completes, finished tasks are not re-run, and no task exceeds its attempts.
- This found and fixed a real bug: a crash between "result saved" and "verification done" left a task stuck in `needs_review`. A resumed run now re-verifies such tasks and re-queues tasks left in `failed`.

## Known limitations
- The Claude Code hook and `claudeCliAgent` have not been run against a live Claude session.
- Credential-read patterns are deliberately broad (they also match `process.env` in a command and `.env.example`): fail closed over precise.
- Tamper detection is text-based (skip/only markers and `expect(`/`assert` counts). It will not catch a test rewritten to assert something trivially true; the independent reviewer gate is the control for that.
- Failure classification is heuristic regexes over output.
- The runner base commit is the main checkout's HEAD at verification time; it assumes main does not move during a run.
- State file integrity against a worker with unrestricted shell access is still unsolved beyond the hook and worktree separation.
