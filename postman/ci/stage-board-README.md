# CareX four-stage views

The course branch has two workflows, with no change to main or repository settings:

1. `ci.yml`, Start CareX staged course pipeline, is the safe manual entry. Choose the course branch, confirm the current included storage allowance and choose expected health 200. It performs scope/allowance checks and requests one automatic execution.
2. The course branch's `dispatch.yml`, CareX staged course pipeline, contains exactly four real jobs: Develop -> Build -> Test -> Deploy. All checks and the protected approval belong to that execution run. It does not call the production reminder endpoint or receive production reminder credentials.

The automatic execution uses the built-in Actions identity. This is necessary because the existing course-isolated-lab protection prevents the initiator from approving their own run, and sbparimi is its sole reviewer. There is no new human start between launch and execution. No rule is disabled. Main's existing dispatch workflow and schedule are unchanged.

## Inside GitHub

The actual execution run has four native job boxes with real dependency edges. Open a job for its native steps and logs. The environment review before Deploy is GitHub's actual protection, not a simulated pause.

Each job also writes a four-column HTML table to its native job summary, using actual job/step API results. It is a timestamped snapshot. The current job can still be finishing when it is written; the live graph is authoritative. Refreshing the page does not regenerate a completed summary. Native GitHub styling and controls apply. This cannot reproduce a custom dashboard's CSS, live controls or simultaneous expandable stage lanes exactly. Mermaid rendering is not assumed.

## Optional standalone live board

Open `viewer.html` locally, or serve this directory with a local static server. It reads anonymous GitHub data. It has no credential, write API, storage, analytics, third-party script or external stylesheet.

- It follows the latest actual pipeline execution, not the small launch stub.
- New executions show the protected Deploy job in the same run. Their Test stage must include a passed mandatory Gate step before the board can show Test success.
- Historical two-run checkpoints remain supported. Run133/134 has an independently checked fixed binding. Later legacy promotions must name their exact parent, branch, workflow and source and use the built-in actor.
- Missing, ambiguous, skipped, failed, unknown and stale evidence never becomes a green pass.
- Run, Review and Cancel entries open native GitHub controls. They do not perform those operations.

The board checks every ten minutes while visible. Manual checks have a thirty-second minimum. Anonymous REST calls share the public per-IP allowance. Automatic checks stop on 403/429. There is no promise of real-time updates, unlimited service allowances or permanent hosting.

## Safety and evidence

All four execution jobs use read-only GitHub permissions. Only the launcher has the write permission needed for its exact course-workflow dispatch. The helper rejects deployment-review, settings, other-workflow, other-branch and merge writes.

Original candidate bytes and source binding are checked before the lab API starts. Develop, Build and Test must have succeeded in that same execution. Existing minimum test size, zero unexpected skips/errors/failures, application coverage, changed executable coverage, real Postman assertions, exact expiring Neon binding, synthetic data, credential exclusions, artifact limits and cleanup remain mandatory.

The lab API exists only during its runner job and stops after real smoke checks. It is not a persistent staging endpoint. Staging and production are dry-run designs only. Account-wide storage, billing and separately started AI-session limits are disclosed separately; repository checks do not prove them.

Offline checks, which do not call an API or database:

```sh
node --test postman/ci/test-viewer.cjs
python -m pytest postman/ci/test_pipeline.py -q
```

Run them from the repository root with the course's pinned tools. Offline fixture results are not release evidence. A fresh native run and visual inspection are required after changing the workflow.
