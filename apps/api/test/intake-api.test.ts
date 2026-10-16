// P2 clinical intake: screening, consent, dependents, telehealth licensure, referral, coverage, first available. Server-enforced.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startApi, NOW, type Api, type Client } from "./helpers.js";

const NW = "/t/northwind-health/api";
let api: Api; let me: Client; let other: Client; let now: Date; let n = 0;
const sql = (q: string, ...p: unknown[]) => api.app.db.run(q, ...p);

beforeEach(async () => {
  now = new Date(NOW);
  api = await startApi({ now: () => now });
  me = api.client(); other = api.client();
  await me.signup("northwind-health"); await other.signup("northwind-health", { email: "someone.else@example.test", firstName: "Sam", lastName: "Other" });
  await sql("UPDATE tenants SET intake_required = 1, video_join_base_url = 'https://video.example.test/join' WHERE id = 'tn-north'");
});
afterEach(() => api.close());

const slots = async (c: Client = me, svc = "sv-pc-n", pr = "pr-a") => (await c.get(`${NW}/slots?clinicId=cl-sb&serviceId=${svc}&providerId=${pr}`)).body.slots as { id: string }[];
const full = (slotId: string, over: Record<string, unknown> = {}) => ({
  clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId, confirmed: true,
  reason: "Annual check-up", redFlags: [], consentVersion: "v1", ...over,
});
const book = (body: object, c: Client = me) => c.post(`${NW}/bookings`, body, { "idempotency-key": `key-intake-${++n}-xxxxxxxx` });
const count = async () => (await api.app.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM appointments"))!.n;

describe("intake config", () => {
  it("serves the red-flag list, consent text and version", async () => {
    const r = await me.get(`${NW}/intake-config`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ intakeRequired: true, consentVersion: "v1", telehealth: true });
    expect(r.body.redFlags.length).toBeGreaterThanOrEqual(6);
    expect(r.body.consentText).toMatch(/not for emergencies/);
  });
});

