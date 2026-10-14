// Process entry. Reads configuration from environment variables only; no secrets are read or logged here.
//   DATABASE_URL        PostgreSQL connection string (NeonDB). Put it in a local .env file, never in chat or git.
//                       Without it, CareX uses a local file database (PGlite) at CAREX_DATA_DIR (default ./data/pglite): fine for development, not for production.
//   CAREX_SEED_SYNTHETIC=1  load the synthetic demo tenants and demo employers/insurers if the database is empty (development and demos only)
//   PORT, HOST          listen address (default 8080 on 127.0.0.1)
//   STATIC_DIR          built web assets (default ./apps/web/public relative to the working directory; run from the repo root)
//   CAREX_SECURE_COOKIES=1  mark session cookies Secure (set this behind HTTPS in production)
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./index.js";
import { seedDb } from "./db.js";
import { demoCatalog, seedDemoPatients, DEMO_PASSWORD, DEMO_PATIENTS } from "./seed-demo.js";
import type { Mailer } from "./accounts.js";

const url = process.env.DATABASE_URL;
const dir = process.env.CAREX_DATA_DIR ?? "./data/pglite";
if (!url) mkdirSync(resolve(dir, ".."), { recursive: true });
const dev = process.env.CAREX_SEED_SYNTHETIC === "1";
// There is no email provider yet. In development the reset link is printed to this console; otherwise nothing is sent and nothing secret is logged.
const mailer: Mailer = {
  async sendPasswordReset(to, slug, token) {
    if (dev) console.log(JSON.stringify({ event: "dev_password_reset_link", path: `/t/${slug}/reset#token=${token}`, note: "development only; no email provider is configured" }));
    else console.log(JSON.stringify({ event: "password_reset_requested_no_mailer" }));
  },
};
const app = await buildApp({
  db: url ? { url } : { dir }, mailer, secureCookies: process.env.CAREX_SECURE_COOKIES === "1",
  staticDir: process.env.STATIC_DIR ?? resolve(process.cwd(), "apps/web/public"),
  log: (e) => console.log(JSON.stringify(e)),
});
const empty = (await app.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM tenants"))!.n === 0;
if (empty && dev) { await seedDb(app.db, demoCatalog()); await seedDemoPatients(app.db); console.log(JSON.stringify({ event: "seeded_synthetic_data", demoLogins: DEMO_PATIENTS.map((p) => `/t/${p.tenant}/login  ${p.email}`), demoPassword: DEMO_PASSWORD })); }
else if (empty) console.log(JSON.stringify({ event: "database_has_no_tenants", hint: "set CAREX_SEED_SYNTHETIC=1 for development" }));
console.log(JSON.stringify({ event: "database", kind: url ? "postgres" : "pglite-local" }));
const port = Number(process.env.PORT ?? 8080);
app.server.listen(port, process.env.HOST ?? "127.0.0.1", () => console.log(JSON.stringify({ event: "listening", port })));
