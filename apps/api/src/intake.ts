import { randomBytes } from "node:crypto";
import type { BookingRequest, Modality } from "@carex/contracts";
import type { Db } from "./db.js";
import { ageOn } from "./db-scheduling.js";
import { screen } from "./triage.js";

/** A booking was refused for a clinical, coverage or policy reason. The code is stable; the message is patient-facing. */
export class IntakeError extends Error { constructor(public code: string, message: string) { super(message); } }

export interface PatientRecord { id: string; relationship: "self" | "child" | "spouse" | "parent" | "other"; firstName: string; lastName: string; dateOfBirth: string }
export interface IntakeDecision {
  patientId: string; patientFirstName: string; patientLastName: string;
  reason: string | null; modality: Modality; patientState: string | null; interpreterLanguage: string | null; accommodations: string | null; referralRef: string | null;
  copayCents: number; consentVersion: string | null; videoJoinBase: string | null; intakeRequired: boolean;
}
export interface IntakePort {
  prepare(tenantId: string, userId: string, req: BookingRequest): Promise<IntakeDecision>;
}

/** Starting-point wording. LEGAL REVIEW REQUIRED before production use (docs/product/08-adr-clinical-intake.md). */
export const CONSENT_TEXT =
  "I consent to evaluation and treatment by the clinic's providers, including by video if I choose a video visit. I understand I can cancel or change this appointment up to the notice time shown, " +
  "and that this service is not for emergencies. I confirm the information I entered is accurate and that I am the patient or the patient's parent or legal guardian.";
export const INTERPRETER_LANGUAGES = ["Spanish", "Mandarin", "Cantonese", "Vietnamese", "Tagalog", "Korean", "Arabic", "Russian", "American Sign Language", "Other"];

export const RELATIONSHIPS = ["child", "spouse", "parent", "other"] as const;
const pid = () => `pt_${randomBytes(9).toString("base64url")}`;

/** Patients (self + dependents), consent, screening, referral, telehealth licensure and coverage, evaluated server-side before any slot is held. */
export class DbIntake implements IntakePort {
  constructor(private db: Db, private now: () => Date = () => new Date()) {}

  async config(tenantId: string): Promise<{ intakeRequired: boolean; consentVersion: string; consentText: string; interpreterLanguages: string[]; telehealth: boolean }> {
    const t = await this.db.get<{ intake_required: number; consent_version: string; video_join_base_url: string | null }>("SELECT intake_required, consent_version, video_join_base_url FROM tenants WHERE id = ?", tenantId);
    return { intakeRequired: t?.intake_required === 1, consentVersion: t?.consent_version ?? "v1", consentText: CONSENT_TEXT, interpreterLanguages: INTERPRETER_LANGUAGES, telehealth: !!t?.video_join_base_url };
  }

  async ensureSelf(tenantId: string, userId: string): Promise<PatientRecord> {
    const have = await this.db.get<PRow>("SELECT id, relationship, first_name, last_name, date_of_birth FROM patients WHERE tenant_id = ? AND user_id = ? AND relationship = 'self'", tenantId, userId);
    if (have) return toPatient(have);
    const u = await this.db.get<{ first_name: string; last_name: string; date_of_birth: string }>("SELECT first_name, last_name, date_of_birth FROM users WHERE tenant_id = ? AND id = ?", tenantId, userId);
    if (!u) throw new IntakeError("patient_not_found", "Account not found");
    const id = `pt_self_${userId}`;
    await this.db.run("INSERT INTO patients (id, tenant_id, user_id, relationship, first_name, last_name, date_of_birth, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
      id, tenantId, userId, "self", u.first_name, u.last_name, u.date_of_birth, this.now().toISOString());
    return { id, relationship: "self", firstName: u.first_name, lastName: u.last_name, dateOfBirth: u.date_of_birth };
  }

