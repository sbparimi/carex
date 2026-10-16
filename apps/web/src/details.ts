// The "Your details" step: who the visit is for, safety questions, reason, format, coverage and consent.
// Every rule here is also enforced by the server; this only makes the problems visible before the patient reaches the end.
import { esc } from "./common.js";
import type { VisitType } from "@carex/contracts";

export interface Patient { id: string; relationship: string; firstName: string; lastName: string; dateOfBirth: string }
export interface Cfg { intakeRequired: boolean; consentVersion: string; consentText: string; interpreterLanguages: string[]; telehealth: boolean; redFlags: { key: string; label: string }[] }
export interface Coverage { covered: boolean; copayCents: number; reason?: string }
export interface Form {
  patientId: string; reason: string; screen: "" | "no" | "yes"; flags: string[]; modality: "in_person" | "telehealth"; patientState: string;
  interpreter: string; accommodations: string; referral: string; consent: boolean; addingFamily: boolean; family: { relationship: string; firstName: string; lastName: string; dateOfBirth: string }; familyError: string;
}
export const newForm = (): Form => ({
  patientId: "", reason: "", screen: "", flags: [], modality: "in_person", patientState: "", interpreter: "", accommodations: "", referral: "", consent: false,
  addingFamily: false, family: { relationship: "child", firstName: "", lastName: "", dateOfBirth: "" }, familyError: "",
});

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const REL: Record<string, string> = { self: "Myself", child: "Child", spouse: "Spouse or partner", parent: "Parent", other: "Someone else" };
const US = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");

/** How the visit will be delivered, given what the visit type offers and what the patient chose. */
export const effectiveModality = (v: VisitType | undefined, f: Form): "in_person" | "telehealth" =>
  v?.modality === "telehealth" ? "telehealth" : v?.modality === "either" ? f.modality : "in_person";

export interface Ctx { f: Form; cfg: Cfg | undefined; patients: Patient[]; coverage: Coverage | undefined; visit: VisitType | undefined }

/** What still blocks Continue, in the order the patient sees it. */
export function problems(c: Ctx): string[] {
  const out: string[] = [];
  if (!c.cfg) return ["Loading"];
  if (c.f.screen === "yes") out.push("Safety question: this may be an emergency");
  if (c.f.screen === "" && c.cfg.intakeRequired) out.push("Answer the safety question");
  if (c.cfg.intakeRequired && c.f.reason.trim().length < 3) out.push("Tell us what the visit is for");
  if (c.visit?.requiresReferral && !c.f.referral.trim()) out.push("Enter your referral number");
  if (effectiveModality(c.visit, c.f) === "telehealth" && !c.f.patientState) out.push("Choose the state you'll be in");
  if (c.coverage && !c.coverage.covered) out.push(c.coverage.reason ?? "Not covered");
  if (c.cfg.intakeRequired && !c.f.consent) out.push("Accept the consent to treatment");
  return out;
}

export function emergencyHtml(): string {
  return `<div class="banner error emergency" role="alert"><span class="icon" aria-hidden="true">!</span><span class="text"><strong>This may be an emergency.</strong> Do not book online. Call <a href="tel:911">911</a> now or go to the nearest emergency room. If you are thinking about harming yourself, call or text <a href="tel:988">988</a> (Suicide &amp; Crisis Lifeline) right away.</span></div>`;
}

