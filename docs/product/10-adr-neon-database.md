# ADR-010: Neon is the only CareX database platform

- Status: Accepted for this implementation
- Date: 2026-11-19

## Decision

CareX uses Neon as its only supported database platform. The application requires `DATABASE_URL` to contain a Neon endpoint under `.neon.tech`. The database adapter uses `psycopg` because Neon exposes the PostgreSQL wire protocol.

There is no SQLite mode, local database file, generic self-managed PostgreSQL target, or automatic fallback when configuration is missing.

## Runtime configuration

- Set `DATABASE_URL` to the Neon pooled connection string for the target environment.
- Use the pooled endpoint for the Vercel/serverless runtime.
- Keep development, test, preview and production data in separate Neon branches.
- Never run the test suite against production. Test fixtures truncate application tables between tests.
- Keep credentials in environment variables or the deployment platform's secret store. Do not commit connection strings.

## Schema management

CareX applies append-only migrations at startup. The migration runner uses a transaction-scoped advisory lock to prevent concurrent serverless instances from applying the same migration simultaneously.

An existing database with unrelated CareX tables but no CareX migration history is rejected. A new environment should start from a dedicated empty Neon branch. No production data migration is implied by this decision.

## Testing and CI

Integration tests require `CAREX_TEST_DATABASE_URL`, which must point to a dedicated Neon test branch. GitHub Actions reads this value from the `NEON_TEST_DATABASE_URL` repository secret. If the secret is absent, database integration tests are explicitly skipped; Python compilation still runs. Configure the secret before treating CI as a complete validation signal.

## Consequences

- Neon is the single source of persistence across local development, preview and production.
- Local setup requires a Neon project and network access.
- Tests no longer create ephemeral SQLite databases or use a self-hosted PostgreSQL service.
- PostgreSQL remains the database engine/protocol underneath Neon; Neon is the managed database platform.
