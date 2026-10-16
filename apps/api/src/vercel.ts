// Vercel entry (ADR-007). Built by `npm run build:vercel` into dist/vercel.mjs and re-exported from api/index.js.
import { resolve } from "node:path";
import { buildApp } from "./index.js";
import { createHandler } from "./handler.js";
import { channelsFromEnv, mailerFromEnv } from "./mailer.js";
import type { Mailer } from "./accounts.js";

const noMailer: Mailer = { async sendPasswordReset() { console.log(JSON.stringify({ event: "password_reset_requested_no_mailer" })); } };

export default createHandler(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return buildApp({
    db: { url }, mailer: mailerFromEnv(process.env, noMailer), channels: channelsFromEnv(process.env), ...(process.env.CRON_SECRET ? { cronSecret: process.env.CRON_SECRET } : {}),
    secureCookies: true, trustProxy: true,
    staticDir: resolve(process.cwd(), "apps/web/public"),
    log: (e) => console.log(JSON.stringify(e)),
  });
});
