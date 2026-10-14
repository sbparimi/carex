# CareX

White-label, multi-tenant patient appointment booking (PRD v0.2 in `docs/prd/`), built with an autonomous engineering harness (`harness/`).

- Harness docs and milestone evidence: `docs/harness/`
- Run harness tests: `npm install && npm run harness:test`
- Product code lives in `apps/` and `packages/` (not yet started)

The harness is separate from the product runtime: nothing under `apps/` or `packages/` may import from `harness/`.

## Product slice
See [docs/product-traceability.md](docs/product-traceability.md) for what the booking slice covers, the evidence for each requirement, and what is not built yet.
