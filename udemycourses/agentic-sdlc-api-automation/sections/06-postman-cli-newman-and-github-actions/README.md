# Section 06 — Postman CLI and GitHub Actions (with Newman migration context)

**Planned section:** 06 of 08  
**Lessons:** 5  
**Status:** Production in progress

## Learning outcome
Run the same reviewed Postman collection locally and in GitHub Actions using Postman CLI, interpret retained run evidence and protect credentials and non-production environments.

## Lessons
- [ ] 6.1 — Collection execution options and tool roles
- [ ] 6.2 — Run Postman CLI locally and interpret reports
- [ ] 6.3 — Newman legacy compatibility and migration to Postman CLI
- [ ] 6.4 — Build a GitHub Actions pipeline
- [ ] 6.5 — Protect secrets, artefacts and write-enabled environments

## Tool hierarchy
- **Primary:** Postman CLI for new course workflows and CI execution.
- **CI orchestration:** GitHub Actions.
- **Legacy comparison:** Newman only to explain existing v2.1 collection estates and migration decisions. Do not teach Newman as an equal or preferred new-project runner. Verify compatibility with the exact collection format before claiming it works.
- **Agentic workflow:** Postman Agent Mode proposes or updates work; reviewed collection files are committed; CI executes the approved collection.

Postman CLI capabilities, authentication constraints, supported collection formats and plan dependencies must be checked against current official documentation at recording time. Do not assume cloud result upload or API-key authentication works identically across regions.
