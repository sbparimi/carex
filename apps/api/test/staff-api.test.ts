// P5 staff console: logins and roles, day schedule, visit status, booking on behalf, hours and closures, exports.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startApi, NOW, PASSWORD, type Api, type Client } from "./helpers.js";
import type { Channels } from "../src/notify.js";

const NW = "/t/northwind-health/api";
const SP = "staff-passw0rd-2026";
let api: Api; let now: Date; let me: Client; let fd: Client; let prov: Client; let adm: Client; let n = 0;
let emails: { to: string; subject: string; text: string }[];
const channels = (): Channels => ({ baseUrl: "https://carex.example.test", email: async (m) => { emails.push(m); }, sms: async () => {} });
const sql = (q: string, ...p: unknown[]) => api.app.db.run(q, ...p);
const rows = (q: string, ...p: unknown[]) => api.app.db.all<any>(q, ...p);
const mk = (email: string, name: string, role: string, providerId?: string) => api.app.staff.accounts.create("tn-north", { email, name, role, password: SP, ...(providerId ? { providerId } : {}) });
const loginAs = async (email: string) => { const c = api.client(); const r = await c.call("POST", `${NW}/staff/login`, { email, password: SP }); expect(r.status, email).toBe(200); return c; };

beforeEach(async () => {
  now = new Date(NOW); emails = [];
  api = await startApi({ now: () => now, channels: channels() });
  await sql("UPDATE tenants SET session_idle_minutes = 480 WHERE id = 'tn-north'");
  await mk("desk@clinic.test", "Dana Desk", "front_desk"); await mk("doc@clinic.test", "Dr. Alex", "provider", "pr-a"); await mk("boss@clinic.test", "Bo Boss", "admin");
  fd = await loginAs("desk@clinic.test"); prov = await loginAs("doc@clinic.test"); adm = await loginAs("boss@clinic.test");
  me = api.client(); await me.signup("northwind-health");
});
afterEach(() => api.close());

const slots = async (c: Client = me, pr = "pr-a") => (await c.get(`${NW}/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=${pr}`)).body.slots as { id: string; startsAt: string }[];
const day = "2026-11-03";
const book = async (when = day) => { const s = (await slots()).find((x) => x.startsAt.startsWith(when) && x.startsAt >= `${when}T18`)!; const r = await me.post(`${NW}/bookings`, { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: s.id, confirmed: true, reason: "Knee pain" }, { "idempotency-key": `key-staff-${++n}-xxxxxxxx` }); expect(r.status).toBe(201); return { id: r.body.bookingId as string, slot: s }; };
const schedule = (c: Client, q = "") => c.get(`${NW}/staff/schedule?date=${day}${q}`);

describe("staff sign-in", () => {
  it("signs in, reports who it is, and signs out", async () => {
    expect((await fd.get(`${NW}/staff/me`)).body.staff).toMatchObject({ name: "Dana Desk", role: "front_desk" });
    expect((await fd.post(`${NW}/staff/logout`)).status).toBe(204);
    expect((await fd.get(`${NW}/staff/me`)).status).toBe(401);
  });
  it("gives the same answer for a wrong password and an unknown email, and locks after five failures", async () => {
    const c = api.client();
    const a = await c.call("POST", `${NW}/staff/login`, { email: "desk@clinic.test", password: "wrong password!" });
    const b = await c.call("POST", `${NW}/staff/login`, { email: "nobody@clinic.test", password: "wrong password!" });
    expect(a.status).toBe(401); expect(b.status).toBe(401); expect(a.body).toEqual(b.body);
    for (let i = 0; i < 4; i++) await c.call("POST", `${NW}/staff/login`, { email: "desk@clinic.test", password: "wrong password!" });
    expect((await c.call("POST", `${NW}/staff/login`, { email: "desk@clinic.test", password: SP })).status).toBe(423);
  });
  it("keeps patient and staff sessions apart", async () => {
    expect((await me.get(`${NW}/staff/me`)).status).toBe(401);
    expect((await fd.get(`${NW}/states`)).status).toBe(401);
  });
  it("is scoped to its tenant", async () => {
    const r = await fd.call("GET", "/t/bayview-care/api/staff/me", undefined, { cookie: fd.jar.get("northwind-health")! });
    expect(r.status).toBe(401);
  });
  it("ends when the login is deactivated", async () => {
    const id = (await api.app.staff.accounts.list("tn-north")).find((s) => s.email === "desk@clinic.test")!.id;
    await api.app.staff.accounts.setActive("tn-north", id, false);
    expect((await fd.get(`${NW}/staff/me`)).status).toBe(401);
    expect((await api.client().call("POST", `${NW}/staff/login`, { email: "desk@clinic.test", password: SP })).status).toBe(401);
  });
});