export function detailsHtml(c: Ctx): string {
  const { f, cfg, patients, visit } = c;
  if (!cfg) return `<div aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div></div><p class="sr-only" role="status">Loading</p>`;
  const who = patients.map((p) => `<label class="choice"><input type="radio" name="patient" value="${esc(p.id)}"${p.id === f.patientId ? " checked" : ""}><span class="card"><span>${esc(`${p.firstName} ${p.lastName}`)}<small>${esc(REL[p.relationship] ?? p.relationship)}</small></span><span class="badge" aria-hidden="true">Selected</span></span></label>`).join("");
  const fam = f.addingFamily
    ? `<div class="subform" role="group" aria-labelledby="fam-h"><h3 id="fam-h" class="h2-md">Add a family member</h3>${f.familyError ? `<div class="banner error" role="alert"><span class="icon" aria-hidden="true">✕</span><span class="text">${esc(f.familyError)}</span></div>` : ""}
        <label class="field" for="fam-rel">Relationship</label><select id="fam-rel" data-f="fam.relationship">${["child", "spouse", "parent", "other"].map((r) => `<option value="${r}"${f.family.relationship === r ? " selected" : ""}>${REL[r]}</option>`).join("")}</select>
        <label class="field" for="fam-first">First name</label><input id="fam-first" type="text" autocomplete="off" data-f="fam.firstName" value="${esc(f.family.firstName)}">
        <label class="field" for="fam-last">Last name</label><input id="fam-last" type="text" autocomplete="off" data-f="fam.lastName" value="${esc(f.family.lastName)}">
        <label class="field" for="fam-dob">Date of birth</label><input id="fam-dob" type="date" data-f="fam.dateOfBirth" value="${esc(f.family.dateOfBirth)}">
        <div class="actions"><button type="button" data-act="cancelFamily">Cancel</button><button type="button" class="primary" data-act="saveFamily">Save family member</button></div></div>`
    : `<p class="hint"><button type="button" class="btn-inline" data-act="addFamily">Add a family member</button></p>`;
  const flags = cfg.redFlags.map((r) => `<label class="check"><input type="checkbox" name="flag" value="${esc(r.key)}"${f.flags.includes(r.key) ? " checked" : ""}${f.screen === "yes" ? "" : " disabled"}> <span>${esc(r.label)}</span></label>`).join("");
  const screen = `<fieldset><legend>Are you having any of these right now?</legend>
      <label class="check"><input type="radio" name="screen" value="no"${f.screen === "no" ? " checked" : ""}> <span>No, none of these apply</span></label>
      <label class="check"><input type="radio" name="screen" value="yes"${f.screen === "yes" ? " checked" : ""}> <span>Yes, one or more apply</span></label>
      <div class="subfield" id="flaglist"><p class="hint" id="flags-hint">Select all that apply.</p>${flags}</div></fieldset>${f.screen === "yes" ? emergencyHtml() : ""}`;
  const mod = effectiveModality(visit, f);
  const format = visit?.modality === "either"
    ? `<fieldset><legend>How would you like to be seen?</legend><label class="check"><input type="radio" name="modality" value="in_person"${f.modality === "in_person" ? " checked" : ""}> <span>In person at the clinic</span></label>${cfg.telehealth ? `<label class="check"><input type="radio" name="modality" value="telehealth"${f.modality === "telehealth" ? " checked" : ""}> <span>Video visit</span></label>` : ""}</fieldset>`
    : visit?.modality === "telehealth" ? `<p class="hint">This is a video visit. You'll get a link in your confirmation.</p>` : "";
  const state = mod === "telehealth"
    ? `<label class="field" for="pstate">State you'll be in during the video visit</label><select id="pstate" data-f="patientState" aria-describedby="pstate-hint"><option value="">Select a state</option>${US.map((s) => `<option${f.patientState === s ? " selected" : ""}>${s}</option>`).join("")}</select><p class="hint" id="pstate-hint">Providers can only see patients by video in the states where they are licensed.</p>` : "";
  const referral = visit?.requiresReferral ? `<label class="field" for="referral">Referral number</label><input id="referral" type="text" autocomplete="off" maxlength="60" data-f="referral" value="${esc(f.referral)}"><p class="hint">This visit needs a referral from another provider.</p>` : "";
  const cov = c.coverage
    ? c.coverage.covered
      ? `<div class="banner info" role="status"><span class="icon" aria-hidden="true">i</span><span class="text">${c.coverage.copayCents ? `Covered by your plan. Expected copay: <strong>${money(c.coverage.copayCents)}</strong>, due at the visit.` : "Covered by your plan. No copay expected."}</span></div>`
      : `<div class="banner error" role="alert"><span class="icon" aria-hidden="true">✕</span><span class="text">${esc(c.coverage.reason ?? "This visit isn't covered by your plan.")}</span></div>` : "";
  return `<fieldset><legend>Who is this visit for?</legend>${who}</fieldset>${fam}
    ${screen}
    <label class="field" for="reason">What is the visit for?</label><textarea id="reason" rows="3" maxlength="500" data-f="reason" aria-describedby="reason-hint">${esc(f.reason)}</textarea><p class="hint" id="reason-hint">A few words are enough. Don't include emergencies here.</p>
    ${format}${state}${referral}
    <label class="field" for="interp">Interpreter (optional)</label><select id="interp" data-f="interpreter"><option value="">No interpreter needed</option>${cfg.interpreterLanguages.map((l) => `<option${f.interpreter === l ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
    <label class="field" for="accom">Accessibility or other needs (optional)</label><textarea id="accom" rows="2" maxlength="300" data-f="accommodations">${esc(f.accommodations)}</textarea>
    ${cov}
    <fieldset><legend>Consent to treatment</legend><p class="consent">${esc(cfg.consentText)}</p><label class="check"><input type="checkbox" name="consent"${f.consent ? " checked" : ""}> <span>I have read and agree</span></label></fieldset>`;
}
