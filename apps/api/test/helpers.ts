// Shared test helpers: real HTTP server on an in-memory Postgres (PGlite), and signed-in clients with a cookie jar.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildApp } from "../src/index.js";
import { openTestDb, seedDb } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";

export const PASSWORD = "correct horse battery 42";
export const NOW = new Date("2026-11-02T08:00:00Z");                 // Monday 00:00 in Los Angeles

export const signupBody = (over: Record<string, unknown> = {}, tenant: "north" | "bay" = "north") => ({
  email: "pat.synthetic@example.test", password: PASSWORD, firstName: "Pat", lastName: "Synthetic", dateOfBirth: "1985-04-12", phone: "+31 6 1234 5678",
  access: tenant === "north" ? { type: "employer", employerId: "em-n-1" } : { type: "employer", employerId: "em-b-1" }, ...over,
});

export interface Api {
  app: Awaited<ReturnType<typeof buildApp>>; base: string; server: Server; close(): Promise<void>;
  /** A fetch wrapper that remembers the session cookie per tenant. */
  client(): Client;
}
export interface Client {
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any; text: string; headers: Headers }>;
  get(path: string): ReturnType<Client["call"]>;
  post(path: string, body?: unknown, headers?: Record<string, string>): ReturnType<Client["call"]>;
  signup(slug: string, over?: Record<string, unknown>): ReturnType<Client["call"]>;
  jar: Map<string, string>;
}

export async function startApi(extra: Parameters<typeof buildApp>[0] = {}, seed = true): Promise<Api> {
  const app = await buildApp({ now: () => NOW, database: await openTestDb(), staticDir: new URL("../../web/public", import.meta.url).pathname, ...extra });
  if (seed) await seedDb(app.db, syntheticCatalog());
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const client = (): Client => {
    const jar = new Map<string, string>();
    const call: Client["call"] = async (method, path, body, headers = {}) => {
      const slug = /^\/t\/([^/]+)/.exec(path)?.[1] ?? "";
      const cookie = jar.get(slug);
      const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
      const set = r.headers.get("set-cookie");
      if (set) { const pair = set.split(";")[0]!; if (pair.endsWith("=")) jar.delete(slug); else jar.set(slug, pair); }
      const text = await r.text(); let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
      return { status: r.status, body: json, text, headers: r.headers };
    };
    return {
      call, jar, get: (p) => call("GET", p), post: (p, b, h) => call("POST", p, b ?? {}, h),
      signup: (slug, over = {}) => call("POST", `/t/${slug}/api/auth/signup`, signupBody(over, slug === "bayview-care" ? "bay" : "north")),
    };
  };
  return { app, base, server: app.server, client, close: async () => { await new Promise<void>((r) => app.server.close(() => r())); await app.db.close(); } };
}