describe("required intake", () => {
  it("refuses a booking that skipped screening, reason or consent, and creates nothing", async () => {
    const [s] = await slots();
    const base = full(s!.id);
    const noScreen = await book({ ...base, redFlags: undefined });  expect(noScreen.body).toMatchObject({ status: "failed", code: "screening_required" });
    const noReason = await book({ ...base, reason: " " });          expect(noReason.body).toMatchObject({ code: "reason_required" });
    const noConsent = await book({ ...base, consentVersion: undefined }); expect(noConsent.body).toMatchObject({ code: "consent_required" });
    const stale = await book({ ...base, consentVersion: "v0" });    expect(stale.body).toMatchObject({ code: "consent_required" });
    expect(await count()).toBe(0);
  });
  it("books with a complete intake and records reason and consent", async () => {
    const [s] = await slots();
    const r = await book(full(s!.id, { accommodations: "Wheelchair access", interpreterLanguage: "Spanish" }));
    expect(r.status).toBe(201);
    expect(r.body.summary).toMatchObject({ modality: "in_person", patientName: "Pat Synthetic", reason: "Annual check-up" });
    const row = await api.app.db.get<{ reason: string; interpreter_language: string; accommodations: string; patient_id: string }>("SELECT reason, interpreter_language, accommodations, patient_id FROM appointments");
    expect(row).toMatchObject({ reason: "Annual check-up", interpreter_language: "Spanish", accommodations: "Wheelchair access" });
    expect(row!.patient_id).toMatch(/^pt_self_/);
    expect((await api.app.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM consent_records WHERE version = 'v1' AND kind = 'treatment'"))!.n).toBe(1);
  });
});

describe("emergency stop", () => {
  it("never books when any red flag is ticked", async () => {
    const [s] = await slots();
    const r = await book(full(s!.id, { redFlags: ["chest_pain"] }));
    expect(r.body).toMatchObject({ status: "failed", code: "emergency_redirect", retryable: false });
    expect(r.body.message).toMatch(/911/); expect(r.body.message).toMatch(/988/);
    expect(await count()).toBe(0);
  });
  it("stops on an emergency phrase in the reason even when no box was ticked, and even if intake is switched off", async () => {
    const [s] = await slots();
    expect((await book(full(s!.id, { reason: "I have crushing chest pain" }))).body.code).toBe("emergency_redirect");
    await sql("UPDATE tenants SET intake_required = 0 WHERE id = 'tn-north'");
    expect((await book(full(s!.id, { reason: "thinking about suicide" }))).body.code).toBe("emergency_redirect");
    expect(await count()).toBe(0);
  });
});

describe("family members", () => {
  it("lists self, adds a dependent and books for them", async () => {
    expect((await me.get(`${NW}/patients`)).body.patients).toHaveLength(1);
    const add = await me.post(`${NW}/patients`, { relationship: "child", firstName: "Kid", lastName: "Synthetic", dateOfBirth: "2018-04-02" });
    expect(add.status).toBe(201);
    const kid = add.body.patient.id as string;
    expect((await me.get(`${NW}/patients`)).body.patients.map((p: { relationship: string }) => p.relationship)).toEqual(["self", "child"]);
    const [s] = await slots();
    const r = await book(full(s!.id, { patientId: kid }));
    expect(r.status).toBe(201);
    expect(r.body.summary.patientName).toBe("Kid Synthetic");
    const row = await api.app.db.get<{ patient_first_name: string; user_id: string; patient_id: string }>("SELECT patient_first_name, user_id, patient_id FROM appointments");
    expect(row).toMatchObject({ patient_first_name: "Kid", patient_id: kid });
  });
  it("rejects someone else's family member and invalid details", async () => {
    const kid = (await me.post(`${NW}/patients`, { relationship: "child", firstName: "Kid", lastName: "Synthetic", dateOfBirth: "2018-04-02" })).body.patient.id as string;
    const [s] = await slots(other);
    expect((await book(full(s!.id, { patientId: kid }), other)).body.code).toBe("patient_not_found");
    expect((await me.post(`${NW}/patients`, { relationship: "child", firstName: "", lastName: "X", dateOfBirth: "2018-04-02" })).status).toBe(400);
    expect((await me.post(`${NW}/patients`, { relationship: "pet", firstName: "A", lastName: "B", dateOfBirth: "2018-04-02" })).status).toBe(400);
    expect((await me.post(`${NW}/patients`, { relationship: "child", firstName: "A", lastName: "B", dateOfBirth: "2999-01-01" })).status).toBe(400);
    expect((await other.get(`${NW}/patients`)).body.patients).toHaveLength(1);
  });
  it("blocks a visit outside the patient's age range", async () => {
    await sql("UPDATE visit_types SET min_age = 18 WHERE id = 'sv-pc-n'");
    const kid = (await me.post(`${NW}/patients`, { relationship: "child", firstName: "Kid", lastName: "Synthetic", dateOfBirth: "2018-04-02" })).body.patient.id as string;
    const [s] = await slots();
    expect((await book(full(s!.id, { patientId: kid }))).body.code).toBe("patient_not_allowed");
    expect((await book(full(s!.id))).status).toBe(201);                                 // the adult account holder is fine
  });
  it("won't remove a family member who has appointments, and removes one who doesn't", async () => {
    const kid = (await me.post(`${NW}/patients`, { relationship: "child", firstName: "Kid", lastName: "Synthetic", dateOfBirth: "2018-04-02" })).body.patient.id as string;
    const [s] = await slots();
    await book(full(s!.id, { patientId: kid }));
    expect((await me.post(`${NW}/patients/${kid}/remove`, {})).status).toBe(409);
    const k2 = (await me.post(`${NW}/patients`, { relationship: "spouse", firstName: "Sp", lastName: "Ouse", dateOfBirth: "1985-02-02" })).body.patient.id as string;
    expect((await me.post(`${NW}/patients/${k2}/remove`, {})).status).toBe(200);
  });
});

describe("telehealth", () => {
  beforeEach(async () => {
    await sql("UPDATE visit_types SET modality = 'either' WHERE id = 'sv-pc-n'");
    await sql("UPDATE providers SET licensed_states = '[\"CA\",\"NV\"]' WHERE id = 'pr-a'");
  });
  it("needs the patient's state, checks the provider's licence and returns a join link", async () => {
    const [s] = await slots();
    expect((await book(full(s!.id, { modality: "telehealth" }))).body.code).toBe("patient_state_required");
    const bad = await book(full(s!.id, { modality: "telehealth", patientState: "TX" }));
    expect(bad.body).toMatchObject({ code: "not_licensed_in_state" }); expect(bad.body.message).toMatch(/TX/);
    const ok = await book(full(s!.id, { modality: "telehealth", patientState: "NV" }));
    expect(ok.status).toBe(201);
    expect(ok.body.summary).toMatchObject({ modality: "telehealth", joinUrl: `https://video.example.test/join/${ok.body.bookingId}` });
    const mine = (await me.get(`${NW}/bookings/${ok.body.bookingId}`)).body;
    expect(mine.summary.joinUrl).toBe(ok.body.summary.joinUrl);
  });
  it("refuses a modality the visit doesn't offer and video when the tenant has no video link", async () => {
    const [s] = await slots();
    await sql("UPDATE visit_types SET modality = 'in_person' WHERE id = 'sv-pc-n'");
    expect((await book(full(s!.id, { modality: "telehealth", patientState: "CA" }))).body.code).toBe("modality_not_offered");
    await sql("UPDATE visit_types SET modality = 'telehealth' WHERE id = 'sv-pc-n'");
    await sql("UPDATE tenants SET video_join_base_url = NULL WHERE id = 'tn-north'");
    expect((await book(full(s!.id, { patientState: "CA" }))).body.code).toBe("telehealth_unavailable");
  });
});

describe("referral, new patients and coverage", () => {
  it("requires a referral number when the visit needs one", async () => {
    await sql("UPDATE visit_types SET requires_referral = 1 WHERE id = 'sv-pc-n'");
    const [s] = await slots();
    expect((await book(full(s!.id))).body.code).toBe("referral_required");
    expect((await book(full(s!.id, { referralRef: "REF-12345" }))).status).toBe(201);
    expect((await api.app.db.get<{ referral_ref: string }>("SELECT referral_ref FROM appointments"))!.referral_ref).toBe("REF-12345");
  });
  it("refuses a provider who isn't accepting new patients", async () => {
    await sql("UPDATE providers SET accepting_new = 0 WHERE id = 'pr-a'");
    const [s] = await slots();
    expect((await book(full(s!.id))).body.code).toBe("provider_not_accepting_new");
  });
  it("applies the plan's copay, refuses uncovered visits and out-of-network clinics", async () => {
    const emp = (await api.app.db.get<{ employer_id: string }>("SELECT employer_id FROM users WHERE email = 'pat.synthetic@example.test'"))!.employer_id;
    await sql("INSERT INTO coverage_rules (tenant_id, visit_type_id, employer_id, covered, copay_cents) VALUES ('tn-north','sv-pc-n',?,1,2500)", emp);
    expect((await me.get(`${NW}/coverage?clinicId=cl-sb&serviceId=sv-pc-n`)).body).toEqual({ covered: true, copayCents: 2500 });
    const [s] = await slots();
    const ok = await book(full(s!.id));
    expect(ok.body.summary.copayCents).toBe(2500);
    expect((await api.app.db.get<{ copay_cents: number }>("SELECT copay_cents FROM appointments"))!.copay_cents).toBe(2500);
    await sql("UPDATE coverage_rules SET covered = 0");
    expect((await me.get(`${NW}/coverage?clinicId=cl-sb&serviceId=sv-pc-n`)).body).toMatchObject({ covered: false });
    const [s2] = (await slots()).slice(1);
    expect((await book(full(s2!.id))).body.code).toBe("not_covered");
  });
  it("enforces an insurer's network", async () => {
    const ins = (await api.app.db.get<{ id: string }>("SELECT id FROM insurers WHERE tenant_id = 'tn-north' LIMIT 1"))!.id;
    const ib = api.client(); expect((await ib.signup("northwind-health", { email: "ins.member@example.test", access: { type: "insurer", insurerId: ins } })).status).toBe(201);
    await sql("INSERT INTO insurer_networks (tenant_id, insurer_id, clinic_id) VALUES ('tn-north', ?, 'cl-au')", ins);
    const [s] = await slots(ib);
    expect((await book(full(s!.id), ib)).body.code).toBe("out_of_network");
  });
});

describe("any provider (first available)", () => {
  it("returns the soonest openings across providers, soonest first, with names", async () => {
    const r = await me.get(`${NW}/first-available?clinicId=cl-sb&serviceId=sv-pc-n`);
    expect(r.status).toBe(200);
    const list = r.body.slots as { startsAt: string; providerName: string }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.map((x) => x.startsAt)).toEqual([...list.map((x) => x.startsAt)].sort());
    expect(list[0]!.providerName).toBe("Dr. Alex Example");
    expect((await me.get(`${NW}/first-available?clinicId=bad%20id&serviceId=sv-pc-n`)).status).toBe(400);
  });
});

describe("employer eligibility at sign-up", () => {
  it("requires a work-email domain or a roster entry when the employer asks for it", async () => {
    await sql("UPDATE employers SET verification = 'domain', email_domain = 'acme.test' WHERE id = 'em-n-1'");
    const c = api.client();
    const bad = await c.signup("northwind-health", { email: "pat@gmail.test" });
    expect(bad.status).toBe(400); expect(bad.body.error.fields?.email ?? JSON.stringify(bad.body)).toMatch(/@acme\.test/);
    expect((await c.signup("northwind-health", { email: "pat@acme.test" })).status).toBe(201);
    await sql("UPDATE employers SET verification = 'roster' WHERE id = 'em-n-1'");
    await sql("INSERT INTO employer_roster (tenant_id, employer_id, email) VALUES ('tn-north','em-n-1','listed@x.test')");
    const c2 = api.client();
    expect((await c2.signup("northwind-health", { email: "unlisted@x.test" })).status).toBe(400);
    expect((await c2.signup("northwind-health", { email: "Listed@x.test" })).status).toBe(201);
  });
});
