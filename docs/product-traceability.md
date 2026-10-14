# CareX booking: requirement traceability

Status as of 2026-10-14. The system of record is the CareX-native scheduling engine on PostgreSQL (ADR-002, ADR-005); the mock source is gone from production code. "Evidence" names the automated test that exercises the requirement. Parts were built by live harness workers (`docs/harness/07-live-run.md`), the rest directly.

Test runs: 138 unit and API tests (vitest, 13 files), 67 harness tests, 63 browser runs (21 tests x Chromium at 1440, 768 and 390 px, axe WCAG A/AA, CSP-violation check). Browser suite runs in the cloud workspace only; the device has no browsers.

| Requirement | Status | Evidence |
|---|---|---|
| FR-001 tenant resolution, no fallback | Done | api.test "does not fall back when the tenant is unknown, suspended or malformed"; e2e "unknown, suspended or malformed tenant shows a safe page" |
| FR-002 states with bookable clinics only | Done | api.test "shows only states with an active, bookable clinic" |
| FR-003 clinic filtering by state and tenant | Done | api.test "lists only active clinics in the state for the tenant"; e2e "tenants are isolated and branded" |
| FR-004 visit types from clinic config; reset on clinic change | Done | api.test "offers only visit types switched on at that clinic"; selection.test; e2e "changing an upstream choice invalidates downstream choices" |
| FR-005 eligible providers only | Done | api.test "offers only active, eligible providers" |
| FR-006 slots only from the source; time zone shown; stale slot blocked | Done (real engine) | api.test "returns provisional slots only for an eligible provider"; e2e happy path (time zone), "slot taken before confirmation" |
| FR-007 review and edit | Done | e2e happy path, "changing an upstream choice..." |
| FR-008 confirm with idempotency, atomic revalidation, no false success | Done against the real engine | api.test "booking integrity" group (10 tests); e2e "double-clicking Confirm", "timeout after the booking was saved", "scheduling outage" |
| FR-009 refresh and session resilience | Partly | e2e "refresh resilience" (selection revalidated, forged slot dropped). Patient details are deliberately not persisted. Session expiry is not modelled. |
| FR-010 telemetry without PHI, per-tenant switch | Server-side events done | api.test "privacy: logs and telemetry". Client-side step events (state_selected etc.) are defined in the allowlist but not yet emitted by the UI. |
| BR-001 / BR-012 tenant isolation | Done at the data-access layer | api.test "tenant isolation and safe errors" |
| BR-002 branding | Partly | brand colour, display name with contrast guardrail (theme.test, e2e). Logo, favicon, typography tokens not implemented. |
| BR-006..BR-009 authoritative availability, explicit confirmation, no false success, recoverability | Done against the real engine | as FR-008 |
| BR-011 accessibility | Automated checks pass | axe WCAG 2.0 to 2.2 A/AA on every screen, keyboard flow, 320 px and 200 % text reflow. Manual screen-reader and keyboard review still required; no formal target approved. |
| §12 edge-state matrix | Mostly | no clinics, no providers, no slots, stale slot, timeout, integration outage, duplicate click, missing tenant, malformed tenant covered. "Clinic deactivated mid-flow" is handled by server revalidation but has no dedicated test. |

| Persistence | Done (validate on Neon) | db-catalog/db-scheduling tests (transactions, partial unique index prevents double booking; PGlite) |
| Accounts, login-required booking | Done | accounts, accounts-api, my-appointments-api tests; e2e sign up, login, reset, my appointments |
| Cancel and reschedule (account) | Done | db-manage.test, my-appointments-api.test, e2e my appointments |
| Rate limiting and hardening | Done | ratelimit.test, manage-api.test (429, headers, body limit); e2e strict-CSP check |
| Web deployment (Vercel + Neon) | Built, not deployed | deploy.test (handler, health, mailer); build:vercel; CI workflow |
| Admin configuration | API done, no UI | admin-keys.test, db-admin.test, admin-api.test |

## Not built yet (deliberately, or blocked on decisions)
- Optional patient login (ADR-003): design only; needs your approval and an email provider.
- Confirmation emails/SMS and calendar invites by delivery (link and .ics download exist).
- Admin UI; creating providers and visit types through the API; admin audit log.
- AI assistant features: excluded by owner decision.
- Real EHR adapter (the `SchedulingSource` seam exists); email provider for reset and confirmation mail.
- Encryption at rest, retention policy, HIPAA/legal review, formal accessibility target: human decisions. Appointments store patient name and contact; use synthetic data only until these are settled.
- Trusted-proxy handling for client IPs behind a load balancer (rate limiting uses the socket address).
- Multilingual UI, Figma deliverables, cross-browser matrix (Chromium only).

## Run it
- `npm install`, `npm run test`, `npm run harness:test`, `npm run test:e2e` (needs `npx playwright install chromium`)
- Dev: `CAREX_SEED_SYNTHETIC=1 npm start` (synthetic tenants, ephemeral token secret). Production: set `CAREX_TOKEN_SECRET` (32+ chars) and `CAREX_DB`.
- Admin key: `npm run admin:key -- <tenant-slug> "<label>"`