describe("day schedule and roles", () => {
  it("lists the day's appointments with what the desk needs, in clinic-local time", async () => {
    const a = await book();
    const r = await schedule(fd);
    expect(r.status).toBe(200);
    expect(r.body.appointments).toHaveLength(1);
    expect(r.body.appointments[0]).toMatchObject({ id: a.id, status: "confirmed", patientName: "Pat Synthetic", phone: "+31 6 1234 5678", reason: "Knee pain", visitLabel: "Primary Care", providerName: "Dr. Alex Example", clinicName: "San Bernardo Clinic", patientDob: "1985-04-12" });
    expect((await schedule(fd, "&clinicId=cl-au")).body.appointments).toHaveLength(0);
    expect((await fd.get(`${NW}/staff/schedule?date=nope`)).status).toBe(400);
    expect((await api.client().get(`${NW}/staff/schedule?date=${day}`)).status).toBe(401);
  });
  it("shows a provider only their own appointments", async () => {
    await book();
    await sql("INSERT INTO providers (id, tenant_id, display_name, status) VALUES ('pr-other','tn-north','Dr. Other','active')");
    await mk("other@clinic.test", "Dr. Other", "provider", "pr-other"); const other = await loginAs("other@clinic.test");
    expect((await schedule(prov)).body.appointments).toHaveLength(1);
    expect((await schedule(other)).body.appointments).toHaveLength(0);
    const id = (await schedule(fd)).body.appointments[0].id;
    expect((await other.get(`${NW}/staff/appointments/${id}`)).status).toBe(404);
  });
  it("offers the catalog for the booking form", async () => {
    const c = (await fd.get(`${NW}/staff/catalog`)).body;
    expect(c.clinics.find((x: any) => x.id === "cl-sb").providers.map((p: any) => p.id)).toContain("pr-a");
    expect((await prov.get(`${NW}/staff/catalog`)).body.clinics.every((x: any) => x.providers.every((p: any) => p.id === "pr-a"))).toBe(true);
  });
});

describe("visit status", () => {
  it("moves confirmed → arrived → completed, refuses nonsense, and keeps the slot blocked", async () => {
    const a = await book(); const st = (c: Client, s: string) => c.post(`${NW}/staff/appointments/${a.id}/status`, { status: s });
    expect((await st(fd, "arrived")).body.appointment.status).toBe("arrived");
    expect((await st(fd, "completed")).body.appointment.status).toBe("completed");
    expect((await st(fd, "no_show")).status).toBe(409);
    expect((await st(fd, "bogus")).status).toBe(409);
    expect((await slots()).some((x) => x.id === a.slot.id)).toBe(false);
    expect((await me.get(`${NW}/bookings/${a.id}`)).body.status).toBe("completed");                       // the patient sees it too
  });
  it("allows no-show only after the start time, and lets it be undone", async () => {
    const a = await book(); const st = (s: string) => fd.post(`${NW}/staff/appointments/${a.id}/status`, { status: s });
    expect((await st("no_show")).status).toBe(409);
    now = new Date(Date.parse(a.slot.startsAt) + 20 * 60_000); fd = await loginAs("desk@clinic.test");   // a day later: staff sessions last 12 hours
    expect((await st("no_show")).body.appointment.status).toBe("no_show");
    expect((await st("confirmed")).body.appointment.status).toBe("confirmed");
  });
  it("lets a provider check in and complete their own visits, but not mark no-show or cancel", async () => {
    const a = await book();
    expect((await prov.post(`${NW}/staff/appointments/${a.id}/status`, { status: "arrived" })).status).toBe(200);
    expect((await prov.post(`${NW}/staff/appointments/${a.id}/status`, { status: "no_show" })).status).toBe(403);
    expect((await prov.post(`${NW}/staff/appointments/${a.id}/cancel`, {})).status).toBe(403);
  });
});