  async list(tenantId: string, userId: string): Promise<PatientRecord[]> {
    await this.ensureSelf(tenantId, userId);
    const rows = await this.db.all<PRow>("SELECT id, relationship, first_name, last_name, date_of_birth FROM patients WHERE tenant_id = ? AND user_id = ? ORDER BY (relationship = 'self') DESC, created_at, id", tenantId, userId);
    return rows.map(toPatient);
  }

  async addDependent(tenantId: string, userId: string, i: { relationship: string; firstName: string; lastName: string; dateOfBirth: string }): Promise<PatientRecord> {
    const fields: Record<string, string> = {};
    if (!(RELATIONSHIPS as readonly string[]).includes(i.relationship)) fields.relationship = "Choose how this person is related to you";
    const first = String(i.firstName ?? "").trim(), last = String(i.lastName ?? "").trim();
    if (!first || first.length > 80) fields.firstName = "Enter a first name";
    if (!last || last.length > 80) fields.lastName = "Enter a last name";
    const dob = String(i.dateOfBirth ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob)) || Date.parse(dob) > this.now().getTime()) fields.dateOfBirth = "Enter a valid date of birth";
    if (Object.keys(fields).length) throw new IntakeError("invalid_patient", Object.values(fields)[0]!);
    if ((await this.list(tenantId, userId)).length >= 12) throw new IntakeError("too_many_patients", "You can add up to 11 family members");
    const id = pid();
    await this.db.run("INSERT INTO patients (id, tenant_id, user_id, relationship, first_name, last_name, date_of_birth, created_at) VALUES (?,?,?,?,?,?,?,?)", id, tenantId, userId, i.relationship, first, last, dob, this.now().toISOString());
    return { id, relationship: i.relationship as PatientRecord["relationship"], firstName: first, lastName: last, dateOfBirth: dob };
  }

  async removeDependent(tenantId: string, userId: string, patientId: string): Promise<boolean> {
    const used = await this.db.get("SELECT 1 AS ok FROM appointments WHERE tenant_id = ? AND patient_id = ? AND status <> 'cancelled' LIMIT 1", tenantId, patientId);
    if (used) throw new IntakeError("patient_in_use", "This person has appointments. Cancel them first.");
    const r = await this.db.run("DELETE FROM patients WHERE tenant_id = ? AND user_id = ? AND id = ? AND relationship <> 'self'", tenantId, userId, patientId);
    return (r.changes ?? 0) > 0;
  }

  async prepare(tenantId: string, userId: string, req: BookingRequest): Promise<IntakeDecision> {
    const t = await this.db.get<{ intake_required: number; consent_version: string; video_join_base_url: string | null }>("SELECT intake_required, consent_version, video_join_base_url FROM tenants WHERE id = ?", tenantId);
    if (!t) throw new IntakeError("not_found", "selection is not available");
    const required = t.intake_required === 1;

    // Who is the visit for. A dependent must belong to the signed-in account.
    const patient = req.patientId
      ? await this.db.get<PRow>("SELECT id, relationship, first_name, last_name, date_of_birth FROM patients WHERE tenant_id = ? AND user_id = ? AND id = ?", tenantId, userId, req.patientId)
      : await this.ensureSelf(tenantId, userId).then((p) => ({ id: p.id, relationship: p.relationship, first_name: p.firstName, last_name: p.lastName, date_of_birth: p.dateOfBirth }));
    if (!patient) throw new IntakeError("patient_not_found", "We couldn't find that person on your account.");

    const c = await this.checks(tenantId, req, { dob: patient.date_of_birth, patientId: patient.id, consentRequired: required, consentVersion: t.consent_version, videoBase: t.video_join_base_url });

    // Coverage and network.
    const copayCents = await this.coverage(tenantId, userId, req.clinicId, req.serviceId);

    return {
      patientId: patient.id, patientFirstName: patient.first_name, patientLastName: patient.last_name,
      reason: c.reason, modality: c.modality, patientState: c.state, interpreterLanguage: req.interpreterLanguage?.trim() || null,
      accommodations: req.accommodations?.trim() || null, referralRef: c.referral, copayCents,
      consentVersion: required || req.consentVersion ? t.consent_version : null, videoJoinBase: t.video_join_base_url, intakeRequired: required,
    };
  }

  /**
   * Intake for a patient a staff member is booking by phone or at the desk (no account). Same safety rules as self-service:
   * the screening script must have been read (redFlags present), a positive stops the booking, and verbal consent must be recorded.
   */
  async prepareForStaff(tenantId: string, patient: { firstName: string; lastName: string; dateOfBirth?: string }, req: BookingRequest & { consentAttested?: boolean }): Promise<IntakeDecision> {
    const t = await this.db.get<{ consent_version: string; video_join_base_url: string | null }>("SELECT consent_version, video_join_base_url FROM tenants WHERE id = ?", tenantId);
    if (!t) throw new IntakeError("not_found", "selection is not available");
    if (req.consentAttested !== true) throw new IntakeError("consent_required", "Confirm the patient gave verbal consent to treatment.");
    const c = await this.checks(tenantId, { ...req, consentVersion: t.consent_version }, { dob: patient.dateOfBirth ?? null, patientId: null, consentRequired: true, consentVersion: t.consent_version, videoBase: t.video_join_base_url, staff: true });
    return {
      patientId: "", patientFirstName: patient.firstName, patientLastName: patient.lastName, reason: c.reason, modality: c.modality, patientState: c.state,
      interpreterLanguage: req.interpreterLanguage?.trim() || null, accommodations: req.accommodations?.trim() || null, referralRef: c.referral, copayCents: 0,
      consentVersion: t.consent_version, videoJoinBase: t.video_join_base_url, intakeRequired: true,
    };
  }

  /** Screening, consent, age, referral, modality/licensure and new-patient acceptance: identical for self-service and staff bookings. */
  private async checks(tenantId: string, req: BookingRequest, o: { dob: string | null; patientId: string | null; consentRequired: boolean; consentVersion: string; videoBase: string | null; staff?: boolean }):
    Promise<{ reason: string | null; modality: Modality; state: string | null; referral: string | null }> {
    const required = o.consentRequired;
        // 1. Emergency screen: always honoured when the patient said yes or wrote an emergency phrase; required to be present when intake is required.
    const sc = screen(req.reason, req.redFlags);
    if (sc.emergency) throw new IntakeError("emergency_redirect", sc.message!);
    if (required && !sc.screened) throw new IntakeError("screening_required", "Please answer the safety questions before booking.");
    if (required && (req.reason ?? "").trim().length < 3) throw new IntakeError("reason_required", "Tell us briefly what the visit is for.");
    if (required && req.consentVersion !== o.consentVersion) throw new IntakeError("consent_required", "Please review and accept the consent to treatment to continue.");

    const v = await this.db.get<{ modality: "in_person" | "telehealth" | "either"; requires_referral: number; min_age: number | null; max_age: number | null }>(
      "SELECT modality, requires_referral, min_age, max_age FROM visit_types WHERE tenant_id = ? AND id = ?", tenantId, req.serviceId);
    if (!v) throw new IntakeError("not_found", "selection is not available");
    const age = o.dob ? ageOn(o.dob, this.now()) : null;
    if (age === null && (v.min_age !== null || v.max_age !== null)) throw new IntakeError("dob_required", "Enter the patient's date of birth: this visit has an age range.");
    if (age !== null && ((v.min_age !== null && age < v.min_age) || (v.max_age !== null && age > v.max_age))) throw new IntakeError("patient_not_allowed", "This visit isn't available for this patient's age.");

    // 2. Referral.
    const referral = (req.referralRef ?? "").trim();
    if (v.requires_referral === 1 && !referral) throw new IntakeError("referral_required", "This visit needs a referral. Enter your referral number.");

    // 3. Modality and telehealth licensure.
    const modality: Modality = v.modality === "either" ? (req.modality ?? "in_person") : v.modality;
    if (req.modality && req.modality !== modality) throw new IntakeError("modality_not_offered", `This visit is only available ${v.modality === "telehealth" ? "by video" : "in person"}.`);
    const prov = await this.db.get<{ display_name: string; licensed_states: string; accepting_new: number }>("SELECT display_name, licensed_states, accepting_new FROM providers WHERE tenant_id = ? AND id = ?", tenantId, req.providerId);
    if (!prov) throw new IntakeError("not_found", "selection is not available");
    let state: string | null = null;
    if (modality === "telehealth") {
      if (!o.videoBase) throw new IntakeError("telehealth_unavailable", "Video visits aren't available yet. Please choose an in-person visit.");
      state = req.patientState ?? null;
      if (!state) throw new IntakeError("patient_state_required", "Tell us the state you'll be in during the video visit.");
      const licensed = JSON.parse(prov.licensed_states || "[]") as string[];
      if (!licensed.includes(state)) throw new IntakeError("not_licensed_in_state", `${prov.display_name} can't see patients by video in ${state}. Try another provider or an in-person visit.`);
    }

    // 4. New-patient acceptance.
    if (prov.accepting_new === 0) {
      const seen = o.patientId ? await this.db.get("SELECT 1 AS ok FROM appointments WHERE tenant_id = ? AND patient_id = ? AND provider_id = ? AND status IN ('arrived','completed') LIMIT 1", tenantId, o.patientId, req.providerId) : undefined;
      if (!seen && !o.staff) throw new IntakeError("provider_not_accepting_new", `${prov.display_name} isn't accepting new patients. Choose another provider.`);
    }

    return { reason: (req.reason ?? "").trim() || null, modality, state, referral: referral || null };
  }

  /** What the signed-in account's plan says about this visit. Throws when it isn't covered or the clinic is out of network. */
  async coverage(tenantId: string, userId: string, clinicId: string, serviceId: string): Promise<number> {
    const u = await this.db.get<{ employer_id: string | null; insurer_id: string | null }>("SELECT employer_id, insurer_id FROM users WHERE tenant_id = ? AND id = ?", tenantId, userId);
    if (!u) throw new IntakeError("patient_not_found", "Account not found");
    if (u.insurer_id) {
      const net = await this.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM insurer_networks WHERE tenant_id = ? AND insurer_id = ?", tenantId, u.insurer_id);
      if (net && net.n > 0 && !(await this.db.get("SELECT 1 AS ok FROM insurer_networks WHERE tenant_id = ? AND insurer_id = ? AND clinic_id = ?", tenantId, u.insurer_id, clinicId)))
        throw new IntakeError("out_of_network", "This clinic isn't in your plan's network. Choose an in-network clinic.");
    }
    const rule = await this.db.get<{ covered: number; copay_cents: number }>(
      `SELECT covered, copay_cents FROM coverage_rules WHERE tenant_id = ? AND visit_type_id = ? AND ((employer_id = ? ) OR (insurer_id = ?) OR (employer_id IS NULL AND insurer_id IS NULL))
        ORDER BY (employer_id IS NOT NULL OR insurer_id IS NOT NULL) DESC LIMIT 1`, tenantId, serviceId, u.employer_id, u.insurer_id);
    if (!rule) return 0;
    if (rule.covered === 0) throw new IntakeError("not_covered", "This visit isn't covered by your plan.");
    return rule.copay_cents;
  }

  /** Coverage preview for the booking screen. Never throws for a plain "not covered": it reports it. */
  async preview(tenantId: string, userId: string, clinicId: string, serviceId: string): Promise<{ covered: boolean; copayCents: number; reason?: string }> {
    try { return { covered: true, copayCents: await this.coverage(tenantId, userId, clinicId, serviceId) }; }
    catch (e) { if (e instanceof IntakeError) return { covered: false, copayCents: 0, reason: e.message }; throw e; }
  }
}

interface PRow { id: string; relationship: PatientRecord["relationship"]; first_name: string; last_name: string; date_of_birth: string }
const toPatient = (r: PRow): PatientRecord => ({ id: r.id, relationship: r.relationship, firstName: r.first_name, lastName: r.last_name, dateOfBirth: r.date_of_birth });
