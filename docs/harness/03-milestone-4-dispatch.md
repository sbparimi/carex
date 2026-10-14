# Milestone 4 — Specialist dispatch and isolated execution

Status: implemented locally; 38 tests pass (15 + 13 + 10); typecheck clean (2026-10-14).

## What exists
- `harness/roles/*.md` — 11 role definitions (product, ux, architect, frontend, backend, ai, security, qa, sre, reviewer, integration).
- `harness/src/worktree.ts` — one git worktree and branch (`task/<id>`) per task; changed paths read from git; scope check; protected paths; commit to the task branch.
- `harness/src/dispatch.ts` — `buildWorkerPrompt` (the worker contract), `worktreeWorker` (runs an agent in the worktree, then judges the result from git), `claudeCliAgent` (headless Claude CLI adapter).
- `harness/src/glob.ts` — glob matching for scopes.

## Behaviour proven by tests (real git repos in temp dirs)
- Work happens in a separate worktree; the main checkout and `main` are untouched. Two concurrent tasks cannot see each other's files.
- Changed files come from `git status`, not from the agent's report; a mismatch is recorded as a risk.
- Changes outside the task's write scope fail the task, even if a verifier would have passed.
- Protected paths (`harness/state/**`, `docs/prd/**`, `.git`, CI workflows, `.env*`) are rejected even when the task scope is `**`.
- Deletions, renames and new `.env` files are detected.
- Malformed agent output is a failed attempt, not a crash.
- Worktrees are reused on resume.
- The worker prompt carries scope, requirements, forbidden actions, required checks, "do not delegate" and "do not edit tests to pass".

## Known limitations
- `claudeCliAgent` has NOT been run against the real Claude CLI. It needs an authenticated install and spends usage. Flag: the `-p`, `--output-format` and `--disallowedTools Agent` arguments should be confirmed against the installed CLI version before first use.
- Scope is enforced after the fact (from git). A worker with a shell could still read or write outside its worktree on disk; real prevention needs OS-level sandboxing or per-worker permission rules. The harness state file lives outside the worktree and a worker is not given its path, but this is not a hard guarantee.
- Task branches are committed, not merged. Merging is Milestone 5/6 (integration worker plus approval gate for anything touching main).
- Worktree cleanup is not implemented: removing a worktree deletes files, and deletion in your Documents folder is not currently permitted. `.worktrees/` is git-ignored.
- Per-task `maxMinutes` is enforced only inside `claudeCliAgent`.
- Test tampering (deleting or skipping tests to get green) is not yet detected; that is Milestone 5.
