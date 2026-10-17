"""Clinical intake: patients (self + dependents), consent, screening, referral, telehealth licensure and coverage, evaluated server-side before any slot is held."""
from __future__ import annotations

import json
import re
import secrets
from datetime import datetime
from typing import Callable

from .triage import screen
from .util import age_on, iso, now as _now, parse

CONSENT_TEXT = ("I consent to evaluation and treatment by the clinic's providers, including by video if I choose a video visit. I understand I can cancel or change this appointment up to the notice time shown, "
                "and that this service is not for emergencies. I confirm the information I entered is accurate and that I am the patient or the patient's parent or legal guardian.")  # LEGAL REVIEW REQUIRED
INTERPRETER_LANGUAGES = ["Spanish", "Mandarin", "Cantonese", "Vietnamese", "Tagalog", "Korean", "Arabic", "Russian", "American Sign Language", "Other"]
RELATIONSHIPS = ("child", "spouse", "parent", "other")
_PCOLS = "id, relationship, first_name, last_name, date_of_birth"
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class IntakeError(Exception):
    """A booking was refused for a clinical, coverage or policy reason. The code is stable; the message is patient-facing."""
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _patient(r: dict) -> dict:
    return {"id": r["id"], "relationship": r["relationship"], "first_name": r["first_name"], "last_name": r["last_name"], "date_of_birth": r["date_of_birth"]}


