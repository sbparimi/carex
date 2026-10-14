import type { CatalogData } from "./catalog.js";
import { syntheticCatalog } from "./seed.js";
import type { Db } from "./db.js";
import { Accounts } from "./accounts.js";
import { DbScheduling } from "./db-scheduling.js";

/**
 * SYNTHETIC DEMO DATA for development and demos (CAREX_SEED_SYNTHETIC=1). Everything here is invented.
 * It extends syntheticCatalog() (which the automated tests rely on and which stays unchanged) with more clinics, visit types,
 * providers, working hours, employers and insurance providers, and `seedDemoPatients` adds demo accounts with appointments.
 */
export const DEMO_PASSWORD = "Demo-Passw0rd-2026";
export const DEMO_PATIENTS = [
  { tenant: "northwind-health", tenantId: "tn-north", email: "alex.demo@example.test", firstName: "Alex", lastName: "Demo", dateOfBirth: "1988-03-14", phone: "+1 415 555 0101", access: { type: "employer" as const, employerId: "em-n-1" } },
  { tenant: "northwind-health", tenantId: "tn-north", email: "maria.demo@example.test", firstName: "Maria", lastName: "Sample", dateOfBirth: "1976-11-02", phone: "+1 415 555 0102", access: { type: "insurer" as const, insurerId: "in-n-1" } },
  { tenant: "northwind-health", tenantId: "tn-north", email: "new.demo@example.test", firstName: "Nia", lastName: "Newcomer", dateOfBirth: "1995-07-30", phone: "+1 415 555 0103", access: { type: "employer" as const, employerId: "em-n-5" } },
  { tenant: "bayview-care", tenantId: "tn-bay", email: "sam.demo@example.test", firstName: "Sam", lastName: "Bayview", dateOfBirth: "1990-01-21", phone: "+1 510 555 0104", access: { type: "employer" as const, employerId: "em-b-1" } },
];

export function demoCatalog(): CatalogData {
  const base = syntheticCatalog();
  const N = "tn-north", B = "tn-bay";
  const weekdays = (tenantId: string, providerId: string, clinicId: string, days: number[], from: number, to: number) =>
    days.map((weekday) => ({ tenantId, providerId, clinicId, weekday, startMinute: from * 60, endMinute: to * 60 }));
  const emp = (prefix: string, tenantId: string, names: string[], start: number) => names.map((name, i) => ({ id: `${prefix}${start + i}`, tenantId, name: `${name} (demo)` }));
  const ins = (prefix: string, tenantId: string, names: string[], start: number) => names.map((name, i) => ({ id: `${prefix}${start + i}`, tenantId, name: `${name} (demo)` }));
  return {
    ...base,
    clinics: [
      ...base.clinics,
      { id: "cl-sea", tenantId: N, stateCode: "WA", name: "Seattle Clinic", city: "Seattle", address: "2 Example Way, Seattle", timeZone: "America/Los_Angeles", status: "active", bookable: true },
      { id: "cl-den", tenantId: N, stateCode: "CO", name: "Denver Clinic", city: "Denver", address: "3 Example Way, Denver", timeZone: "America/Denver", status: "active", bookable: true },
      { id: "cl-sj", tenantId: B, stateCode: "CA", name: "San Jose Clinic", city: "San Jose", address: "4 Example Way, San Jose", timeZone: "America/Los_Angeles", status: "active", bookable: true },
    ],
    services: [
      ...base.services,
      { id: "sv-vision-b", tenantId: B, canonicalType: "vision_care", label: "Vision Care", description: "Vision Care visit", status: "active" },
      { id: "sv-coach-b", tenantId: B, canonicalType: "health_coach", label: "Health Coach", description: "Health Coach visit", status: "active" },
    ],
    providers: [
      ...base.providers,
      { id: "pr-d", tenantId: N, displayName: "Dr. Dana Demo", status: "active" }, { id: "pr-e", tenantId: N, displayName: "Riley Sample, OD", status: "active" },
      { id: "pr-f", tenantId: N, displayName: "Jordan Placeholder, Health Coach", status: "active" }, { id: "pr-g", tenantId: N, displayName: "Dr. Morgan Example", status: "active" },
      { id: "pr-y", tenantId: B, displayName: "Dr. Yara Example", status: "active" }, { id: "pr-x", tenantId: B, displayName: "Kai Sample, Health Coach", status: "active" },
    ],
    clinicServices: [
      ...base.clinicServices,
      ...["sv-pc-n", "sv-vision-n", "sv-coach-n"].map((serviceId) => ({ tenantId: N, clinicId: "cl-sea", serviceId, active: true })),
      ...["sv-pc-n", "sv-physio-n", "sv-fit-n"].map((serviceId) => ({ tenantId: N, clinicId: "cl-den", serviceId, active: true })),
      { tenantId: B, clinicId: "cl-sj", serviceId: "sv-pc-b", active: true }, { tenantId: B, clinicId: "cl-sj", serviceId: "sv-vision-b", active: true },
      { tenantId: B, clinicId: "cl-oak", serviceId: "sv-coach-b", active: true },
    ],
    eligibility: [
      ...base.eligibility,
      { tenantId: N, clinicId: "cl-sea", serviceId: "sv-pc-n", providerId: "pr-d", active: true },
      { tenantId: N, clinicId: "cl-sea", serviceId: "sv-vision-n", providerId: "pr-e", active: true },
      { tenantId: N, clinicId: "cl-sea", serviceId: "sv-coach-n", providerId: "pr-f", active: true },
      { tenantId: N, clinicId: "cl-den", serviceId: "sv-pc-n", providerId: "pr-g", active: true },
      { tenantId: N, clinicId: "cl-den", serviceId: "sv-physio-n", providerId: "pr-b", active: true },
      { tenantId: N, clinicId: "cl-den", serviceId: "sv-fit-n", providerId: "pr-f", active: true },
      { tenantId: B, clinicId: "cl-sj", serviceId: "sv-pc-b", providerId: "pr-y", active: true },
      { tenantId: B, clinicId: "cl-sj", serviceId: "sv-vision-b", providerId: "pr-y", active: true },
      { tenantId: B, clinicId: "cl-oak", serviceId: "sv-coach-b", providerId: "pr-x", active: true },
    ],
    availability: [
      ...(base.availability ?? []),
      ...weekdays(N, "pr-d", "cl-sea", [1, 2, 3, 4, 5], 8, 16), ...weekdays(N, "pr-e", "cl-sea", [2, 3, 4], 9, 17), ...weekdays(N, "pr-f", "cl-sea", [1, 3, 5], 10, 15),
      ...weekdays(N, "pr-g", "cl-den", [1, 2, 3, 4, 5], 9, 17), ...weekdays(N, "pr-b", "cl-den", [2, 4], 8, 12), ...weekdays(N, "pr-f", "cl-den", [2, 4], 13, 17),
      ...weekdays(B, "pr-y", "cl-sj", [1, 2, 3, 4, 5], 9, 17), ...weekdays(B, "pr-x", "cl-oak", [1, 3, 5], 10, 16),
    ],
    employers: [
      ...(base.employers ?? []),
      ...emp("em-n-", N, ["Vandelay Industries", "Stark Engineering", "Wayne Logistics", "Hooli Cloud", "Soylent Foods", "Wonka Confections", "Cyberdyne Systems", "Gringotts Bank", "Pied Piper Labs", "Dunder Mifflin Paper"], 5),
      ...emp("em-b-", B, ["Oceanic Airlines", "Tyrell Biotech", "Bluth Construction", "Prestige Worldwide", "Sterling Cooper"], 3),
    ],
    insurers: [
      ...(base.insurers ?? []),
      ...ins("in-n-", N, ["Demo Care Alliance", "Northstar Example Insurance", "Evergreen Sample Health", "Summit Placeholder Plan", "Riverbend Mutual"], 4),
      ...ins("in-b-", B, ["Bay Sample Health", "Golden Gate Example Plan", "Pacific Placeholder Mutual"], 2),
    ],
  };
}

