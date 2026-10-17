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


def clock(iso: str, tz: str) -> str:
    """Time only, e.g. 8:00 AM (the time zone is shown once per day, not on every button)."""
    return _hm(parse(iso).astimezone(zone(tz)))


def day_parts(iso: str, tz: str) -> dict:
    d = parse(iso).astimezone(zone(tz))
    return {"weekday": d.strftime("%a"), "day": d.day, "month": d.strftime("%b"), "full": f"{d.strftime('%A')}, {d.strftime('%B')} {d.day}", "tz": d.tzname()}


ZONE_NAMES = {"America/Los_Angeles": "Pacific Time", "America/Denver": "Mountain Time", "America/Chicago": "Central Time", "America/New_York": "Eastern Time",
              "America/Phoenix": "Mountain Time (Arizona)", "America/Anchorage": "Alaska Time", "Pacific/Honolulu": "Hawaii Time", "America/Puerto_Rico": "Atlantic Time",
              "Pacific/Pago_Pago": "Samoa Time", "Pacific/Guam": "Chamorro Time", "Pacific/Saipan": "Chamorro Time", "America/St_Thomas": "Atlantic Time"}


def zone_name(tz: str) -> str:
    return ZONE_NAMES.get(tz, tz.replace("_", " ").split("/")[-1])
