# CareX

White-label, multi-tenant patient appointment booking (PRD v0.2 in `docs/prd/`), built with an autonomous engineering harness (`harness/`).

- Harness docs and milestone evidence: `docs/harness/`
- Run harness tests: `npm install && npm run harness:test`
- Product code lives in `apps/` (API with CareX-native scheduling engine on SQLite, patient web UI) and `packages/` (contracts)
- Decisions: `docs/product/` (ADR-002 scheduling, ADR-003 guest links and optional login, ADR-004 admin API)
- Harness live run evidence: `docs/harness/07-live-run.md`

The harness is separate from the product runtime: nothing under `apps/` or `packages/` may import from `harness/`.

## Product slice
See [docs/product-traceability.md](docs/product-traceability.md) for what the booking slice covers, the evidence for each requirement, and what is not built yet.