describe("staff cancel and reschedule", () => {
  it("cancels even inside the patient's notice window, records who and why, and tells the patient", async () => {
    const a = await book(); now = new Date(Date.parse(a.slot.startsAt) - 30 * 60_000); fd = await loginAs("desk@clinic.test");
    const r = await fd.post(`${NW}/staff/appointments/${a.id}/cancel`, { reason: "Provider called in sick" });
    expect(r.status).toBe(200); expect(r.body.appointment).toMatchObject({ status: "cancelled", cancelReason: "Provider called in sick" });
    expect((await rows("SELECT cancelled_by FROM appointments"))[0].cancelled_by).toBe("staff");
    await api.app.notifier.dispatch();
    expect(emails.some((e) => /cancelled/i.test(e.subject))).toBe(true);
  });
  it("moves an appointment to another open time", async () => {
    const a = await book(); const to = (await slots()).find((x) => x.startsAt.startsWith("2026-11-04") && x.startsAt >= "2026-11-04T18")!;
    const r = await fd.post(`${NW}/staff/appointments/${a.id}/reschedule`, { slotId: to.id });
    expect(r.status).toBe(200); expect(r.body.appointment.startsAt).toBe(to.startsAt);
    expect((await fd.post(`${NW}/staff/appointments/${a.id}/reschedule`, { slotId: "tn-north:pr-a:20300101T0000" })).status).toBe(409);
  });
});

describe("booking on behalf of a patient", () => {
  const body = (slotId: string, over: Record<string, unknown> = {}) => ({
    clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId, reason: "Cough for a week", redFlags: [], consentAttested: true,
    patient: { firstName: "Walk", lastName: "In", phone: "+1 555 010 0300", email: "walk.in@example.test", dateOfBirth: "1990-02-03" }, ...over,
  });
  it("books a phone patient with no account and sends them the confirmation", async () => {
    const s = (await slots())[0]!;
    const r = await fd.post(`${NW}/staff/appointments`, body(s.id));
    expect(r.status).toBe(201); expect(r.body.appointment).toMatchObject({ patientName: "Walk In", bookedBy: "staff", hasAccount: false, status: "confirmed" });
    expect((await rows("SELECT user_id, booked_by, booked_by_staff_id FROM appointments"))[0]).toMatchObject({ user_id: null, booked_by: "staff" });
    expect((await rows("SELECT kind FROM consent_records")).length).toBe(1);
    await api.app.notifier.dispatch();
    expect(emails.find((e) => e.to === "walk.in@example.test")?.subject).toMatch(/confirmed/i);
    expect((await slots()).some((x) => x.id === s.id)).toBe(false);
  });
  it("applies the same safety rules as self-service", async () => {
    const s = (await slots())[0]!; const post = (b: object) => fd.post(`${NW}/staff/appointments`, b);
    expect((await post(body(s.id, { consentAttested: false }))).body.error.message).toMatch(/verbal consent/);
    expect((await post(body(s.id, { redFlags: undefined }))).body.error.message).toMatch(/safety questions/);
    const em = await post(body(s.id, { redFlags: ["chest_pain"] })); expect(em.status).toBe(409); expect(em.body.error.message).toMatch(/911/);
    expect((await post(body(s.id, { reason: "" }))).status).toBe(400);
    expect((await post(body(s.id, { patient: { firstName: "A", lastName: "B" } }))).status).toBe(400);              // no way to reach the patient
    expect((await rows("SELECT 1 FROM appointments")).length).toBe(0);
  });
  it("needs a date of birth for age-limited visits and enforces the range", async () => {
    await sql("UPDATE visit_types SET min_age = 65 WHERE id = 'sv-pc-n'");
    const s = ((await fd.get(`${NW}/staff/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a`)).body.slots as { id: string }[])[0]!; const post = (b: object) => fd.post(`${NW}/staff/appointments`, b);
    expect((await post(body(s.id, { patient: { firstName: "A", lastName: "B", phone: "+1 555 010 0300" } }))).body.error.message).toMatch(/date of birth/);
    expect((await post(body(s.id))).status).toBe(400);                                                               // 1990: too young
    expect((await post(body(s.id, { patient: { firstName: "Old", lastName: "Timer", phone: "+1 555 010 0300", dateOfBirth: "1950-01-01" } }))).status).toBe(201);
  });
  it("is for front desk and admins only, and never double-books", async () => {
    const s = (await slots())[0]!;
    expect((await prov.post(`${NW}/staff/appointments`, body(s.id))).status).toBe(403);
    expect((await adm.post(`${NW}/staff/appointments`, body(s.id))).status).toBe(201);
    expect((await fd.post(`${NW}/staff/appointments`, body(s.id))).status).toBe(409);
  });
});

