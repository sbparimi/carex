# ADR-005: Patient accounts, login-required booking, PostgreSQL (Neon)

Status: accepted and built. Supersedes ADR-003 (guest manage links, optional login) and the storage choice in ADR-002 (SQLite).

Owner request: "allow the users to book appointment only when they are login, sign up ... dummy data and NeonDB in the backend ... end to end complete application that can be SaaS product eventually". Sign-up and login follow the functions of the reference screenshots (name, date of birth, mobile phone, access through an employer or an insurance provider, then email and password; show password, forgot password, tech support link). Only CareX and tenant branding is used.

## Decisions
- **Storage:** PostgreSQL through `pg`, configured by `DATABASE_URL` (Neon). With no `DATABASE_URL` the app uses PGlite (in-process Postgres, files in `./data/pglite`) so local runs and tests need no server. Same SQL either way; migrations run at start under an advisory lock.
- **Login required:** catalog browsing, slots, booking and "My appointments" need a signed-in account of that clinic brand. Unauthenticated calls get the same 401. Pages redirect to login with a validated `next` path.
- **Accounts are tenant-scoped:** the same email can register at two brands; they are separate accounts. Employers and insurers are per tenant (dummy data seeded; real lists come from the admin API later).
- **Passwords:** scrypt with per-password salt, 10 to 128 characters, no composition rules. Failed logins lock the account 15 minutes after 5 tries (423). Wrong email and wrong password return an identical 401.
- **Sessions:** random token, only its hash is stored, 7 days. Cookie `carex_session`, HttpOnly, SameSite=Lax, path scoped to the tenant, `Secure` when `CAREX_SECURE_COOKIES=1`. Cross-site writes are refused by an Origin check.
- **Reset:** single-use token, 30 minutes, only its hash stored; success signs out every session. The forgot-password reply is identical for known and unknown emails.
- **Sign-up trade-off:** a duplicate email returns 409 (needed for a usable form). This reveals that an email is registered. Accepted for now; rate limits apply. Revisit with email verification.
- **Age:** 18 or older (date of birth checked server-side). No minors or proxy accounts until a legal decision.
- **Booking owner is the account.** Patient details come from the account; any patient object in the request is ignored. Another patient's booking returns a generic 404. Change-notice rule is unchanged (120 minutes).
- **No email provider yet:** reset links are written to the server log only when `CAREX_SEED_SYNTHETIC=1`. Real reset and confirmation email needs a provider and credentials from the owner.

## Open
- Validate concurrency (double booking, concurrent reschedule) on real Neon; tests use PGlite, which has a single connection.
- Email provider, email verification, MFA, retention and deletion policy, encryption at rest, legal review of PHI handling.
- Trusted-proxy handling for client IPs; admin UI for employers, insurers and accounts.

## Operating on Neon
Create a Neon project, copy its connection string into your local `.env` as `DATABASE_URL` (do not paste it in chat or commit it), set `CAREX_SECURE_COOKIES=1` behind HTTPS, then `npm start`. Create an admin key with `npm run admin:key -- <tenant-slug> "<label>"`.
