# ADR-003: Guest management links now; optional patient login later

Status: **SUPERSEDED by ADR-005** (accounts replace guest links; guest booking was removed). Historical text: guest links accepted and built. Optional login: **design only, not built, needs approval** (owner answer: "Guest plus optional login").

## Decision (built)
A guest who books receives a manage link. The link carries a stateless token, `HMAC-SHA256(secret, tenantId + bookingId)`, base64url, in the **URL fragment** (never sent to servers or logs); the page sends it in the `x-manage-token` header.
- Any mismatch (wrong token, wrong tenant, unknown booking, missing secret) returns the same generic 404, so booking ids cannot be probed.
- Manage endpoints return times and names of clinic, visit type and provider only. Patient name and contact are never returned.
- Cancel and reschedule are allowed up to the change-notice window (default 120 min, inclusive); the engine enforces it, not the UI.
- Per-client and per-booking rate limits apply (`manage`, `manageId`).
- Rotating `CAREX_TOKEN_SECRET` invalidates every outstanding link. There is no per-link revocation; a cancelled booking simply stops being manageable.

## Not built: optional login
Proposed shape, for approval:
1. Passwordless email one-time code (no passwords stored). Needs an **email provider and credentials from the owner**, set as environment variables.
2. A patient account links bookings by verified email; guest booking stays the default path and is never blocked.
3. Sessions: short-lived, HttpOnly, SameSite=Lax cookie; server-side session table.
4. Account data is PHI-adjacent: retention, deletion and consent rules need a legal decision first.

## Consequences
Guests lose access if they lose the link. Confirmation emails would fix that but need the same email provider; until then the link is shown on screen, copyable, and available as an .ics file.
