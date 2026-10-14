import { openDb } from "./db.js";
import { SqliteCatalog } from "./sqlite-catalog.js";
import { SqliteScheduling } from "./sqlite-scheduling.js";
import { BookingService } from "./booking-service.js";
import { createServer, type Deps } from "./server.js";

export { createServer, SqliteCatalog, SqliteScheduling, BookingService, openDb };

/** Wires the real CareX engine to one database file (":memory:" for tests). Seeding is the caller's decision. */
export function buildApp(opts: { dbPath: string; now?: () => Date } & Partial<Pick<Deps, "log" | "telemetry" | "staticDir">>) {
  const db = openDb(opts.dbPath);
  const catalog = new SqliteCatalog(db);
  const scheduling = new SqliteScheduling(db, opts.now ? { now: opts.now } : {});
  const bookings = new BookingService(catalog, scheduling);
  const { dbPath: _p, now: _n, ...rest } = opts;
  return { db, catalog, scheduling, bookings, server: createServer({ catalog, bookings, ...rest }) };
}
