# CareX

White-label, multi-tenant appointment booking for healthcare organizations. CareX is the system of record for its own appointments (no external EHR) and has a native scheduling engine. **Python only**: FastAPI + server-rendered pages, no JavaScript, no npm.

## Run it on your computer

You need Python 3.11 or newer and a Neon project. Create a dedicated Neon branch for development, copy its pooled connection string, and set `DATABASE_URL` in `.env` before starting CareX. CareX has no SQLite or local-file database mode.

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

The demo password is `Demo-Passw0rd-2026` (invented data; never use `seed-demo` on a real database). All application data is stored in Neon. Use a separate Neon branch for demo or development data.

## Tests

```
pip install -r requirements-dev.txt
python -m pytest -q
```

Tests require a dedicated, empty Neon branch. Set `CAREX_TEST_DATABASE_URL` to that branch's pooled connection string, then run `python -m pytest -q`. The suite truncates tables between tests; never point it at production. CI reads the equivalent value from the GitHub repository secret `NEON_TEST_DATABASE_URL`; without that secret, database integration tests are skipped.

## Command-line tool

`python -m carex.ops <command>`: `serve [--port N] [--host H] [--reload]`, `migrate`, `create-tenant <slug> "<Name>" "#rrggbb" [support-email]`, `admin-key <slug> "<label>"`, `create-staff <slug> <email> "<Name>" <front_desk|provider|admin> [provider-id]`, `seed-demo --yes`, `dispatch`. Settings are read from the environment or a `.env` file (see `.env.example`).

## Deploy to Vercel with Neon

1. In Neon, create a project and a dedicated **empty branch** for this CareX environment. Copy the **pooled** connection string (host contains `-pooler`).
2. In Vercel, import the GitHub repo. Set environment variables: `DATABASE_URL` (the Neon string), `CRON_SECRET` (a long random string), and optionally `APP_BASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `TWILIO_*`.
3. Deploy. Tables are created automatically on first request. Check `https://<your-app>/healthz` returns `{"status":"ok"}`.
4. Create your first organization with `create-tenant` and `admin-key`, run from your computer with `DATABASE_URL` set to the same Neon string (put it in `.env`).
5. Reminders: in GitHub, add repository secrets `APP_URL` and `CRON_SECRET` so `.github/workflows/dispatch.yml` can call `/internal/dispatch` every 10 minutes.

A database that still holds the old TypeScript version's tables is refused on purpose; use a new empty database.

## Layout

- `carex/` application: `db` (Neon via PostgreSQL protocol), `schema` (Neon/PostgreSQL), `scheduling` (engine), `intake`, `accounts`, `staff`, `admin`, `notify`, `waitlist`, `pages_*` (HTML routes), `templates/`, `static/`.
- `tests/` pytest suite (engine, intake, accounts, notifications, pages, staff, operations).
- `docs/` product decisions and requirement traceability.

## Before real patients

Needs clinical review (red-flag list, consent text), legal review (privacy notice, HIPAA business-associate agreements with the host, database and email/SMS vendors), accounts with an email/SMS/video vendor, and a decision on payments (none today). Rate limits are per server instance.


## Trying the emails end to end

Set `RESEND_API_KEY`, `EMAIL_FROM` and `DEMO_EMAIL_TEMPLATE` (see `.env.example`) in your local `.env`, then use a fresh Neon development branch, run `python -m carex.ops seed-demo --yes`, and start `python -m carex.ops serve`.
Each demo patient gets a numbered inbox (`...+test001@...`, `...+test002@...`). Sign in as that patient, book, reschedule or cancel, and the emails arrive there. Reminders go out when `python -m carex.ops dispatch` runs (or `/internal/dispatch` is called on a schedule).

## GitHub Codespaces

Open this repository on the `fix/postman-bearer-auth-setup` branch and create a Codespace using the checked-in `.devcontainer/devcontainer.json`. The container uses Python 3.12, installs the development dependencies, forwards port 8127 privately, and includes VS Code tasks for starting the API and running tests.

1. In GitHub, switch to branch `fix/postman-bearer-auth-setup`.
2. Select **Code → Codespaces → Create codespace on fix/postman-bearer-auth-setup**.
3. Wait for the post-create setup to finish. It installs `requirements-dev.txt` and creates a local `.env` from `.env.example`.
4. Create a dedicated, empty Neon development branch. Do not use production or the shared Preview/Production database.
5. Set `DATABASE_URL` in the Codespace's local `.env` to that branch's pooled Neon connection string. Do not commit `.env`.
6. Start the API using **Terminal → Run Task → CareX: start API (8127)**, or run:
   `python -m carex.ops serve --host 0.0.0.0 --port 8127 --reload`
7. In the Ports panel, open port 8127. Keep its visibility **Private**. Use the forwarded HTTPS URL as Postman's `baseUrl` when Postman is running outside the Codespace. If Postman runs inside the Codespace, use `http://127.0.0.1:8127`.
8. On the dedicated empty Neon development branch only, seed the synthetic demo accounts once with `python -m carex.ops seed-demo --yes`.

The Dev Postman environment's default `baseUrl` remains `http://127.0.0.1:8127` for a local process. When using Postman outside Codespaces, replace it with the forwarded HTTPS port URL displayed by GitHub.

**Database requirement:** CareX does not support SQLite or an in-memory database. The API cannot start successfully until `DATABASE_URL` points to a reachable PostgreSQL/Neon database. Integration tests additionally require a separate empty Neon branch in `CAREX_TEST_DATABASE_URL`; never point tests at the demo or production database.
