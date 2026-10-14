# CareX booking: requirement traceability (MVP slice)

Status as of 2026-10-14. "Evidence" names the automated test that exercises the requirement. Not built through the harness workers (built directly in this session); the harness is validated separately in `docs/harness/`.

Test runs: unit and API 34 tests (vitest, 3 files); browser 45 tests (Playwright + axe, Chromium at 1440, 768 and 390 px). The browser suite ran in the cloud workspace because the local shell has no browser.

| Requirement | Status | Evidence |
|---|---|---|
| FR-001 tenant resolution, no fallback | Done | api.test "does not fall back when the tenant is unknown, suspended or malformed"; e2e "unknown, suspended or malformed tenant shows a safe page" |
| FR-002 states with bookable clinics only | Done | api.test "shows only states with an active, bookable clinic" |
| FR-003 clinic filtering by state and tenant | Done | api.test "lists only active clinics in the state for the tenant"; e2e "tenants are isolated and branded" |
| FR-004 visit types from clinic config; reset on clinic change | Done | api.test "offers only visit types switched on at that clinic"; selection.test; e2e "changing an upstream choice invalidates downstream choices" |
| FR-005 eligible providers only | Done | api.test "offers only active, eligible providers" |
| FR-006 slots only from the source; time zone shown; stale slot blocked | Done (mock source) | api.test "returns provisional slots only for an eligible provider"; e2e happy path (time zone), "slot taken before confirmation" |
| FR-007 review and edit | Done | e2e happy path, "changing an upstream choice..." |
| FR-008 confirm with idempotency, atomic revalidation, no false success | Done against the mock source | api.test "booking integrity" group (10 tests); e2e "double-clicking Confirm", "timeout after the booking was saved", "scheduling outage" |
| FR-009 refresh and session resilience | Partly | e2e "refresh resilience" (selection revalidated, forged slot dropped). Patient details are deliberately not persisted. Session expiry is not modelled. |
| FR-010 telemetry without PHI, per-tenant switch | Server-side events done | api.test "privacy: logs and telemetry". Client-side step events (state_selected etc.) are defined in the allowlist but not yet emitted by the UI. |
| BR-001 / BR-012 tenant isolation | Done at the data-access layer | api.test "tenant isolation and safe errors" |
| BR-002 branding | Partly | brand colour, display name with contrast guardrail (theme.test, e2e). Logo, favicon, typography tokens not implemented. |
| BR-006..BR-009 authoritative availability, explicit confirmation, no false success, recoverability | Done against the mock source | as FR-008 |
| BR-011 accessibility | Automated checks pass | axe WCAG 2.0 to 2.2 A/AA on every screen, keyboard flow, 320 px and 200 % text reflow. Manual screen-reader and keyboard review still required; no formal target approved. |
| §12 edge-state matrix | Mostly | no clinics, no providers, no slots, stale slot, timeout, integration outage, duplicate click, missing tenant, malformed tenant covered. "Clinic deactivated mid-flow" is handled by server revalidation but has no dedicated test. |

## Not built yet (deliberately, or blocked on decisions)
- Real scheduling/EHR integration (open PRD decision). Only `MockScheduling` exists; its fault injection is test-only.
- Patient identity beyond guest details; authentication; confirmation delivery; cancellation and rescheduling.
- AI assistant features (P1 list in PRD §20). Nothing in the UI calls an AI service; AI stays off until a provider and data-handling decision exists.
- Persistent storage, admin configuration surface, rate limiting and abuse protection, production auth for tenant admin.
- Figma deliverables (no connector, PRD §22).
- HIPAA/legal applicability, privacy review, and formal accessibility target remain human decisions.
- Cross-browser matrix (only Chromium was run).

## Run it
- `npm install`, `npm run test` (API, contracts and theme tests), `npm run harness:test`
- Browser suite: `npm run test:e2e` (needs Playwright browsers installed: `npx playwright install chromium`)
- Dev server with synthetic data: build the web bundle (`npm run build:web`), then run `apps/api/src/e2e-server.ts` style entry; a production entry is not provided on purpose.
