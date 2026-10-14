# Live dogfood run: harness building CareX phase 2

The deterministic harness ran real Claude CLI workers (one git worktree per task, scope enforced from git, "done" computed from runner-written evidence) to build parts of the CareX scheduling engine.

| Task | Result | Retries | Evidence records |
|---|---|---|---|
| T-p2-ratelimit | done | 0 | 2 |
| T-p2-zoned | done | 0 | 2 |
| T-p2-catalog | worker reported blocked; see finding 3 | 0 | 0 |
| T-p2-sched | done | 0 | 2 |
| T-p2-token | done | 0 | 2 |
| T-p2-manage | done | 0 | 2 |

I (the integrator) wrote the owner specs (tests) and ADRs, the workers wrote the implementation, and I merged verified task branches locally. The admin configuration API (ADR-004) was **written directly, not through the harness**, after the earlier tasks showed what the harness costs per task; it has its own specs and tests.

## Findings
1. **Worker permissions.** Headless workers stalled on file writes. Fix: a per-task, git-excluded `.claude/settings.local.json` with root-anchored `Edit(/path)`/`Write(/path)` rules and a PreToolUse hook. The cloud CLI wrapper accepts only plain `claude -p`, so flags were replaced by the policy file.
2. **Silent test discovery loss.** A root vitest config stopped the harness's own tests being discovered; added `harness/vitest.config.ts`.
3. **Honest blocked reports.** Twice a worker reported it could not finish rather than faking success (the T-p2-catalog block was caused by my tooling; the work was completed and merged after the fix, but the state file still says `blocked`).
4. **Spec bugs caught by workers.** Rate-limit retry-after expectation (49_999 vs 49_000) and catalog ordering (physio before primary care) were wrong in my specs; workers flagged them.
5. **Known gap.** Dependent tasks do not branch from merged upstream work; the integrator must merge first.
6. **Not proven.** One worker per task, sequential, small scope. Parallel workers, large tasks and failure recovery at scale are untested.
