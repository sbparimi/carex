# Environment setup guide — learner edition

**Status:** Draft; clean-machine walkthrough required before release.

## Core learner tools
- Current supported Postman app
- Postman Agent Mode access, subject to account, plan and AI consent requirements
- Git and a supported browser/terminal
- Postman CLI for command-line and CI lessons
- GitHub account for CI lessons

Python is **not** a core learner prerequisite. The course teaches Agentic SDLC for API automation through Postman Agent Mode, Postman collections, Postman CLI and GitHub Actions. Do not require learners to build a separate Python testing or orchestration framework.

## Optional tooling
- Node.js only if using the npm installation route for Postman CLI or an explicitly identified optional utility. Follow current Postman installation documentation.
- Newman is limited to legacy compatibility/migration context; it is not the primary runner for new Postman v12 workflows.

## Setup
1. Install Postman and record the app version.
2. Verify Agent Mode access, enable AI features where permitted and review Postman's AI terms.
3. Import the CareX learner collection and environment.
4. Verify `baseUrl` and tenant point to a non-production course instance.
5. Run the read-only health request and one read-only discovery request.
6. Install Postman CLI using the current official instructions before Section 6.
7. Use a training GitHub repository for CI lessons; do not connect production repositories or credentials.

## CareX and database safety
CareX is the API under test. Its implementation uses FastAPI and Neon/PostgreSQL; learners are not expected to write Python. Use a dedicated development or disposable test database branch. Never seed or run destructive tests against production. Never include real database credentials in course assets. Do not imply SQLite support.

## Secret and environment safety
- Keep secrets in Postman Vault or local secret fields where supported.
- Never export secrets into course files, screenshots or logs.
- Keep writes disabled until the target environment is verified.
- Use synthetic accounts/data only.
- Never run write-enabled collections against a shared preview/production database.

## Verification checklist
- [ ] Postman app launches and collection imports.
- [ ] Agent Mode access and consent requirements are understood.
- [ ] Learner can submit the supplied prompt and inspect Agent Mode output.
- [ ] Learner can paste JSON output into the `agentProposal` collection variable.
- [ ] Postman assertions execute and show results.
- [ ] Base URL is non-production.
- [ ] Read-only health request succeeds.
- [ ] Postman CLI installs before Section 6.
- [ ] No secrets appear in files, screenshots or logs.

Do not mark setup complete until a clean-machine walkthrough passes.