class Intake:
    def __init__(self, db, clock: Callable[[], datetime] = _now):
        self.db, self.now = db, clock

    def config(self, tenant_id: str) -> dict:
        t = self.db.get("SELECT intake_required, consent_version, video_join_base_url FROM tenants WHERE id = ?", tenant_id) or {}
        return {"intake_required": t.get("intake_required") == 1, "consent_version": t.get("consent_version", "v1"), "consent_text": CONSENT_TEXT,
                "interpreter_languages": INTERPRETER_LANGUAGES, "telehealth": bool(t.get("video_join_base_url"))}

    def ensure_self(self, tenant_id: str, user_id: str) -> dict:
        have = self.db.get(f"SELECT {_PCOLS} FROM patients WHERE tenant_id = ? AND user_id = ? AND relationship = 'self'", tenant_id, user_id)
        if have:
            return _patient(have)
        u = self.db.get("SELECT first_name, last_name, date_of_birth FROM users WHERE tenant_id = ? AND id = ?", tenant_id, user_id)
        if not u:
            raise IntakeError("patient_not_found", "Account not found")
        pid = f"pt_self_{user_id}"
        self.db.run("INSERT INTO patients (id, tenant_id, user_id, relationship, first_name, last_name, date_of_birth, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
                    pid, tenant_id, user_id, "self", u["first_name"], u["last_name"], u["date_of_birth"], iso(self.now()))
        return {"id": pid, "relationship": "self", "first_name": u["first_name"], "last_name": u["last_name"], "date_of_birth": u["date_of_birth"]}

    def list(self, tenant_id: str, user_id: str) -> list[dict]:
        self.ensure_self(tenant_id, user_id)
        rows = self.db.all(f"SELECT {_PCOLS} FROM patients WHERE tenant_id = ? AND user_id = ? ORDER BY (relationship = 'self') DESC, created_at, id", tenant_id, user_id)
        return [_patient(r) for r in rows]

    def add_dependent(self, tenant_id: str, user_id: str, relationship: str, first_name: str, last_name: str, date_of_birth: str) -> dict:
        fields: dict[str, str] = {}
        if relationship not in RELATIONSHIPS:
            fields["relationship"] = "Choose how this person is related to you"
        first, last, dob = (first_name or "").strip(), (last_name or "").strip(), date_of_birth or ""
        if not first or len(first) > 80:
            fields["first_name"] = "Enter a first name"
        if not last or len(last) > 80:
            fields["last_name"] = "Enter a last name"
        try:
            bad = not _DATE.match(dob) or parse(dob + "T00:00:00Z") > self.now()
        except ValueError:
            bad = True
        if bad:
            fields["date_of_birth"] = "Enter a valid date of birth"
        if fields:
            raise IntakeError("invalid_patient", next(iter(fields.values())))
        if len(self.list(tenant_id, user_id)) >= 12:
            raise IntakeError("too_many_patients", "You can add up to 11 family members")
        pid = "pt_" + secrets.token_urlsafe(9)
        self.db.run("INSERT INTO patients (id, tenant_id, user_id, relationship, first_name, last_name, date_of_birth, created_at) VALUES (?,?,?,?,?,?,?,?)",
                    pid, tenant_id, user_id, relationship, first, last, dob, iso(self.now()))
        return {"id": pid, "relationship": relationship, "first_name": first, "last_name": last, "date_of_birth": dob}

    def remove_dependent(self, tenant_id: str, user_id: str, patient_id: str) -> bool:
        if self.db.get("SELECT 1 AS ok FROM appointments WHERE tenant_id = ? AND patient_id = ? AND status <> 'cancelled' LIMIT 1", tenant_id, patient_id):
            raise IntakeError("patient_in_use", "This person has appointments. Cancel them first.")
        return self.db.run("DELETE FROM patients WHERE tenant_id = ? AND user_id = ? AND id = ? AND relationship <> 'self'", tenant_id, user_id, patient_id) > 0

    def prepare(self, tenant_id: str, user_id: str, req: dict) -> dict:
        t = self.db.get("SELECT intake_required, consent_version, video_join_base_url FROM tenants WHERE id = ?", tenant_id)
        if not t:
            raise IntakeError("not_found", "selection is not available")
        required = t["intake_required"] == 1
        if req.get("patient_id"):
            patient = self.db.get(f"SELECT {_PCOLS} FROM patients WHERE tenant_id = ? AND user_id = ? AND id = ?", tenant_id, user_id, req["patient_id"])
        else:
            patient = self.ensure_self(tenant_id, user_id)
        if not patient:
            raise IntakeError("patient_not_found", "We couldn't find that person on your account.")
        c = self._checks(tenant_id, req, dob=patient["date_of_birth"], patient_id=patient["id"], consent_required=required, consent_version=t["consent_version"], video_base=t["video_join_base_url"])
        copay = self.coverage(tenant_id, user_id, req["clinic_id"], req["service_id"])
        return {"patient_id": patient["id"], "patient_first_name": patient["first_name"], "patient_last_name": patient["last_name"], "reason": c["reason"], "modality": c["modality"],
                "patient_state": c["state"], "interpreter_language": (req.get("interpreter_language") or "").strip() or None, "accommodations": (req.get("accommodations") or "").strip() or None,
                "referral_ref": c["referral"], "copay_cents": copay, "consent_version": t["consent_version"] if required or req.get("consent_version") else None,
                "video_join_base": t["video_join_base_url"], "intake_required": required}

    def prepare_for_staff(self, tenant_id: str, patient: dict, req: dict) -> dict:
        """Intake for a patient a staff member is booking by phone or at the desk (no account). Same safety rules as self-service: the screening script
        must have been read (red_flags present), a positive stops the booking, and verbal consent must be attested."""
        t = self.db.get("SELECT consent_version, video_join_base_url FROM tenants WHERE id = ?", tenant_id)
        if not t:
            raise IntakeError("not_found", "selection is not available")
        if req.get("consent_attested") is not True:
            raise IntakeError("consent_required", "Confirm the patient gave verbal consent to treatment.")
        c = self._checks(tenant_id, {**req, "consent_version": t["consent_version"]}, dob=patient.get("date_of_birth"), patient_id=None, consent_required=True,
                         consent_version=t["consent_version"], video_base=t["video_join_base_url"], staff=True)
        return {"patient_id": "", "patient_first_name": patient["first_name"], "patient_last_name": patient["last_name"], "reason": c["reason"], "modality": c["modality"],
                "patient_state": c["state"], "interpreter_language": (req.get("interpreter_language") or "").strip() or None, "accommodations": (req.get("accommodations") or "").strip() or None,
                "referral_ref": c["referral"], "copay_cents": 0, "consent_version": t["consent_version"], "video_join_base": t["video_join_base_url"], "intake_required": True}

    def _checks(self, tenant_id: str, req: dict, *, dob, patient_id, consent_required: bool, consent_version: str, video_base, staff: bool = False) -> dict:
        """Screening, consent, age, referral, modality/licensure and new-patient acceptance: identical for self-service and staff bookings."""
        required = consent_required
        sc = screen(req.get("reason"), req.get("red_flags"))
        if sc["emergency"]:
            raise IntakeError("emergency_redirect", sc["message"])
        if required and not sc["screened"]:
            raise IntakeError("screening_required", "Please answer the safety questions before booking.")
        if required and len((req.get("reason") or "").strip()) < 3:
            raise IntakeError("reason_required", "Tell us briefly what the visit is for.")
        if required and req.get("consent_version") != consent_version:
            raise IntakeError("consent_required", "Please review and accept the consent to treatment to continue.")
        v = self.db.get("SELECT modality, requires_referral, min_age, max_age FROM visit_types WHERE tenant_id = ? AND id = ?", tenant_id, req["service_id"])
        if not v:
            raise IntakeError("not_found", "selection is not available")
        age = age_on(dob, self.now()) if dob else None
        if age is None and (v["min_age"] is not None or v["max_age"] is not None):
            raise IntakeError("dob_required", "Enter the patient's date of birth: this visit has an age range.")
        if age is not None and ((v["min_age"] is not None and age < v["min_age"]) or (v["max_age"] is not None and age > v["max_age"])):
            raise IntakeError("patient_not_allowed", "This visit isn't available for this patient's age.")
        referral = (req.get("referral_ref") or "").strip()
        if v["requires_referral"] == 1 and not referral:
            raise IntakeError("referral_required", "This visit needs a referral. Enter your referral number.")
        modality = (req.get("modality") or "in_person") if v["modality"] == "either" else v["modality"]
        if req.get("modality") and req["modality"] != modality:
            raise IntakeError("modality_not_offered", f"This visit is only available {'by video' if v['modality'] == 'telehealth' else 'in person'}.")
        prov = self.db.get("SELECT display_name, licensed_states, accepting_new FROM providers WHERE tenant_id = ? AND id = ?", tenant_id, req["provider_id"])
        if not prov:
            raise IntakeError("not_found", "selection is not available")
        state = None
        if modality == "telehealth":
            if not video_base:
                raise IntakeError("telehealth_unavailable", "Video visits aren't available yet. Please choose an in-person visit.")
            state = req.get("patient_state") or None
            if not state:
                raise IntakeError("patient_state_required", "Tell us the state you'll be in during the video visit.")
            if state not in json.loads(prov["licensed_states"] or "[]"):
                raise IntakeError("not_licensed_in_state", f"{prov['display_name']} can't see patients by video in {state}. Try another provider or an in-person visit.")
        if prov["accepting_new"] == 0:
            seen = patient_id and self.db.get("SELECT 1 AS ok FROM appointments WHERE tenant_id = ? AND patient_id = ? AND provider_id = ? AND status IN ('arrived','completed') LIMIT 1", tenant_id, patient_id, req["provider_id"])
            if not seen and not staff:
                raise IntakeError("provider_not_accepting_new", f"{prov['display_name']} isn't accepting new patients. Choose another provider.")
        return {"reason": (req.get("reason") or "").strip() or None, "modality": modality, "state": state, "referral": referral or None}

    def coverage(self, tenant_id: str, user_id: str, clinic_id: str, service_id: str) -> int:
        """What the signed-in account's plan says about this visit. Raises when it isn't covered or the clinic is out of network."""
        u = self.db.get("SELECT employer_id, insurer_id FROM users WHERE tenant_id = ? AND id = ?", tenant_id, user_id)
        if not u:
            raise IntakeError("patient_not_found", "Account not found")
        if u["insurer_id"]:
            n = self.db.get("SELECT COUNT(*) AS n FROM insurer_networks WHERE tenant_id = ? AND insurer_id = ?", tenant_id, u["insurer_id"])
            if n and int(n["n"]) > 0 and not self.db.get("SELECT 1 AS ok FROM insurer_networks WHERE tenant_id = ? AND insurer_id = ? AND clinic_id = ?", tenant_id, u["insurer_id"], clinic_id):
                raise IntakeError("out_of_network", "This clinic isn't in your plan's network. Choose an in-network clinic.")
        rule = self.db.get("""SELECT covered, copay_cents FROM coverage_rules WHERE tenant_id = ? AND visit_type_id = ? AND (employer_id = ? OR insurer_id = ? OR (employer_id IS NULL AND insurer_id IS NULL))
                               ORDER BY (employer_id IS NOT NULL OR insurer_id IS NOT NULL) DESC LIMIT 1""", tenant_id, service_id, u["employer_id"], u["insurer_id"])
        if not rule:
            return 0
        if rule["covered"] == 0:
            raise IntakeError("not_covered", "This visit isn't covered by your plan.")
        return int(rule["copay_cents"])

    def preview(self, tenant_id: str, user_id: str, clinic_id: str, service_id: str) -> dict:
        """Coverage preview for the booking screen. Never raises for a plain "not covered": it reports it."""
        try:
            return {"covered": True, "copay_cents": self.coverage(tenant_id, user_id, clinic_id, service_id)}
        except IntakeError as e:
            return {"covered": False, "copay_cents": 0, "reason": str(e)}
