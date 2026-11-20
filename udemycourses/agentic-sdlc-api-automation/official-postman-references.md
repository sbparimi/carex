# Official Postman references for course production

Use these official references when updating course instructions and recording demonstrations. Recheck them immediately before recording because Postman features, CLI commands, plans and account requirements change.

## Postman AI and Agent Mode
- [About Postman AI features](https://learning.postman.com/docs/getting-started/basics/about-ai) — AI features and Agent Mode.
- [Agent Mode overview](https://learning.postman.com/docs/use/agent-mode/overview) — supported Agent Mode tasks and workflows.
- [Enable AI features](https://learning.postman.com/docs/getting-started/installation/settings/ai-settings) — AI consent and configuration.

## Postman CLI
- [Postman CLI overview](https://learning.postman.com/docs/postman-cli/postman-cli-overview) — install and core CLI commands.
- [Run a collection using the Postman CLI](https://learning.postman.com/docs/postman-cli/postman-cli-run-collection) — local execution, reports and CI use.
- [Postman CLI collection commands](https://learning.postman.com/docs/postman-cli/postman-cli-collections) — collection run, import and migration commands.
- [Run Postman CLI in GitHub Actions](https://learning.postman.com/docs/postman-cli/postman-cli-github-actions) — supported GitHub Actions patterns.
- [Postman CLI troubleshooting and FAQ](https://learning.postman.com/latest-v-12/docs/postman-cli/postman-cli-troubleshooting) — including Newman compatibility and regional authentication caveats.

## Course accuracy rules
- Do not claim Agent Mode is available on every account or plan. Check the current feature access and AI consent requirements.
- Do not require a Postman API key if a local CLI run does not need one.
- Do not teach Postman CLI OAuth 2.0 support as available; current documentation lists an OAuth 2.0 limitation.
- Do not use Newman as the primary runner for new Postman v12 workflows. Teach legacy migration only, and validate compatibility with the actual collection format.
- Do not claim CI uploads results to Postman Cloud unless the authentication, region and collection-linking conditions are demonstrated.
- Do not record commands from memory. Use the current official docs and capture the actual successful terminal output.
