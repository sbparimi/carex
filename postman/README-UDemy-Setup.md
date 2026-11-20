# CareX Postman training package

## Files
- `CareX-Udemy-Training.postman_collection.json` — shared API collection with 41 request templates, organized by workflow.
- `environments/CareX-Dev.postman_environment.json` — local development environment.
- `environments/CareX-Test.postman_environment.json` — deployed preview environment, read-only by default.

## Import
1. In Postman, select **Import** and import the collection JSON.
2. Import both environment JSON files.
3. Select **CareX — Dev (Local)** for hands-on development or **CareX — Test (Vercel Preview / Read-only)** for safe preview checks.
4. Run **01 — Public discovery** first. The collection captures clinic, visit type, provider, slot and employer IDs from responses.
5. Run patient signup/login and then the appointment lifecycle. Optional MFA, password reset, dependent, waitlist and staff-assisted booking requests are included for lesson demonstrations. The signup request generates a unique synthetic learner email on each run.
6. Staff workflows require a provisioned staff account. The local seeded demo credentials are prefilled in the Dev environment.

## Environment safety
- Dev points to `http://127.0.0.1:8000`. Start CareX locally with `python -m carex.ops serve` after configuring a dedicated development Neon branch and running `python -m carex.ops seed-demo --yes`.
- Test points to the latest ready Vercel preview deployment for the API branch. Vercel currently has the same Neon integration variables attached to Preview and Production. Therefore all write methods are blocked by the collection-level pre-request guard in Test.
- Do not change `allowWrites` to `true` in Test until the Preview deployment is configured with a separate, disposable Neon branch and the database isolation is verified.
- Never use real patient information or production credentials. Do not add `CRON_SECRET`, database URLs, admin keys or other server secrets to Postman.
- CI's `NEON_TEST_DATABASE_URL` is for GitHub Actions integration tests; it is not an HTTP API endpoint and cannot be used as a Postman base URL.

## Workflow order
1. Public discovery
2. Patient authentication
3. Patient appointment lifecycle
4. Patient dependents, notification preferences and waitlist
5. Staff authentication and scheduling/lifecycle operations

The current product confirms patient bookings immediately. It does not implement a separate doctor-approval state. Scheduled time passing does not automatically mark an appointment arrived or completed; staff/provider actions control those transitions.

## API documentation
- Swagger UI: `{{baseUrl}}/api/docs`
- OpenAPI JSON: `{{baseUrl}}/api/openapi.json`
- Tenant API prefix: `/t/{{tenant}}/api/v1`


## HTTP 401 troubleshooting

CareX API v1 uses opaque session tokens, not JWTs. First run **Patient login** (or **Patient signup**) and confirm the response contains `access_token` and `token_type: Bearer`. The collection saves the token into both the active environment and collection variables. Run **Patient token status** to verify `/auth/me` returns HTTP 200 before calling appointments. Staff routes require their own token from **Staff login**; do not reuse the patient token. The included Dev environment uses `http://127.0.0.1:8127` and tenant `northwind-health`. If the API listens on a different port, update `baseUrl` to the actual listener. Never commit or share access tokens.