/** Demo accounts and appointments: an upcoming and a cancelled booking for Alex, two upcoming for Maria, none for Nia, one for Sam. Idempotent. */
export async function seedDemoPatients(db: Db, now: () => Date = () => new Date()): Promise<void> {
  const accounts = new Accounts(db, now);
  const scheduling = new DbScheduling(db, { now });
  const ids: Record<string, string> = {};
  for (const p of DEMO_PATIENTS) {
    const exists = await db.get<{ id: string }>("SELECT id FROM users WHERE tenant_id = ? AND email = ?", p.tenantId, p.email);
    if (exists) { ids[p.email] = exists.id; continue; }
    const { profile } = await accounts.signup(p.tenantId, { email: p.email, password: DEMO_PASSWORD, firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth, phone: p.phone, access: p.access });
    ids[p.email] = profile.id;
  }
  const book = async (email: string, tenantId: string, q: { clinicId: string; serviceId: string; providerId: string }, slotIdx: number, key: string, cancel = false) => {
    const p = DEMO_PATIENTS.find((x) => x.email === email)!;
    if (await scheduling.lookupByKey(tenantId, key)) return;
    const slot = (await scheduling.listSlots({ tenantId, ...q }))[slotIdx];
    if (!slot) return;
    const rec = await scheduling.reserve({ tenantId, ...q, slotId: slot.id, idempotencyKey: key, userId: ids[email]!, patient: { firstName: p.firstName, lastName: p.lastName, email } });
    if (cancel) await scheduling.cancel(tenantId, rec.bookingId);
  };
  await book("alex.demo@example.test", "tn-north", { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a" }, 20, "demo-seed-alex-1");
  await book("alex.demo@example.test", "tn-north", { clinicId: "cl-sea", serviceId: "sv-vision-n", providerId: "pr-e" }, 6, "demo-seed-alex-2", true);
  await book("maria.demo@example.test", "tn-north", { clinicId: "cl-sb", serviceId: "sv-physio-n", providerId: "pr-b" }, 14, "demo-seed-maria-1");
  await book("maria.demo@example.test", "tn-north", { clinicId: "cl-den", serviceId: "sv-pc-n", providerId: "pr-g" }, 30, "demo-seed-maria-2");
  await book("sam.demo@example.test", "tn-bay", { clinicId: "cl-oak", serviceId: "sv-pc-b", providerId: "pr-z" }, 18, "demo-seed-sam-1");
}
