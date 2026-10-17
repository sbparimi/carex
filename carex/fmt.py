"""Date and time display in a clinic's time zone."""
from __future__ import annotations

from .util import parse, zone


def _hm(d) -> str:
    h = d.hour % 12 or 12
    return f"{h}:{d.minute:02d} {'AM' if d.hour < 12 else 'PM'}"


def day_label(iso: str, tz: str) -> str:
    d = parse(iso).astimezone(zone(tz))
    return f"{d.strftime('%A')}, {d.strftime('%B')} {d.day}"


def time_label(iso: str, tz: str) -> str:
    d = parse(iso).astimezone(zone(tz))
    return f"{_hm(d)} {d.tzname()}"


def when(iso: str, tz: str) -> str:
    return f"{day_label(iso, tz)} at {time_label(iso, tz)}"
