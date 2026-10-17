"""Emergency screening (server-enforced). The patient is asked about red-flag symptoms before booking; any positive answer, or an emergency
phrase in the free-text reason, stops the booking and shows emergency instructions. Booking never proceeds past a positive screen.

CLINICAL SIGN-OFF REQUIRED: this list is a conservative starting set. A licensed clinician must review and own it before production use
(docs/product/08-adr-clinical-intake-and-operations.md)."""
from __future__ import annotations

import re

RED_FLAGS = [
    {"key": "chest_pain", "label": "Chest pain, pressure or tightness"},
    {"key": "breathing", "label": "Severe trouble breathing or can't speak full sentences"},
    {"key": "stroke", "label": "Sudden weakness, numbness, facial droop, confusion or trouble speaking"},
    {"key": "bleeding", "label": "Bleeding that won't stop or a serious injury"},
    {"key": "self_harm", "label": "Thoughts of harming yourself or someone else"},
    {"key": "unresponsive", "label": "Fainting, seizure or being unresponsive"},
    {"key": "allergic", "label": "Swelling of the face or throat, or a severe allergic reaction"},
    {"key": "overdose", "label": "A possible overdose or poisoning"},
]
KEYS = {f["key"] for f in RED_FLAGS}

PHRASES = [re.compile(p, re.I) for p in (
    r"chest (pain|pressure|tightness)", r"can'?t breathe|cannot breathe|trouble breathing|short(ness)? of breath", r"\bstroke\b|face droop|slurred speech",
    r"suicid|kill (myself|him|her|them)|end my life|self[- ]harm|hurt myself", r"overdos|poison", r"heart attack", r"unconscious|unresponsive|seizure",
    r"severe bleeding|won'?t stop bleeding|anaphyla",
)]

EMERGENCY_MESSAGE = ("Based on your answers, this may be an emergency. Do not book online: call 911 now or go to the nearest emergency room. "
                     "If you are thinking about harming yourself, call or text 988 (Suicide & Crisis Lifeline) right away.")


def screen(reason: str | None, flags: list[str] | None) -> dict:
    """`flags` must be present (possibly empty) when screening is required; None means the patient was never asked."""
    if flags is None:
        return {"emergency": False, "screened": False}
    if any(f in KEYS for f in flags) or (reason and any(p.search(reason) for p in PHRASES)):
        return {"emergency": True, "screened": True, "message": EMERGENCY_MESSAGE}
    return {"emergency": False, "screened": True}
