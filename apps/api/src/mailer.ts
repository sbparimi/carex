import type { Mailer } from "./accounts.js";

export interface ResendOptions { apiKey: string; from: string; baseUrl: string; fetchImpl?: typeof fetch }

/**
 * Sends password-reset email through Resend's HTTP API (no SDK, no extra dependency).
 * The link carries the single-use token in the URL fragment, so it is never sent to a server by the browser's request line or logged by proxies.
 * Nothing secret is logged; failures are swallowed by the caller's generic "if that email has an account" reply.
 */
export function resendMailer(o: ResendOptions): Mailer {
  const doFetch = o.fetchImpl ?? fetch;
  return {
    async sendPasswordReset(to, slug, token) {
      const link = `${o.baseUrl.replace(/\/$/, "")}/t/${encodeURIComponent(slug)}/reset#token=${encodeURIComponent(token)}`;
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: o.from, to: [to], subject: "Reset your password",
          text: `We received a request to reset your password.\n\nChoose a new password: ${link}\n\nThe link works once and expires in 30 minutes. If you did not ask for this, you can ignore this email.`,
        }),
      });
      if (!res.ok) throw new Error(`email provider returned ${res.status}`);
    },
  };
}

/** Picks the mailer from the environment: Resend when configured, otherwise `fallback` (development logger or a no-op). */
export function mailerFromEnv(env: NodeJS.ProcessEnv, fallback: Mailer): Mailer {
  const apiKey = env.RESEND_API_KEY, from = env.EMAIL_FROM;
  const baseUrl = env.APP_BASE_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return apiKey && from && baseUrl ? resendMailer({ apiKey, from, baseUrl }) : fallback;
}
