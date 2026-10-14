# Milestone 3 — Dependency-aware orchestrator

Status: implemented locally; 28 tests pass (15 state + 13 orchestrator); typecheck clean (2026-10-14).

## What exists
- `harness/src/scheduler.ts` — `promoteReady` (pending -> ready only when all dependencies are done), `selectDispatchable` (concurrency cap + write-scope conflict avoidance), `recoverInterrupted` (crash recovery).
- `harness/src/scope.ts` — conservative write-glob overlap test (static-prefix containment).
- `harness/src/orchestrator.ts` — `tick()` and `run()`: promote, dispatch, collect worker result, verify, close or retry/escalate. Workers, and the verifier, are injected functions.

## Behaviour proven by tests
- A task never starts before its dependencies are done, even with spare capacity.
- At most `maxConcurrent` tasks run (default 2); tasks with overlapping write scope never run together; independent tasks do run in parallel.
- A worker's "completed" claim is rejected when verification fails or returns no evidence. The task is retried up to its budget, then escalated.
- A throwing worker, or one answering for the wrong task, is a failed attempt; independent tasks continue.
- Dependents of an escalated task stay pending; the run reports `stalled` with the exact blocked/escalated ids.
- `run()` stops at a tick cap rather than looping forever.
- Kill and resume: after a simulated crash, a new process reloads the state, finished tasks are not re-run, the interrupted task is re-queued (spending one retry) or escalated if its budget is spent.

## Known limitations
- Workers and verifier are test doubles. No real Claude subagent dispatch (Milestone 4) and no real command runner producing evidence (Milestone 5).
- Scope overlap is by static glob prefix, so it can over-block (safe) but is not a filesystem-level guarantee. Enforcement that a worker actually stayed in scope is Milestone 4.
- The task `maxMinutes` budget is recorded but not yet enforced (needs the real dispatcher).
- Interrupted-task recovery spends a retry even if the crash was not the task's fault. This is deliberate: it keeps the bound simple.
- State files can still be edited directly by anything with shell access (see Milestone 2 limitations).
