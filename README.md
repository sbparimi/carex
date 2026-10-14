# CareX

White-label, multi-tenant patient appointment booking (PRD v0.2 in `docs/prd/`), built with an autonomous engineering harness (`harness/`).

- Harness docs and milestone evidence: `docs/harness/`
- Run harness tests: `npm install && npm run harness:test`
- Product code lives in `apps/` (API with CareX-native scheduling engine on PostgreSQL (Neon, or in-process PGlite locally) with patient accounts, patient web UI) and `packages/` (contracts)
- Decisions: `docs/product/` (ADR-002 scheduling, ADR-003 (superseded), ADR-004 admin API, ADR-005 accounts and Postgres)
- Harness live run evidence: `docs/harness/07-live-run.md`

The harness is separate from the product runtime: nothing under `apps/` or `packages/` may import from `harness/`.

## Product slice
See [docs/product-traceability.md](docs/product-traceability.md) for what the booking slice covers, the evidence for each requirement, and what is not built yet.

## Run locally and on Neon
- Local (no database server): `CAREX_SEED_SYNTHETIC=1 npm start`, open `http://127.0.0.1:8080/t/northwind-health/`, sign up. Password reset links print in the server console in this mode.
- Neon: put your Neon connection string in a local `.env` as `DATABASE_URL` (never commit or share it), set `CAREX_SECURE_COOKIES=1` behind HTTPS, then `npm start`.
- Admin key for a tenant: `npm run admin:key -- <tenant-slug> "<label>"`.
