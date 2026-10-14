// Test-only entry used by Playwright. Synthetic data, mock scheduling, fault injection and reset endpoints. Never deployed.
import { fileURLToPath } from "node:url";
import { Catalog } from "./catalog.js";
import { syntheticCatalog } from "./seed.js";
import { MockScheduling, type Fault } from "./scheduling.js";
import { BookingService } from "./booking-service.js";
import { createServer, type Deps } from "./server.js";

const catalog = new Catalog(syntheticCatalog());
let source = new MockScheduling(() => new Date());
const deps: Deps = {
  catalog, bookings: new BookingService(catalog, source),
  staticDir: process.env.STATIC_DIR ?? fileURLToPath(new URL("../../web/public", import.meta.url)),
  testHooks: {
    injectFault: (f) => source.injectFault(f as Fault),
    reset: () => { source = new MockScheduling(() => new Date()); deps.bookings = new BookingService(catalog, source); },
  },
};
const port = Number(process.env.PORT ?? 4173);
createServer(deps).listen(port, "127.0.0.1", () => console.log(`e2e server on ${port}`));
