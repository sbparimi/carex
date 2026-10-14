// Creates an admin API key for one tenant and prints it ONCE. Usage:  npm run admin:key -- <tenant-slug> "<label>"
// Reads CAREX_DB (default ./data/carex.db). The key is not stored in plaintext anywhere; keep it in your password manager.
import { openDb } from "./db.js";
import { AdminKeys } from "./admin-keys.js";

const [slug, label] = process.argv.slice(2);
if (!slug || !label) { console.error('usage: npm run admin:key -- <tenant-slug> "<label>"'); process.exit(2); }
const db = openDb(process.env.CAREX_DB ?? "./data/carex.db");
const t = db.prepare("SELECT id FROM tenants WHERE slug = ?").get(slug) as { id: string } | undefined;
if (!t) { console.error("unknown tenant slug"); process.exit(1); }
console.log(new AdminKeys(db).create(t.id, label));
