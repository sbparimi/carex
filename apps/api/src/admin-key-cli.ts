// Creates an admin API key for one tenant and prints it ONCE. Usage:  npm run admin:key -- <tenant-slug> "<label>"
// Uses DATABASE_URL (Neon) or the local PGlite directory CAREX_DATA_DIR. Stop the server first when using the local file database.
import { openDb } from "./db.js";
import { AdminKeys } from "./admin-keys.js";

const [slug, label] = process.argv.slice(2);
if (!slug || !label) { console.error('usage: npm run admin:key -- <tenant-slug> "<label>"'); process.exit(2); }
const url = process.env.DATABASE_URL;
const db = await openDb(url ? { url } : { dir: process.env.CAREX_DATA_DIR ?? "./data/pglite" });
const t = await db.get<{ id: string }>("SELECT id FROM tenants WHERE slug = ?", slug);
if (!t) { console.error("unknown tenant slug"); await db.close(); process.exit(1); }
console.log(await new AdminKeys(db).create(t.id, label));
await db.close();
