import type { IncomingMessage, ServerResponse } from "node:http";
import type { buildApp } from "./index.js";

type App = Awaited<ReturnType<typeof buildApp>>;

/**
 * Adapts the CareX HTTP server to a serverless request handler (Vercel). The app is built once per warm instance and reused.
 * `/healthz` answers without touching the tenant routes and checks that the database is reachable.
 */
export function createHandler(init: () => Promise<App>) {
  let app: Promise<App> | undefined;
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      app ??= init().catch((e) => { app = undefined; throw e; });         // a failed cold start is retried on the next request
      const a = await app;
      if (req.method === "GET" && (req.url ?? "").split("?")[0] === "/healthz") {
        await a.db.get("SELECT 1 AS ok");
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end('{"ok":true}'); return;
      }
      a.server.emit("request", req, res);
    } catch (e) {
      // Log what failed (never the connection string) so the cause is visible in the platform's logs.
      const err = e as { name?: string; code?: string; message?: string };
      console.log(JSON.stringify({ event: "startup_or_request_failed", name: err?.name, code: err?.code, message: String(err?.message ?? "").replace(/postgres(ql)?:\/\/\S+/gi, "[redacted-url]").slice(0, 200) }));
      if (!res.headersSent) { res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" }); res.end('{"error":{"code":"unavailable","message":"Service temporarily unavailable"}}'); }
    }
  };
}
