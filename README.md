# CareX

White-label, multi-tenant appointment booking for healthcare organizations. CareX is the system of record for its own appointments (no external EHR) and has a native scheduling engine. **Python only**: FastAPI + server-rendered pages, no JavaScript, no npm.

## Run it on your computer

You need Python 3.11 or newer. Run these in the project folder, one at a time:

```
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m carex.ops seed-demo --yes
python -m carex.ops serve
```

Open http://127.0.0.1:8000/ and use the demo accounts printed by `seed-demo`:

| Who | Sign in at | Email |
| --- | --- | --- |
| Patient | `/t/northwind-health/login` | `alex.demo@example.test` |
| Front desk | `/t/northwind-health/staff/login` | `frontdesk@northwind.example.test` |
| Provider | same | `dr.alex@northwind.example.test` |
| Admin | same | `admin@northwind.example.test` |

The demo password is `Demo-Passw0rd-2026` (invented data; never use `seed-demo` on a real database). Data is stored in a file called `carex.db` (SQLite). Delete it to start over.

## Tests

```
pip install -r requirements-dev.txt
python -m pytest -q
```

To run the same tests on Postgres too, point `CAREX_TEST_PG` at an **empty** database, e.g. `CAREX_TEST_PG=postgresql://user:pw@localhost/carex_test python -m pytest -q`.

## Command-line tool

`python -m carex.ops <command>`: `serve [--port N] [--host H] [--reload]`, `migrate`, `create-tenant <slug> "<Name>" "#rrggbb" [support-email]`, `admin-key <slug> "<label>"`, `create-staff <slug> <email> "<Name>" <front_desk|provider|admin> [provider-id]`, `seed-demo --yes`, `dispatch`. Settings are read from the environment or a `.env` file (see `.env.example`).

## Deploy to Vercel with Neon

1. In Neon, create a new **empty** database (or a fresh branch) and copy the **pooled** connection string (host contains `-pooler`).
2. In Vercel, import the GitHub repo. Set environment variables: `DATABASE_URL` (the Neon string), `CRON_SECRET` (a long random string), and optionally `APP_BASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `TWILIO_*`.
3. Deploy. Tables are created automatically on first request. Check `https://<your-app>/healthz` returns `{"status":"ok"}`.
4. Create your first organization with `create-tenant` and `admin-key`, run from your computer with `DATABASE_URL` set to the same Neon string (put it in `.env`).
5. Reminders: in GitHub, add repository secrets `APP_URL` and `CRON_SECRET` so `.github/workflows/dispatch.yml` can call `/internal/dispatch` every 10 minutes.

A database that still holds the old TypeScript version's tables is refused on purpose; use a new empty database.

## Layout

- `carex/` application: `db`, `schema` (SQLite and Postgres), `scheduling` (engine), `intake`, `accounts`, `staff`, `admin`, `notify`, `waitlist`, `pages_*` (HTML routes), `templates/`, `static/`.
- `tests/` pytest suite (engine, intake, accounts, notifications, pages, staff, operations).
- `docs/` product decisions and requirement traceability.

## Before real patients

Needs clinical review (red-flag list, consent text), legal review (privacy notice, HIPAA business-associate agreements with the host, database and email/SMS vendors), accounts with an email/SMS/video vendor, and a decision on payments (none today). Rate limits are per server instance.
