# CareX stage board, practical start

1. Download `viewer.html` and open it in a browser with internet access. No installation, token or account connection is needed. It reads anonymous public GitHub data. If your browser blocks file-origin fetches, run `python -m http.server 8741 --bind 127.0.0.1` from this directory and open `http://127.0.0.1:8741/viewer.html`.
2. The board follows the latest course parent automatically and discovers its source-bound promotion. To inspect older evidence, enter its parent ID and choose Pin this run. Choose Follow latest parent to return. The independently checked historical pair is runs 133/134, not a new deployment or invented sample data.
3. Expand a job to inspect its vertical steps, real conclusion, elapsed time and native log link. Use Expand all steps to inspect the whole chain. Public GitHub may require sign-in to read full logs.
4. Open Run workflow. In GitHub select the existing course branch, mode `pipeline`, expected health `200`, and confirm the account's included artifact allowance. Leave the automatic lab-promotion request enabled. Run only inside the current verified zero-spend and lab-expiry envelope.
5. The board selects the latest parent from the latest thirty course workflow runs. Pin a known parent if this bounded list has no match or an ambiguous timestamp. Newly titled promotion runs explicitly include that parent ID; the board also checks repository, workflow, branch, commit and built-in initiating actor. It does not guess a child from a shared commit. Ambiguous, incomplete or missing results remain unverified.
6. After the gates pass, the pipeline requests promotion automatically. When GitHub is waiting, Open human review opens the real run. The actual human selects `course-isolated-lab` and approves or rejects in GitHub. The board never submits a review.
7. After actual approval, the native job installs the identical dependencies, verifies the original candidate, starts the temporary lab API, runs smoke checks, retains evidence and stops the API. Pause lesson recording during the wait. Resume on the same run and verify success before advancing.
8. Open run to cancel opens the active native run. Cancellation is not rollback. A completed run cannot be cancelled from this board.

## Limits that stay visible

- The board is read-only. Only anonymous GET requests to api.github.com are used; credentials are omitted. No token, browser storage, analytics, write API, extension or new hosted service.
- Auto refresh is every ten minutes while visible. Manual refresh has a thirty-second minimum gap. Anonymous public API reads share sixty requests per hour per IP, across users and other applications. Rate-limit/access refusal stops automatic checks. Existing data is explicitly stale on read failure; it is not new success evidence.
- The execution pipeline is automatic after the manual start, including the promotion request and post-approval checks. The native human gate remains a real decision.
- Postman Agent Mode and browser Copilot author/review are separately started, reviewed sessions, not unattended CI model calls. Their credits and consent are not queried or reset by this workflow. Stop those sessions on quota or authentication failure. Do not replace them with a script while calling it an agent result.
- Standard public runners do not imply unlimited storage, model credits or permanent database hosting. Account-wide included storage confirmation remains separate from repository envelope checks.
- Staging and production are dry-run design jobs only. The actual lab API is runner-lifetime and stopped after verification.
- The bound Neon endpoint/database and expiry are checked before database access. Preflight additionally requires forty-five minutes of expiry headroom before starting. New secrets, settings, OAuth, branches, spending and main merge are outside this workflow's authority.

## Automated board checks

`node --test postman/ci/test-viewer.cjs` from the repository root checks status aggregation, source/child binding, ambiguous matches, unsafe URLs, skipped/missing lab jobs and the read-only credential boundary. The workflow runs these checks after its pinned Node setup.

## Lesson production

Teach each real setup, trigger, review and result action on screen, one action at a time. No theory segment. Use VS Code for source or report files. Use the actual GitHub Actions page for the human review. A design concept is not execution footage. Preserve run/source/candidate linkage across waiting cuts. Investigate a failed required job instead of advancing. Do not claim final learner acceptance from a local control test or a green-looking badge.
