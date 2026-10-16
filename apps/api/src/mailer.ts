import type { Mailer } from "./accounts.js";
import type { Channels } from "./notify.js";

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
    async sendLoginCode(to, tenantName, code) {
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST", headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: o.from, to: [to], subject: `Your ${tenantName} sign-in code`, text: `Your sign-in code is ${code}.\n\nIt works once and expires in 10 minutes. If you did not try to sign in, change your password.` }),
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

export interface TwilioOptions { accountSid: string; authToken: string; from: string; fetchImpl?: typeof fetch }

/** Email (Resend) and SMS (Twilio) senders from the environment. A channel whose variables are missing is left undefined; the notifier then skips it with a clear reason. */
export function channelsFromEnv(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): Channels {
  const doFetch = fetchImpl ?? fetch;
  const baseUrl = env.APP_BASE_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:8080");
  const ch: Channels = { baseUrl };
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    const key = env.RESEND_API_KEY, from = env.EMAIL_FROM;
    ch.email = async (m) => {
      const res = await doFetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }) });
      if (!res.ok) throw new Error(`email provider returned ${res.status}`);
    };
  }
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) {
    const sid = env.TWILIO_ACCOUNT_SID, token = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM;
    ch.sms = async (m) => {
      const res = await doFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST", headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: m.to, From: from, Body: m.text }).toString(),
      });
      if (!res.ok) throw new Error(`sms provider returned ${res.status}`);
    };
  }
  return ch;
}
