import { describe, it, expect } from "vitest";
import { createServer as http } from "node:http";
import { openTestDb, seedDb } from "../src/db.js";
import { syntheticCatalog } from "../src/seed.js";
import { buildApp } from "../src/index.js";
import { createHandler } from "../src/handler.js";
import { resendMailer, mailerFromEnv } from "../src/mailer.js";

describe("serverless handler", () => {
  it("serves health, pages and the API through the handler, trusts the proxy address, and recovers from a failed cold start", async () => {
    const db = await openTestDb(); await seedDb(db, syntheticCatalog());
    let calls = 0;
    const handler = createHandler(async () => { calls++; if (calls === 1) throw new Error("cold start failed"); return buildApp({ database: db, trustProxy: true, staticDir: new URL("../../web/public", import.meta.url).pathname }); });
    const srv = http((q, r) => void handler(q, r)); await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    expect((await fetch(`${base}/healthz`)).status).toBe(503);                         // first cold start failed: generic 503
    const ok = await fetch(`${base}/healthz`); expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ ok: true });
    const page = await fetch(`${base}/t/northwind-health/login`); expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).not.toMatch(/unsafe-inline/);
    expect((await fetch(`${base}/t/northwind-health/api/clinics`)).status).toBe(401);
    expect(calls).toBe(2);
    srv.close();
  });
});

describe("mailer", () => {
  it("posts the reset link to Resend with the key in the header, and the token in the URL fragment", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const m = resendMailer({ apiKey: "re_test_key", from: "CareX <no-reply@example.test>", baseUrl: "https://app.example.test/", fetchImpl: (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch });
    await m.sendPasswordReset("pat@example.test", "northwind-health", "tok_abc-123");
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(String(seen!.init.body));
    expect(body.to).toEqual(["pat@example.test"]); expect(body.text).toContain("https://app.example.test/t/northwind-health/reset#token=tok_abc-123");
  });
  it("throws when the provider refuses, and falls back when not configured", async () => {
    const bad = resendMailer({ apiKey: "k", from: "f", baseUrl: "https://x.test", fetchImpl: (async () => new Response("no", { status: 403 })) as unknown as typeof fetch });
    await expect(bad.sendPasswordReset("a@b.test", "s", "t")).rejects.toThrow();
    const fb = { async sendPasswordReset() {} };
    expect(mailerFromEnv({}, fb)).toBe(fb);
    expect(mailerFromEnv({ RESEND_API_KEY: "k", EMAIL_FROM: "f", APP_BASE_URL: "https://x.test" }, fb)).not.toBe(fb);
  });
});
