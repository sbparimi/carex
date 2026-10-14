# Milestone 8 — Harness acceptance test

Result: PASSED on 2026-10-14. Full suite 63/63 tests; typecheck clean. Evidence: `05-acceptance-report.md` (generated from the persisted state of the run by `harness/test/acceptance.test.ts`).

## What the test does (master directive §5)
1. Plans three tasks with dependencies: T-spec (product) -> T-impl (backend, high-risk) -> T-ship (SRE). Feature: FR-003 clinic filtering by state and tenant; owner-approved acceptance tests are in the base commit.
2. The backend worker's first attempt contains a deliberate tenant-leak defect. The real command runner runs `node --test`; 3 of 4 tests fail with real output ("leaked clinic c4 from tenant t2").
3. The failure is classified `code_or_test` and stored as a diagnosis; the process then crashes right after that checkpoint is saved.
4. A new process resumes from disk. T-spec is not redone. The stranded T-impl is re-verified (a second real failure), retried with the diagnosis in its prompt, fixed, re-run (4/4 pass), and approved by an independent security review.
5. T-ship tries `git push origin main` through the approval gate. It is denied, an approval request is recorded, the task blocks, and the stand-in push marker file does not exist. After the owner grants the approval, the task is re-queued, is allowed, and completes.
6. Final assertions: the failing run stays on the record, main never moved, acceptance tests were not modified, every task is done, the report quotes the real output.

## Honest scope of this evidence
- Workers are scripted agents, not live Claude. This proves the harness (state, worktrees, scope, runner, evidence, diagnosis, review, approvals, resume), not the quality of real model output.
- The prohibited action is exercised through `guardCommand`. The Claude Code hook (`harness/hooks/pretooluse.mjs`) is tested as a subprocess but has not been run inside a live Claude session.
- The real `git push` is never executed; a marker file stands in for it.

## Before the harness drives live Claude workers
1. Run `claudeCliAgent` once against the installed Claude CLI and confirm its flags and its JSON-result convention.
2. Wire the hook into the worker invocation (for example a settings file passed to the worker, with `HARNESS_STATE` and `HARNESS_TASK_ID` set). It is deliberately not placed in the repo's own `.claude/settings.json`, because that would also restrict your interactive sessions.
3. Decide how task branches are merged (integration worker plus a `merge_to_main` approval).
