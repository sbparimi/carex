"""A calendar file (.ics) for one appointment, so a patient can add it to any calendar app."""
from __future__ import annotations

from .util import parse


def _esc(s: str) -> str:
    out = str(s).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    return out.replace("\r", "").replace("\n", "\\n")


def _stamp(s: str) -> str:
    return parse(s).strftime("%Y%m%dT%H%M%SZ")


def appointment_ics(booking_id: str, summary: dict, host: str, now_iso: str, status: str = "confirmed") -> str:
    clinic, visit, prov = summary["clinic"], summary["visit_type"], summary["provider"]
    where = "Video visit" if summary.get("modality") == "telehealth" else f"{clinic['name']}, {clinic['address']}, {clinic['city']}, {clinic['state_code']}"
    desc = f"{visit['label']} with {prov['display_name']}. Reference {booking_id}."
    if summary.get("join_url"):
        desc += f" Join: {summary['join_url']}"
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CareX//Appointments//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
             f"UID:{booking_id}@{host}", f"DTSTAMP:{_stamp(now_iso)}", f"DTSTART:{_stamp(summary['starts_at'])}", f"DTEND:{_stamp(summary['ends_at'])}",
             f"SUMMARY:{_esc(visit['label'] + ' · ' + clinic['name'])}", f"LOCATION:{_esc(where)}", f"DESCRIPTION:{_esc(desc)}",
             f"STATUS:{'CANCELLED' if status == 'cancelled' else 'CONFIRMED'}",
             "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Appointment reminder", "TRIGGER:-PT2H", "END:VALARM", "END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(lines) + "\r\n"
