// Test-only entry used by Playwright. Real CareX engine on an in-memory database with synthetic data, plus fault injection
// and reset endpoints. Never deployed.
import { fileURLToPath } from "node:url";
import { openDb, seedDb } from "./db.js";
import { syntheticCatalog } from "./seed.js";
import { SqliteCatalog } from "./sqlite-catalog.js";
import { SqliteScheduling } from "./sqlite-scheduling.js";
import { FaultInjectingScheduling, type Fault } from "./fault-injection.js";
import { BookingService } from "./booking-service.js";
import { createServer, type Deps } from "./server.js";

function fresh() {
  const db = openDb(); seedDb(db, syntheticCatalog());
  const catalog = new SqliteCatalog(db);
  const source = new FaultInjectingScheduling(new SqliteScheduling(db));
  return { catalog, source, bookings: new BookingService(catalog, source) };
}
let state = fresh();
const deps: Deps = {
  catalog: state.catalog, bookings: state.bookings,
  staticDir: process.env.STATIC_DIR ?? fileURLToPath(new URL("../../web/public", import.meta.url)),
  testHooks: {
    injectFault: (f) => state.source.injectFault(f as Fault),
    reset: () => { state = fresh(); deps.catalog = state.catalog; deps.bookings = state.bookings; },
  },
};
const port = Number(process.env.PORT ?? 4173);
createServer(deps).listen(port, "127.0.0.1", () => console.log(`e2e server on ${port}`));
