// Operator commands for a deployed database. Run locally; DATABASE_URL is read from your shell or from a local .env file (never pass it on the command line):
//   npm run ops -- migrate
//   npm run ops -- create-tenant <slug> "<Display name>" "#0b5fff" [support-email]
//   npm run ops -- seed-demo --yes          (invented demo data; refuses a database that already has tenants)
import { openDb } from "./db.js";
import { seedDb } from "./db.js";
import { demoCatalog, seedDemoPatients, DEMO_PASSWORD } from "./seed-demo.js";

const [cmd, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL (in your shell or .env) first."); process.exit(1); }
const db = await openDb({ url });
try {
  if (cmd === "migrate") console.log("Database is up to date.");
  else if (cmd === "create-tenant") {
    const [slug, name, color, email] = args;
    if (!slug || !/^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/.test(slug) || !name || !color || !/^#[0-9a-fA-F]{6}$/.test(color)) { console.error('Usage: create-tenant <slug (a-z, 0-9, -)> "<Display name>" "#rrggbb" [support-email]'); process.exit(1); }
    const id = `tn-${slug}`;
    await db.run("INSERT INTO tenants (id, slug, status, display_name, primary_color, logo_url, support_email, support_phone, analytics_enabled) VALUES (?,?,?,?,?,?,?,?,?)", id, slug, "active", name, color, null, email ?? null, null, 1);
    console.log(`Tenant created: /t/${slug}/  (id ${id}). Next: npm run admin:key -- ${slug} "<label>" and use the admin API to add clinics, visit types and providers.`);
  } else if (cmd === "seed-demo") {
    if (!args.includes("--yes")) { console.error("This loads invented demo tenants, demo accounts and a known demo password. Re-run with --yes to confirm."); process.exit(1); }
    const n = (await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM tenants"))!.n;
    if (n > 0) { console.error("Refusing: this database already has tenants."); process.exit(1); }
    await seedDb(db, demoCatalog()); await seedDemoPatients(db);
    console.log(`Demo data loaded. Demo password: ${DEMO_PASSWORD}`);
  } else { console.error("Commands: migrate | create-tenant | seed-demo"); process.exit(1); }
} finally { await db.close(); }
