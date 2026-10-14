# ADR-007: Web deployment on Vercel with Neon

Status: accepted, built, **not yet deployed** (needs your GitHub repo, Vercel project and Neon database; see "Deploy").

## Decisions
- **One serverless function.** `vercel.json` rewrites every path to `api/index.js`, which re-exports `dist/vercel.mjs` (bundled from `apps/api/src/vercel.ts` by `npm run build:vercel`). All routing, security headers, CSP, tenant checks and sessions stay in the app; Vercel's CDN serves nothing but `robots.txt`. The page shells and scripts in `apps/web/public` are packaged with the function (`includeFiles`).
- **Database:** Neon through `DATABASE_URL` (use the pooled string). The app is built once per warm instance, migrations run at cold start under an advisory lock, `/healthz` checks the database.
- **Cookies and proxy:** the Vercel entry always sets Secure cookies and trusts the proxy address headers (`trustProxy`), so rate limits see real client addresses. Never enable `trustProxy` when the app is directly exposed.
- **Email:** password reset goes through Resend's HTTP API when `RESEND_API_KEY`, `EMAIL_FROM` (verified sender) and a base URL are set; otherwise nothing is sent.
- **Operator commands** (run from your computer with `DATABASE_URL` in your shell or `.env`): `npm run ops -- migrate | create-tenant | seed-demo --yes`, and `npm run admin:key -- <slug> "<label>"`.
- **CI:** GitHub Actions runs typecheck, unit/API tests, the Vercel build and the browser suite on every push and pull request.

## Known limits before real patients
1. **Rate limits are per serverless instance** (in memory). Account lockout and password-reset limits that matter most are in the database, but request-rate limiting needs a shared store (for example Upstash Redis) before public launch.
2. **Concurrency is proven on PGlite only.** Run the double-booking and concurrent-reschedule tests against a real Neon branch before launch.
3. **Tenant onboarding is operator-driven** (ops command plus admin API); there is no self-service signup, billing or admin UI yet.
4. **Email:** only password reset is sent. Booking confirmations and reminders are not built.
5. **Health data.** Appointment and patient details are personal data and may be regulated (HIPAA, GDPR). Confirm with counsel which plans and agreements your hosting and database vendors provide, and decide retention, deletion, audit logging and encryption policy first. This ADR does not make the product compliant.
6. No email verification, MFA, or account deletion yet.

## Deploy (owner steps, one at a time)
1. Create a Neon project; copy the **pooled** connection string.
2. Create a GitHub repository and push this code (see README).
3. In Vercel: Add New > Project > import the repository. Framework preset "Other"; the repo's `vercel.json` sets everything else.
4. In Vercel > Settings > Environment Variables add `DATABASE_URL` (and optionally `RESEND_API_KEY`, `EMAIL_FROM`, `APP_BASE_URL`). Redeploy.
5. From your computer, with `DATABASE_URL` in your shell: `npm run ops -- create-tenant <slug> "<Name>" "#0b5fff"` or, for a demo database, `npm run ops -- seed-demo --yes`.
6. Open `https://<your-domain>/t/<slug>/login` and `https://<your-domain>/healthz`.
