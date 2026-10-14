# ADR-004: Admin configuration API

Status: accepted and built (API only; no admin UI yet).

## Decision
Tenant admins configure CareX through `/t/<slug>/api/admin/*`, authenticated with a per-tenant bearer key.
- Keys look like `cxa_<43 url-safe chars>` (256-bit random). Only a SHA-256 hash is stored; the plaintext is shown once at creation.
- Create a key locally: `npm run admin:key -- <tenant-slug> "<label>"` (reads `CAREX_DB`). Keys can be revoked by label.
- A key works only for its own tenant. Missing, malformed, revoked and wrong-tenant keys all get an identical 401. Admin requests are rate limited per client.
- Objects of another tenant answer 404, the same as objects that do not exist.

## Surface
Brand and analytics flag; clinics (list, create, update); visit types on or off per clinic; weekly availability per provider and clinic (replaced atomically, validated for overlap and range); time off (add, remove).
- New clinics start **inactive and not bookable**; nothing reaches patients until an admin activates it.
- Deactivating a clinic reports how many future confirmed appointments it has but does **not** cancel them.
- Changes apply to patients immediately (no cache).

## Not built
Admin UI; creating providers and visit types (only configuring existing ones); audit log of admin changes; role separation within a tenant; SSO. Key-based access is adequate for an operator-run pilot, not for self-service customers.
