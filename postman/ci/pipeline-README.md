# CareX staged course pipeline

Course branch only. Standard GitHub-hosted Ubuntu runners in this public repository. No merge, public course release, paid service, persistent staging deployment or production operation is authorized by this workflow.

## What actually runs

1. **Scope and cost preflight.** Exact repository/branch and an explicit current account-storage check. Repository artifacts are limited to a 100 MB envelope including a 25 MB reserve; cache use must leave 500 MB within the 10 GB included cache envelope. The account-wide check is manual because repository artifact inventory is not the account bill. Stop rather than purchase capacity.
2. **Develop.** A reusable workflow runs lint, security and offline safety controls, using a Python 3.11/3.12 matrix. It never receives the database secret. Application fatal-error checks and strict formatting/lint on newly added pipeline/boundary-test code block. Existing whole-application style debt is published separately, not called clean. A bulk legacy reformat is not disguised as a CI change.
3. **Build once.** `git archive` packages the exact committed application, tests and course controls. The original TAR, SHA-256 release manifest and dependency inventory are retained. The manifest is unsigned, not a signed supply-chain attestation.
4. **Test.** Download and verify those bytes. Run the complete application pytest suite on the extracted candidate against the exact guarded, disposable Neon branch. Test fixtures prepare synthetic data and isolate test cases. Separately reset/seed the synthetic catalog, start the packaged API, run the real pinned Postman CLI contract collection, and stop the process. The connection is passed only through environment variables. API startup output is captured privately and not published; pytest output is redacted before publication. Delivery tokens and messaging credentials are not inherited by application subprocesses.
5. **Gate.** Require the real suite size, unique actual JUnit test cases, zero failures/errors/unexpected skips, at least 80% application line coverage and 90% changed executable application lines. Changed-line scope is `carex/` and `api/` since the recorded baseline. No changed executable application lines means not applicable, not 100% measured coverage. Missing reports and scanner errors block. No known dependency advisory or high-severity static finding may pass; no unreviewed secret finding may pass.
6. **Promotion design.** Native matrix jobs clearly marked DRY RUN ONLY describe staging/production preparation, test, threshold, approval, deploy and recovery contracts. They access no target, secret or existing environment and do not deploy.
7. **Request approval.** A narrowly scoped job uses the built-in repository Actions identity to dispatch this same registered workflow in `promote-lab` mode. It cannot recursively dispatch. The promotion must reference a successful parent at the exact commit and branch and must consume the original candidate/gate artifacts. Direct human dispatch of promotion mode is rejected.
8. **Approve and deploy.** The new `course-isolated-lab` environment requires reviewer `sbparimi`, prevents self-review, disables administrator bypass and allows only the exact course branch. The actual downstream actor and review must be inspected in Actions before claiming identity separation. Automation never approves. After the owner approves, start the original packaged API, verify native smoke evidence, retain the release record and stop the temporary process. This is a runner-lifetime lab deployment, not a persistent endpoint.

## Real baseline findings, not a fabricated green demo

The starting 143-case regression run produced 141 passes and two failures. Its true application line coverage was 79.760289%, although the display rounded to 80%. Both failures came from an outdated erasure test double missing the real PostgreSQL connection's `for_update` property. The fixture was corrected without removing production row locking or weakening the assertions. Twelve missing privacy, audit and environment-file boundary cases were added. The two repaired cases and twelve new cases passed in targeted runs; combined local diagnostic coverage reached 80.099502%. Only a fresh complete workflow run is acceptable release evidence. The current collected application suite is 155 cases.

The secret scanner has one reviewed, exact path-and-value allowlist for the public, non-live cron fixture in `tests/test_ops.py`. It does not exclude the file or other credentials. Medium/low static findings and legacy style debt remain visible.

## Run and inspect in the native UI

Open the registered CI workflow, choose the course branch, select `pipeline`, verify current included storage, then set `free_storage_confirmed`. Set health expectation `200` for a normal run or `201` to demonstrate a genuine blocking assertion. Request lab deployment only when a native review is intended. Do not impersonate the reviewer or bypass the environment rule.

The failure/fix exercise must show different real run IDs and native results. A failed Test job must leave Gate and promotion skipped. A successful fixed run must use the same source revision and verified candidate bytes. Inspect the matrix, dependencies, cache hit/miss, native reports, summaries, annotations, artifact hashes, waiting approval state and release record.

Do not say the 41-request training collection has run: the Postman collection used here remains a four-request/six-assertion contract smoke. Broader regression coverage comes from the complete pytest suite. Extending the learner Postman journeys is separate work, not a reason to relabel six assertions as full API coverage.

## Recovery and limits

The exact host/database/expiry guard runs before any intentional lab reset. Never use production/shared data or substitute SQLite. All API processes have shutdown handling; runner teardown is a final boundary. An interrupted test may leave synthetic fixtures, which the next guarded preparation resets. No long-lived service is switched, and destructive database migrations are not described as automatically reversible. Persistent targets, credentials, rollback routes and costs require separate approval. The lab expires on the timestamp in `lab.json`; an expired binding blocks all database work.
