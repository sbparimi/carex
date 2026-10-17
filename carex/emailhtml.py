"""HTML for appointment emails. Email clients ignore stylesheets, so every style is inline; all values are escaped. A plain-text part is always sent too."""
from __future__ import annotations

import re
from html import escape as e

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

# kind -> (headline, lead sentence, button label)
COPY = {
    "confirmation": ("Your appointment is confirmed", "We have saved your time. Here are the details.", "Manage appointment"),
    "reminder_24h": ("Your appointment is tomorrow", "A reminder about your appointment in about 24 hours.", "Change or cancel"),
    "reminder_2h": ("Starting in about 2 hours", "Your appointment is coming up soon.", "View appointment"),
    "cancellation": ("Your appointment is cancelled", "This time has been released.", "Book a new time"),
    "rescheduled": ("Your appointment has a new time", "Your appointment was moved. Here is the new time.", "Manage appointment"),
    "waitlist_open": ("A time just opened up", "Times like this go quickly.", "Book this time"),
}


def render_html(r: dict, kind: str, *, details: dict, link: str, extra: str = "") -> str | None:
    copy = COPY.get(kind)
    if not copy:
        return None
    head, lead, button = copy
    color = r.get("primary_color") if _HEX.match(r.get("primary_color") or "") else "#1b6fb5"
    rows = "".join(
        f'<tr><td style="padding:6px 16px 6px 0;color:#5b6770;font:13px Arial,sans-serif;vertical-align:top;white-space:nowrap">{e(k)}</td>'
        f'<td style="padding:6px 0;color:#14202b;font:15px Arial,sans-serif">{e(v)}</td></tr>' for k, v in details.items() if v)
    table = f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0">{rows}</table>' if rows else ""
    extra_html = f'<p style="margin:0 0 18px;color:#14202b;font:14px/1.5 Arial,sans-serif">{e(extra)}</p>' if extra else ""
    contact = " · ".join(x for x in (r.get("tenant_name"), r.get("support_phone"), r.get("support_email")) if x)
    return f"""<!doctype html><html lang="en"><body style="margin:0;background:#f3f6f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px">
<tr><td style="height:6px;background:{color};border-radius:8px 8px 0 0;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px;font:bold 15px Arial,sans-serif;color:{color}">{e(r.get('tenant_name') or '')}</td></tr>
<tr><td style="padding:0 32px"><h1 style="margin:0 0 8px;font:bold 24px/1.25 Arial,sans-serif;color:#14202b">{e(head)}</h1>
<p style="margin:0;color:#14202b;font:15px/1.5 Arial,sans-serif">Hi {e(r.get('first_name') or 'there')}, {e(lead)}</p>
{table}{extra_html}
<p style="margin:0 0 24px"><a href="{e(link, quote=True)}" style="display:inline-block;background:{color};color:#ffffff;text-decoration:none;font:bold 15px Arial,sans-serif;padding:12px 28px;border-radius:24px">{e(button)}</a></p></td></tr>
<tr><td style="padding:16px 32px 28px;border-top:1px solid #e3e8ed;color:#5b6770;font:12px/1.5 Arial,sans-serif">This is not for emergencies. In an emergency call 911.<br>{e(contact)}</td></tr>
</table></td></tr></table></body></html>"""
