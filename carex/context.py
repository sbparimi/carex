"""Wires the services together for one database. `build()` is what the web app, the ops CLI and the tests all use."""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Mapping

from .accounts import Accounts
from .admin import Admin, AdminKeys
from .audit import Audit
from .booking import BookingService
from .catalog import Catalog
from .db import Db, open_db
from .discover import Discover
from .events import Events
from .insights import Insights
from .intake import Intake
from .mailer import AccountMailer, channels_from_env
from .privacy import Privacy
from .notify import Channels, Notifier
from .scheduling import Scheduling
from .staff import StaffAccounts, StaffDesk
from .util import now as _now
from .waitlist import Waitlist


@dataclass
class Ctx:
    db: Db
    clock: Callable[[], datetime]
    catalog: Catalog
    sched: Scheduling
    intake: Intake
    booking: BookingService
    accounts: Accounts
    waitlist: Waitlist
    audit: Audit
    notifier: Notifier
    staff_accounts: StaffAccounts
    desk: StaffDesk
    admin: Admin
    admin_keys: AdminKeys
    channels: Channels
    secure_cookies: bool = False
    cron_secret: str | None = None
    default_tenant: str | None = None
    trust_proxy: bool = False
    discover: Discover | None = None
    events: Events | None = None
    insights: Insights | None = None
    privacy: Privacy | None = None


def build(db: Db | None = None, env: Mapping[str, str] | None = None, clock: Callable[[], datetime] = _now, channels: Channels | None = None,
          mailer=None, production: bool | None = None) -> Ctx:
    env = os.environ if env is None else env
    if db is None:
        url = env.get("DATABASE_URL") or env.get("POSTGRES_URL") or env.get("DATABASE_URL_UNPOOLED") or ""
        if env.get("VERCEL") and not url.startswith(("postgres://", "postgresql://")):
            raise RuntimeError("DATABASE_URL is missing or is not a postgresql:// connection string. Set it in the Vercel project's Environment Variables (Production) and redeploy.")
        db = open_db(url=url or None, path=env.get("CAREX_DB") or "carex.db")
    prod = bool(env.get("VERCEL") or env.get("CAREX_ENV") == "production") if production is None else production
    ch = channels or channels_from_env(env)
    catalog, sched, intake = Catalog(db), Scheduling(db, clock), Intake(db, clock)
    return Ctx(db=db, clock=clock, catalog=catalog, sched=sched, intake=intake, booking=BookingService(catalog, sched, intake, clock),
               accounts=Accounts(db, clock, mailer or AccountMailer(ch, prod)), waitlist=Waitlist(db, clock), audit=Audit(db, clock), notifier=Notifier(db, ch, clock),
               staff_accounts=StaffAccounts(db, clock), desk=StaffDesk(db, sched, intake, clock), admin=Admin(db, clock), admin_keys=AdminKeys(db, clock), channels=ch,
               secure_cookies=prod, cron_secret=env.get("CRON_SECRET") or None, default_tenant=env.get("DEFAULT_TENANT") or None, trust_proxy=bool(env.get("VERCEL")) or env.get("CAREX_TRUST_PROXY") == "1",
               discover=Discover(catalog, BookingService(catalog, sched, intake, clock), float(env.get("CAREX_SOONEST_TTL", "15") or 0)), events=Events(db, clock), insights=Insights(db, sched, clock), privacy=Privacy(db, sched, Audit(db, clock), clock))
