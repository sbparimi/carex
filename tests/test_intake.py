"""Consent, patients, referral, telehealth licensure and coverage."""
from __future__ import annotations

import pytest

from carex.accounts import Accounts
from carex.intake import IntakeError
from carex.triage import CRISIS, NOTICE


@pytest.fixture
def user(ctx):
    ctx.db.run("UPDATE tenants SET intake_required = 1, video_join_base_url = 'https://video.example.test/join'")
    p, _ = Accounts(ctx.db, ctx.clock).signup("tn-north", email="u@x.com", password="correct horse 1", first_name="Una", last_name="User", date_of_birth="1990-01-01",
                                               phone="555-111-2222", access_type="employer", access_id="em-n-1")
    return p


def req(**kw):
    return {"clinic_id": "cl-sb", "service_id": "sv-pc-n", "provider_id": "pr-a", "slot_id": "x", "reason": "Cough", "red_flags": [], "consent_version": "v1", **kw}


def code(ctx, user, **kw):
    with pytest.raises(IntakeError) as e:
        ctx.intake.prepare("tn-north", user["id"], req(**kw))
    return e.value.code


def test_symptom_words_never_block_or_warn_the_booking(ctx, user):
    """The 911 text is purely informational: nothing a patient types or selects is screened."""
    for kw in ({"reason": "chest pain since morning"}, {"red_flags": ["breathing"]}, {"red_flags": None}):
        d = ctx.intake.prepare("tn-north", user["id"], req(**kw))
        assert "emergency" not in d and d["patient_id"].startswith("pt_self_")


def test_required_intake_fields(ctx, user):
    assert code(ctx, user, reason="") == "reason_required"
    assert code(ctx, user, consent_version=None) == "consent_required"
    assert ctx.intake.prepare("tn-north", user["id"], req())["patient_id"].startswith("pt_self_")


def test_intake_off_does_not_block_a_plain_booking(ctx, user):
    ctx.db.run("UPDATE tenants SET intake_required = 0")
    d = ctx.intake.prepare("tn-north", user["id"], req(red_flags=None, reason=None, consent_version=None))
    assert d["intake_required"] is False and d["consent_version"] is None


def test_dependents_are_limited_validated_and_removable(ctx, user):
    kid = ctx.intake.add_dependent("tn-north", user["id"], "child", "Kid", "User", "2015-05-05")
    assert [p["relationship"] for p in ctx.intake.list("tn-north", user["id"])] == ["self", "child"]
    for bad in (("pet", "A", "B", "2015-05-05"), ("child", "", "B", "2015-05-05"), ("child", "A", "B", "2999-01-01"), ("child", "A", "B", "yesterday")):
        with pytest.raises(IntakeError) as e:
            ctx.intake.add_dependent("tn-north", user["id"], *bad)
        assert e.value.code == "invalid_patient"
    for i in range(10):
        ctx.intake.add_dependent("tn-north", user["id"], "other", f"P{i}", "X", "2000-01-01")
    with pytest.raises(IntakeError) as e:
        ctx.intake.add_dependent("tn-north", user["id"], "other", "Extra", "X", "2000-01-01")
    assert e.value.code == "too_many_patients"
    assert ctx.intake.remove_dependent("tn-north", user["id"], kid["id"])
    assert not ctx.intake.remove_dependent("tn-north", user["id"], "pt_nope")


def test_a_patient_belongs_to_their_account_only(ctx, user):
    other, _ = Accounts(ctx.db, ctx.clock).signup("tn-north", email="o@x.com", password="correct horse 1", first_name="O", last_name="O", date_of_birth="1990-01-01",
                                                 phone="555-111-2222", access_type="employer", access_id="em-n-1")
    kid = ctx.intake.add_dependent("tn-north", user["id"], "child", "Kid", "User", "2015-05-05")
    with pytest.raises(IntakeError) as e:
        ctx.intake.prepare("tn-north", other["id"], req(patient_id=kid["id"]))
    assert e.value.code == "patient_not_found"


