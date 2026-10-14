// Process entry. Reads configuration from environment variables only; no secrets are read or logged here.
//   CAREX_DB            path of the SQLite file (default ./data/carex.db)
//   CAREX_SEED_SYNTHETIC=1  load the synthetic demo tenants if the database is empty (development only; never with real data)
//   PORT, HOST          listen address (default 8080 on 127.0.0.1)
//   STATIC_DIR          built web assets (default apps/web/public)
//   CAREX_TOKEN_SECRET  >= 32 characters; signs guest "manage this appointment" links. Required unless CAREX_SEED_SYNTHETIC=1
//                       (development), where a random per-process secret is used and links stop working after a restart.
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./index.js";
import { seedDb } from "./db.js";
import { syntheticCatalog } from "./seed.js";

const dbPath = process.env.CAREX_DB ?? "./data/carex.db";
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
let manageSecret = process.env.CAREX_TOKEN_SECRET;
if (!manageSecret || manageSecret.length < 32) {
  if (process.env.CAREX_SEED_SYNTHETIC !== "1") { console.error("CAREX_TOKEN_SECRET must be set to at least 32 characters. Refusing to start."); process.exit(1); }
  manageSecret = randomBytes(32).toString("base64url");
  console.log(JSON.stringify({ event: "ephemeral_token_secret", note: "development only; manage links break on restart" }));
}
const app = buildApp({
  manageSecret,
  dbPath, staticDir: process.env.STATIC_DIR ?? fileURLToPath(new URL("../../web/public", import.meta.url)),
  log: (e) => console.log(JSON.stringify(e)),
});
const empty = (app.db.prepare("SELECT COUNT(*) AS n FROM tenants").get() as { n: number }).n === 0;
if (empty && process.env.CAREX_SEED_SYNTHETIC === "1") { seedDb(app.db, syntheticCatalog()); console.log(JSON.stringify({ event: "seeded_synthetic_data" })); }
else if (empty) console.log(JSON.stringify({ event: "database_has_no_tenants", hint: "set CAREX_SEED_SYNTHETIC=1 for development" }));
const port = Number(process.env.PORT ?? 8080);
app.server.listen(port, process.env.HOST ?? "127.0.0.1", () => console.log(JSON.stringify({ event: "listening", port })));
