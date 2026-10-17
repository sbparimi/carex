"""Small shared helpers: timestamps, hashing, tokens, references, time zones."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = timezone.utc
MINUTE = 60_000
DAY = 86_400_000


def now() -> datetime:
    return datetime.now(UTC)


def iso(dt: datetime) -> str:
    """ISO-8601 UTC with milliseconds and a Z (sorts lexicographically as time)."""
    dt = dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)


def ms(dt_or_s) -> int:
    d = parse(dt_or_s) if isinstance(dt_or_s, str) else dt_or_s
    return int(d.timestamp() * 1000)


def from_ms(v: int) -> datetime:
    return datetime.fromtimestamp(v / 1000, UTC)


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def token() -> str:
    return secrets.token_urlsafe(32)


def safe_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


_ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def booking_reference() -> str:
    """Patient-facing reference, e.g. CX-7K3M-9PQ2 (Crockford base32, 40 random bits)."""
    s = "".join(_ALPHA[b & 31] for b in secrets.token_bytes(8))
    return f"CX-{s[:4]}-{s[4:]}"


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as e:
        raise ValueError(f"Unknown time zone {name}") from e


def local_parts(instant: datetime, tz: str) -> dict:
    d = instant.astimezone(zone(tz))
    return {"year": d.year, "month": d.month, "day": d.day, "weekday": (d.weekday() + 1) % 7,  # 0 = Sunday
            "minute_of_day": d.hour * 60 + d.minute}


def zoned_to_utc(year: int, month: int, day: int, minute_of_day: int, tz: str) -> datetime | None:
    """UTC instant for a wall-clock time. None when the local time doesn't exist (spring-forward gap); first occurrence when ambiguous."""
    z = zone(tz)
    naive = datetime(year, month, day) + timedelta(minutes=minute_of_day)
    local = naive.replace(tzinfo=z, fold=0)
    back = local.astimezone(UTC).astimezone(z)
    if back.replace(tzinfo=None) != naive:
        return None
    return local.astimezone(UTC)


def age_on(dob: str, at: datetime) -> int:
    y, m, d = (int(x) for x in dob[:10].split("-"))
    a = at.year - y
    if at.month < m or (at.month == m and at.day < d):
        a -= 1
    return a