describe("hours, time off and closures", () => {
  it("lets the front desk change a provider's weekly hours", async () => {
    const put = await fd.call("PUT", `${NW}/staff/providers/pr-a/clinics/cl-sb/availability`, { rules: [{ weekday: 2, startMinute: 600, endMinute: 660 }] });
    expect(put.status).toBe(200);
    const ss = await slots(); expect(ss.length).toBeGreaterThan(0); expect(ss.every((x) => new Date(x.startsAt).getUTCDay() === 2 || new Date(x.startsAt).getUTCDay() === 3)).toBe(true);
    expect((await prov.call("PUT", `${NW}/staff/providers/pr-a/clinics/cl-sb/availability`, { rules: [] })).status).toBe(403);
  });
  it("lets a provider add their own time off but not someone else's", async () => {
    const t = (await slots())[0]!;
    const r = await prov.post(`${NW}/staff/providers/pr-a/time-off`, { startsAt: t.startsAt, endsAt: new Date(Date.parse(t.startsAt) + 3_600_000).toISOString() });
    expect(r.status).toBe(201);
    expect((await slots()).some((x) => x.id === t.id)).toBe(false);
    expect((await prov.get(`${NW}/staff/providers/pr-a/time-off`)).body.timeOff).toHaveLength(1);
    expect((await prov.post(`${NW}/staff/providers/pr-b/time-off`, { startsAt: t.startsAt, endsAt: new Date(Date.parse(t.startsAt) + 3_600_000).toISOString() })).status).toBe(403);
  });
  it("closes a clinic for a period, counts the appointments it affects, and reopens it", async () => {
    const a = await book();
    const from = "2026-11-03T00:00:00Z", to = "2026-11-04T00:00:00Z";
    const r = await fd.post(`${NW}/staff/clinics/cl-sb/closures`, { startsAt: from, endsAt: to, reason: "Water leak" });
    expect(r.status).toBe(201); expect(r.body.affectedAppointments).toBe(1);
    expect((await slots()).some((x) => Date.parse(x.startsAt) >= Date.parse(from) && Date.parse(x.startsAt) < Date.parse(to))).toBe(false);
    expect((await fd.post(`${NW}/staff/clinics/cl-sb/closures`, { startsAt: to, endsAt: from })).status).toBe(400);
    expect((await prov.post(`${NW}/staff/clinics/cl-sb/closures`, { startsAt: from, endsAt: to })).status).toBe(403);
    expect((await fd.call("DELETE", `${NW}/staff/closures/${r.body.id}`)).status).toBe(204);
    expect((await slots()).some((x) => Date.parse(x.startsAt) >= Date.parse(from) && Date.parse(x.startsAt) < Date.parse(to))).toBe(true);
  });
});

