# ADR-009: Python-only stack

**Status:** accepted. **Supersedes:** the TypeScript/Node implementation (ADR-005 and ADR-007 describe behaviour that is preserved; their Node-specific details no longer apply).

## Decision
The whole product is rewritten in Python: FastAPI with server-rendered Jinja pages and plain HTML forms. There is no JavaScript and no npm. The database layer supports SQLite (local, file) and Postgres (Neon online) from the same code, chosen by `DATABASE_URL`.

## Why
The owner could not run the Node toolchain and wants one language and `pip` only.

## Consequences
- Pages work without JavaScript, so the CSP is `default-src 'none'` with no script source. Booking is a sequence of form posts; the server holds all state.
- Same rules as before: DB is source of truth for idempotency, per-provider writer lock, double-booking impossible (proved with an 8-thread race on Postgres).
- Password-reset links now carry the token as `?token=` (with `Referrer-Policy: same-origin`) instead of a URL fragment, because there is no script to read a fragment.
- CSRF defence is SameSite cookies plus a Fetch-Metadata/Origin check on every state-changing request.
- Database migrations are tracked in `carex_migrations`. An existing Postgres database from the TypeScript version is refused; start from an empty one.
- Rate limits are in memory per instance (unchanged limitation).
