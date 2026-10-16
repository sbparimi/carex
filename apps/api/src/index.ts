import { openDb, type Db, type OpenOptions } from "./db.js";
import { DbCatalog } from "./db-catalog.js";
import { DbScheduling } from "./db-scheduling.js";
import { DbIntake } from "./intake.js";
import { Notifier, type Channels } from "./notify.js";
import { DbWaitlist } from "./waitlist.js";
import { BookingService } from "./booking-service.js";
import { createServer, type Deps } from "./server.js";
import { AdminKeys } from "./admin-keys.js";
import { DbAdmin } from "./db-admin.js";
import { Accounts, type Mailer } from "./accounts.js";

export { createServer, DbCatalog, DbScheduling, BookingService, openDb };

/** Wires the real CareX engine to one PostgreSQL database (Neon via `db.url`, or in-process PGlite). Seeding is the caller's decision. */
export async function buildApp(opts: { db?: OpenOptions; /** An already-open database (tests). */ database?: Db; now?: () => Date; changeNoticeMinutes?: number; mailer?: Mailer; channels?: Channels; cronSecret?: string } & Partial<Pick<Deps, "trustProxy" | "log" | "telemetry" | "staticDir" | "limits" | "secureCookies">> = {}) {
  const db: Db = opts.database ?? await openDb(opts.db ?? {});
  const catalog = new DbCatalog(db);
  const notice = opts.changeNoticeMinutes ?? 120;
  const scheduling = new DbScheduling(db, { minChangeNoticeMinutes: notice, ...(opts.now ? { now: opts.now } : {}) });
  const intake = new DbIntake(db, opts.now);
  const waitlist = new DbWaitlist(db, opts.now);
  const notifier = new Notifier(db, opts.channels ?? { baseUrl: "http://localhost:8080" }, opts.now);
  const bookings = new BookingService(catalog, scheduling, { changeNoticeMinutes: notice, intake, ...(opts.now ? { now: opts.now } : {}) });
  const admin = { keys: new AdminKeys(db, opts.now), config: new DbAdmin(db, opts.now) };
  const accounts = new Accounts(db, opts.now, opts.mailer);
  const { db: _d, database: _db, now: _n, changeNoticeMinutes: _c, mailer: _m, channels: _ch, ...rest } = opts;
  return { db, catalog, scheduling, bookings, admin, accounts, notifier, server: createServer({ catalog, bookings, admin, accounts, intake, waitlist, notifier, ...rest }) };
}