describe("exports", () => {
  it("exports CSV that cannot run as a spreadsheet formula", async () => {
    await api.app.db.run("UPDATE users SET first_name = '=HYPERLINK(1)' WHERE email = 'pat.synthetic@example.test'");
    const a = await book();
    await sql("UPDATE appointments SET patient_first_name = '=cmd|calc' WHERE id = ?", a.id);
    const r = await fd.get(`${NW}/staff/export.csv?from=${day}&to=${day}`);
    expect(r.status).toBe(200); expect(r.headers.get("content-type")).toMatch(/text\/csv/); expect(r.headers.get("content-disposition")).toMatch(/attachment/);
    const lines = r.text.trim().split("\r\n");
    expect(lines[0]).toBe("Reference,Date,Start,End,Time zone,Clinic,Visit,Provider,Patient,Phone,Email,Status,Format,Copay,Booked by,Late cancel");
    expect(lines).toHaveLength(2); expect(lines[1]).toContain(a.id); expect(lines[1]).toContain("'=cmd|calc"); expect(lines[1]).not.toMatch(/,=cmd/);
    expect((await prov.get(`${NW}/staff/export.csv?from=${day}&to=${day}`)).status).toBe(403);
    expect((await fd.get(`${NW}/staff/export.csv?from=${day}&to=2027-12-31`)).status).toBe(400);
  });
});

describe("admin API: staff management, FHIR, audit", () => {
  let key: string;
  const a = (method: string, path: string, body?: unknown) => api.client().call(method, `${NW}/admin/${path}`, body, { authorization: `Bearer ${key}` });
  beforeEach(async () => { key = await api.app.admin.keys.create("tn-north", "test"); });
  it("creates, lists, deactivates and re-passwords staff", async () => {
    const c = await a("POST", "staff", { email: "new@clinic.test", name: "New Person", role: "front_desk", password: SP });
    expect(c.status).toBe(201); expect(JSON.stringify(c.body)).not.toContain(SP);
    expect((await a("POST", "staff", { email: "new@clinic.test", name: "Dup", role: "front_desk", password: SP })).status).toBe(409);
    expect((await a("POST", "staff", { email: "bad", name: "", role: "king", password: "short" })).status).toBe(400);
    expect((await a("POST", "staff", { email: "p@clinic.test", name: "P", role: "provider", password: SP })).status).toBe(400);   // provider needs a provider id
    expect((await a("GET", "staff")).body.staff.length).toBe(4);
    expect((await a("PUT", `staff/${c.body.staff.id}/password`, { password: "another-passw0rd-1" })).status).toBe(204);
    expect((await a("PATCH", `staff/${c.body.staff.id}`, { active: false })).status).toBe(204);
    expect((await api.client().get(`${NW}/admin/staff`)).status).toBe(401);
  });
  it("exports FHIR R4 appointments", async () => {
    const x = await book();
    const r = await a("GET", `fhir/Appointment?from=${day}&to=${day}`);
    expect(r.status).toBe(200); expect(r.headers.get("content-type")).toMatch(/fhir\+json/);
    expect(r.body).toMatchObject({ resourceType: "Bundle", type: "searchset", total: 1 });
    expect(r.body.entry[0].resource).toMatchObject({ resourceType: "Appointment", id: x.id, status: "booked", start: x.slot.startsAt, serviceType: [{ text: "Primary Care" }] });
    expect(r.body.entry[0].resource.participant.map((p: any) => p.actor.type)).toEqual(["Patient", "Practitioner", "Location"]);
  });
  it("lists the audit trail for staff actions", async () => {
    const x = await book(); await fd.post(`${NW}/staff/appointments/${x.id}/status`, { status: "arrived" }); await schedule(fd);
    const r = await a("GET", "audit?limit=50");
    const acts = r.body.entries.map((e: any) => e.action);
    expect(acts).toEqual(expect.arrayContaining(["staff.login", "appointment.status", "schedule.view", "booking.create"]));
    expect(JSON.stringify(r.body)).not.toContain(SP);
  });
});