def test_age_limits_use_the_patients_own_birth_date(ctx, user):
    ctx.db.run("UPDATE visit_types SET min_age = 18 WHERE id = 'sv-pc-n'")
    kid = ctx.intake.add_dependent("tn-north", user["id"], "child", "Kid", "User", "2015-05-05")
    assert code(ctx, user, patient_id=kid["id"]) == "patient_not_allowed"
    assert ctx.intake.prepare("tn-north", user["id"], req())["patient_id"]


def test_referral_modality_and_telehealth_licensure(ctx, user):
    ctx.db.run("UPDATE visit_types SET requires_referral = 1 WHERE id = 'sv-pc-n'")
    assert code(ctx, user) == "referral_required"
    assert ctx.intake.prepare("tn-north", user["id"], req(referral_ref="REF-1"))["referral_ref"] == "REF-1"
    ctx.db.run("UPDATE visit_types SET requires_referral = 0, modality = 'telehealth' WHERE id = 'sv-pc-n'")
    assert code(ctx, user, modality="in_person") == "modality_not_offered"
    assert code(ctx, user, modality="telehealth") == "patient_state_required"
    ctx.db.run("UPDATE providers SET licensed_states = '[\"CA\"]' WHERE id = 'pr-a'")
    assert code(ctx, user, modality="telehealth", patient_state="TX") == "not_licensed_in_state"
    assert ctx.intake.prepare("tn-north", user["id"], req(modality="telehealth", patient_state="CA"))["video_join_base"].startswith("https://")
    ctx.db.run("UPDATE tenants SET video_join_base_url = NULL")
    assert code(ctx, user, modality="telehealth", patient_state="CA") == "telehealth_unavailable"


def test_new_patient_acceptance(ctx, user):
    ctx.db.run("UPDATE providers SET accepting_new = 0 WHERE id = 'pr-a'")
    assert code(ctx, user) == "provider_not_accepting_new"


def test_coverage_network_and_copay(ctx, user):
    ctx.db.run("INSERT INTO coverage_rules (tenant_id, visit_type_id, covered, copay_cents) VALUES ('tn-north','sv-pc-n',1,2500)")
    assert ctx.intake.prepare("tn-north", user["id"], req())["copay_cents"] == 2500
    ctx.db.run("INSERT INTO coverage_rules (tenant_id, visit_type_id, employer_id, covered, copay_cents) VALUES ('tn-north','sv-pc-n','em-n-1',1,1000)")
    assert ctx.intake.prepare("tn-north", user["id"], req())["copay_cents"] == 1000          # the more specific rule wins
    ctx.db.run("UPDATE coverage_rules SET covered = 0 WHERE employer_id = 'em-n-1'")
    assert code(ctx, user) == "not_covered"
    assert ctx.intake.preview("tn-north", user["id"], "cl-sb", "sv-pc-n")["covered"] is False
    insured, _ = Accounts(ctx.db, ctx.clock).signup("tn-north", email="i@x.com", password="correct horse 1", first_name="I", last_name="I", date_of_birth="1990-01-01",
                                                   phone="555-111-2222", access_type="insurer", access_id="in-n-1")
    ctx.db.run("INSERT INTO insurer_networks (tenant_id, insurer_id, clinic_id) VALUES ('tn-north','in-n-1','cl-au')")
    with pytest.raises(IntakeError) as e:
        ctx.intake.prepare("tn-north", insured["id"], req())
    assert e.value.code == "out_of_network"


def test_staff_intake_requires_attested_consent(ctx):
    ctx.db.run("UPDATE tenants SET video_join_base_url = NULL")
    pt = {"first_name": "Walk", "last_name": "In", "date_of_birth": "1980-01-01"}
    base = {"clinic_id": "cl-sb", "service_id": "sv-pc-n", "provider_id": "pr-a", "reason": "Cough", "red_flags": []}
    with pytest.raises(IntakeError) as e:
        ctx.intake.prepare_for_staff("tn-north", pt, base)
    assert e.value.code == "consent_required"
    assert ctx.intake.prepare_for_staff("tn-north", pt, {**base, "consent_attested": True})["intake_required"] is True
