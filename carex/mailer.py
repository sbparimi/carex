"""Outbound email (Resend) and SMS (Twilio) over plain HTTPS using only the standard library. A channel whose environment variables are missing is left
unconfigured; the notifier then skips it with a clear reason instead of losing the message silently."""
from __future__ import annotations

import base64
import json
import logging
import os
import urllib.parse
import urllib.request
from typing import Mapping

from .notify import Channels

log = logging.getLogger("carex.mailer")


def _post(url: str, headers: dict, body: bytes, what: str) -> None:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=8) as r:   # noqa: S310 (fixed https URLs)
            if r.status >= 300:
                raise RuntimeError(f"{what} provider returned {r.status}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{what} provider returned {e.code}") from None


def base_url_from_env(env: Mapping[str, str]) -> str:
    if env.get("APP_BASE_URL"):
        return env["APP_BASE_URL"].rstrip("/")
    if env.get("VERCEL_PROJECT_PRODUCTION_URL"):
        return "https://" + env["VERCEL_PROJECT_PRODUCTION_URL"]
    return "http://localhost:8000"


def channels_from_env(env: Mapping[str, str] = os.environ) -> Channels:
    ch = Channels(base_url=base_url_from_env(env))
    if env.get("RESEND_API_KEY") and env.get("EMAIL_FROM"):
        key, sender = env["RESEND_API_KEY"], env["EMAIL_FROM"]
        ch.email = lambda to, subject, text: _post("https://api.resend.com/emails", {"authorization": f"Bearer {key}", "content-type": "application/json"},
                                                    json.dumps({"from": sender, "to": [to], "subject": subject, "text": text}).encode(), "email")
    if env.get("TWILIO_ACCOUNT_SID") and env.get("TWILIO_AUTH_TOKEN") and env.get("TWILIO_FROM"):
        sid, tok, sender = env["TWILIO_ACCOUNT_SID"], env["TWILIO_AUTH_TOKEN"], env["TWILIO_FROM"]
        auth = base64.b64encode(f"{sid}:{tok}".encode()).decode()
        ch.sms = lambda to, text: _post(f"https://api.twilio.com/2010-04-01/Accounts/{urllib.parse.quote(sid)}/Messages.json",
                                        {"authorization": f"Basic {auth}", "content-type": "application/x-www-form-urlencoded"},
                                        urllib.parse.urlencode({"To": to, "From": sender, "Body": text}).encode(), "sms")
    return ch


class AccountMailer:
    """Password-reset links and sign-in codes. With no email provider: printed to the console in development, dropped in production."""

    def __init__(self, ch: Channels, production: bool):
        self.ch, self.production = ch, production

    def _send(self, to: str, subject: str, text: str) -> None:
        if self.ch.email:
            self.ch.email(to, subject, text)
        elif not self.production:
            print(f"\n--- email (development, not sent) to {to}: {subject}\n{text}\n---", flush=True)

    def send_password_reset(self, to: str, tenant_slug: str, token: str) -> None:
        link = f"{self.ch.base_url.rstrip('/')}/t/{urllib.parse.quote(tenant_slug)}/reset?token={urllib.parse.quote(token)}"
        self._send(to, "Reset your password", f"We received a request to reset your password.\n\nChoose a new password: {link}\n\nThe link works once and expires in 30 minutes. If you did not ask for this, you can ignore this email.")

    def send_login_code(self, to: str, tenant_name: str, code: str) -> None:
        self._send(to, f"Your {tenant_name} sign-in code", f"Your sign-in code is {code}.\n\nIt works once and expires in 10 minutes. If you did not try to sign in, change your password.")
