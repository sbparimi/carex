import { Catalog } from "./catalog.js";
import { syntheticCatalog } from "./seed.js";
import { MockScheduling } from "./scheduling.js";
import { BookingService } from "./booking-service.js";
import { createServer } from "./server.js";

export { createServer, Catalog, syntheticCatalog, MockScheduling, BookingService };

/** Dev entry: synthetic data and a mock scheduling source. Never point this at real patient data. */
export function buildDevApp(clock?: () => Date) {
  const catalog = new Catalog(syntheticCatalog());
  const source = new MockScheduling(clock);
  const bookings = new BookingService(catalog, source);
  return { catalog, source, bookings, server: createServer({ catalog, bookings, log: (e) => console.log(JSON.stringify(e)) }) };
}
