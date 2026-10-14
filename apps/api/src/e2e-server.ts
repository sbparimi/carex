// Test-only entry used by Playwright. Real CareX engine on an in-memory PGlite database with synthetic data, plus fault injection,
// reset and a captured-reset-token endpoint. Never deployed.
import { fileURLToPath } from "node:url";
import { openTestDb, seedDb } from "./db.js";
import { syntheticCatalog } from "./seed.js";
import { DbCatalog } from "./db-catalog.js";
import { DbScheduling } from "./db-scheduling.js";
import { FaultInjectingScheduling, type Fault } from "./fault-injection.js";
import { BookingService } from "./booking-service.js";
import { AdminKeys } from "./admin-keys.js";
import { DbAdmin } from "./db-admin.js";
import { Accounts, type Mailer } from "./accounts.js";
import { createServer, type Deps } from "./server.js";

let lastResetToken = "";
const mailer: Mailer = { async sendPasswordReset(_to, _slug, token) { lastResetToken = token; } };

async function fresh() {
  const db = await openTestDb(); await seedDb(db, syntheticCatalog());
  const catalog = new DbCatalog(db);
  const source = new FaultInjectingScheduling(new DbScheduling(db));
  return { db, catalog, source, bookings: new BookingService(catalog, source), accounts: new Accounts(db, undefined, mailer), admin: { keys: new AdminKeys(db), config: new DbAdmin(db) } };
}
let state = await fresh();
const deps: Deps = {
  catalog: state.catalog, bookings: state.bookings, accounts: state.accounts, admin: state.admin,
  limits: { read: { limit: 100_000, windowMs: 60_000 }, write: { limit: 100_000, windowMs: 60_000 }, auth: { limit: 100_000, windowMs: 60_000 } },   // tests hit the API far faster than a patient would
  staticDir: process.env.STATIC_DIR ?? fileURLToPath(new URL("../../web/public", import.meta.url)),
  testHooks: {
    injectFault: (f) => state.source.injectFault(f as Fault),
    reset: async () => { const s = await fresh(); state = s; deps.catalog = s.catalog; deps.bookings = s.bookings; deps.accounts = s.accounts; deps.admin = s.admin; },
    lastResetToken: () => lastResetToken,
  },
};
const port = Number(process.env.PORT ?? 4173);
createServer(deps).listen(port, "127.0.0.1", () => console.log(`e2e server on ${port}`));
