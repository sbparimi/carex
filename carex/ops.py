"""Operator commands. Run from the project folder:

    python -m carex.ops serve [--port 8000] [--reload]        start the web app (SQLite file ./carex.db unless DATABASE_URL is set)
    python -m carex.ops migrate                                create or update the tables
    python -m carex.ops create-tenant <slug> "<Display name>" "#0b5fff" [support-email]
    python -m carex.ops admin-key <slug> "<label>"            print a new admin API key (shown once)
    python -m carex.ops create-staff <slug> <email> "<Name>" <front_desk|provider|admin> [provider-id]    (prompts for the password)
    python -m carex.ops seed-demo --yes                        invented demo tenants, patients and staff (refuses a database that already has tenants)
    python -m carex.ops email-test [address]                 send one test email through Resend (default: EMAIL_TEST_TO)
    python -m carex.ops dispatch                               send due reminders and notifications

DATABASE_URL (a postgresql:// connection string, e.g. from Neon) selects Postgres; otherwise SQLite at CAREX_DB (default ./carex.db).
A `.env` file in the current folder is read for convenience (never commit it)."""
from __future__ import annotations

import getpass
import json
import os
import re
import sys
from pathlib import Path


def load_dotenv(path: str = ".env") -> None:
    p = Path(path)
    if not p.is_file():
        return
    for line in p.read_text().splitlines():
        m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if m and not line.lstrip().startswith("#") and m.group(1) not in os.environ:
            os.environ[m.group(1)] = m.group(2).strip("'\"")


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    args = list(sys.argv[1:] if argv is None else argv)
    cmd = args.pop(0) if args else ""
    if cmd in ("", "-h", "--help", "help"):
        print(__doc__)
        return 0
    if cmd == "serve":
        import uvicorn
        port = int(args[args.index("--port") + 1]) if "--port" in args else int(os.environ.get("PORT", "8000"))
        host = args[args.index("--host") + 1] if "--host" in args else "127.0.0.1"
        uvicorn.run("carex.wsgi:app", host=host, port=port, reload="--reload" in args)
        return 0

    from .context import build
    ctx = build()
    db = ctx.db
    try:
        if cmd == "migrate":
            print("Database is up to date.")
        elif cmd == "create-tenant":
            if len(args) < 3 or not re.fullmatch(r"[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?", args[0]) or not re.fullmatch(r"#[0-9a-fA-F]{6}", args[2]):
                print('Usage: create-tenant <slug (a-z, 0-9, -)> "<Display name>" "#rrggbb" [support-email]', file=sys.stderr)
                return 1
            tid = f"tn-{args[0]}"
            db.run("INSERT INTO tenants (id, slug, status, display_name, primary_color, support_email, analytics_enabled) VALUES (?,?,?,?,?,?,1)", tid, args[0], "active", args[1], args[2], args[3] if len(args) > 3 else None)
            print(f"Tenant created: /t/{args[0]}/  (id {tid}). Next: admin-key {args[0]} \"<label>\", then add clinics, visit types and providers with the admin API.")
        elif cmd == "admin-key":
            t = ctx.catalog.tenant_by_slug(args[0]) if args else None
            if not t or len(args) < 2:
                print('Usage: admin-key <slug> "<label>"', file=sys.stderr)
                return 1
            print(ctx.admin_keys.create(t["id"], args[1]))
            print("Store this key now: it is not shown again.", file=sys.stderr)
        elif cmd == "create-staff":
            t = ctx.catalog.tenant_by_slug(args[0]) if args else None
            if not t or len(args) < 4:
                print('Usage: create-staff <slug> <email> "<Name>" <front_desk|provider|admin> [provider-id]', file=sys.stderr)
                return 1
            pw = getpass.getpass("Password (at least 10 characters): ")
            st = ctx.staff_accounts.create(t["id"], email=args[1], name=args[2], role=args[3], password=pw, provider_id=args[4] if len(args) > 4 else None)
            print(f"Staff login created: {st['email']} ({st['role']}). Sign in at /t/{args[0]}/staff/login")
        elif cmd == "seed-demo":
            if "--yes" not in args:
                print("This loads invented demo tenants, accounts and a known demo password. Re-run with --yes to confirm.", file=sys.stderr)
                return 1
            if int(db.get("SELECT COUNT(*) AS n FROM tenants")["n"]) > 0:
                print("Refusing: this database already has tenants.", file=sys.stderr)
                return 1
            from .seed_demo import DEMO_PASSWORD, load_demo, seed_demo_people
            load_demo(db)
            seed_demo_people(db)
            print(f"Demo data loaded. Open /t/northwind-health/. Patient: alex.demo@example.test  Staff: frontdesk@northwind.example.test  Password: {DEMO_PASSWORD}")
        elif cmd == "email-test":
            args = args or ([os.environ["EMAIL_TEST_TO"]] if os.environ.get("EMAIL_TEST_TO") else [])
            if not args or "@" not in args[0]:
                print("Usage: email-test [address]  (or set EMAIL_TEST_TO in .env)", file=sys.stderr)
                return 1
            if not ctx.channels.email:
                print("Email is not configured: set RESEND_API_KEY and EMAIL_FROM in your .env.", file=sys.stderr)
                return 1
            ctx.channels.email(args[0], "CareX test email", "If you can read this, CareX can send email through Resend.", from_name="CareX",
                               html="<p style=\"font:15px Arial,sans-serif\">If you can read this, <b>CareX</b> can send email through Resend.</p>")
            print(f"Sent a test email to {args[0]}. Check your inbox (and spam).")
        elif cmd == "dispatch":
            print(json.dumps(ctx.notifier.dispatch(limit=500)))
        else:
            print(__doc__, file=sys.stderr)
            return 1
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
