import type { CatalogData } from "./catalog.js";

/**
 * SYNTHETIC, ILLUSTRATIVE DATA ONLY. Tenant, clinic and provider names are invented and do not describe
 * real organisations, people or addresses (PRD §18, Appendix A).
 */
export function syntheticCatalog(): CatalogData {
  const t = (id: string, slug: string, name: string, color: string, analyticsEnabled = true) => ({
    id, slug, status: "active" as const, analyticsEnabled, brand: { displayName: name, primaryColor: color, supportEmail: `help@${slug}.example` },
  });
  const clinic = (id: string, tenantId: string, stateCode: string, name: string, city: string, tz: string, extra: object = {}) => ({
    id, tenantId, stateCode, name, city, address: `1 Example Way, ${city}`, timeZone: tz, status: "active" as const, bookable: true, ...extra,
  });
  const svc = (id: string, tenantId: string, canonicalType: "physio" | "health_coach" | "fitness" | "primary_care" | "vision_care", label: string) => ({
    id, tenantId, canonicalType, label, description: `${label} visit`, status: "active" as const,
  });
  const prov = (id: string, tenantId: string, displayName: string, status: "active" | "inactive" = "active") => ({ id, tenantId, displayName, status });
  return {
    // The synthetic catalog predates clinical intake; tests that exercise intake switch it on explicitly.
    tenantSettings: [{ tenantId: "tn-north", intakeRequired: false }, { tenantId: "tn-bay", intakeRequired: false }, { tenantId: "tn-off", intakeRequired: false }],
    tenants: [
      t("tn-north", "northwind-health", "Northwind Health (synthetic)", "#0b5fff"),
      t("tn-bay", "bayview-care", "Bayview Care (synthetic)", "#0a7d5a", false),
      { ...t("tn-off", "dormant-clinic", "Dormant (synthetic)", "#999999"), status: "suspended" as const },
    ],
    clinics: [
      clinic("cl-sb", "tn-north", "CA", "San Bernardo Clinic", "San Bernardo", "America/Los_Angeles"),
      clinic("cl-fr", "tn-north", "CA", "Fresno Closed Clinic", "Fresno", "America/Los_Angeles", { status: "inactive" }),
      clinic("cl-au", "tn-north", "TX", "Austin Clinic", "Austin", "America/Chicago"),
      clinic("cl-nb", "tn-north", "NY", "Not Bookable Clinic", "Albany", "America/New_York", { bookable: false }),
      clinic("cl-oak", "tn-bay", "CA", "Oakland Clinic", "Oakland", "America/Los_Angeles"),
    ],
    services: [
      { ...svc("sv-physio-n", "tn-north", "physio", "Physio"), durationMin: 45 }, svc("sv-pc-n", "tn-north", "primary_care", "Primary Care"),
      svc("sv-vision-n", "tn-north", "vision_care", "Vision Care"), svc("sv-coach-n", "tn-north", "health_coach", "Health Coach"),
      svc("sv-fit-n", "tn-north", "fitness", "Fitness"),
      svc("sv-pc-b", "tn-bay", "primary_care", "Primary Care"),
    ],
    providers: [
      prov("pr-a", "tn-north", "Dr. Alex Example"), prov("pr-b", "tn-north", "Sam Sample, PT"), prov("pr-gone", "tn-north", "Retired Provider", "inactive"),
      prov("pr-c", "tn-north", "Dr. Casey Placeholder"), prov("pr-z", "tn-bay", "Dr. Zed Example"),
    ],
    clinicServices: [
      { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-physio-n", active: true },
      { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", active: true },
      { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-vision-n", active: false },     // configured but switched off
      { tenantId: "tn-north", clinicId: "cl-au", serviceId: "sv-pc-n", active: true },
      { tenantId: "tn-north", clinicId: "cl-au", serviceId: "sv-coach-n", active: true },
      { tenantId: "tn-bay", clinicId: "cl-oak", serviceId: "sv-pc-b", active: true },
    ],
    availability: [
      ...[1, 2, 3, 4, 5].flatMap((weekday) => [
        { tenantId: "tn-north", providerId: "pr-a", clinicId: "cl-sb", weekday, startMinute: 9 * 60, endMinute: 12 * 60 },
        { tenantId: "tn-north", providerId: "pr-a", clinicId: "cl-sb", weekday, startMinute: 13 * 60, endMinute: 17 * 60 },
        { tenantId: "tn-north", providerId: "pr-b", clinicId: "cl-sb", weekday, startMinute: 8 * 60, endMinute: 12 * 60 },
        { tenantId: "tn-bay", providerId: "pr-z", clinicId: "cl-oak", weekday, startMinute: 9 * 60, endMinute: 17 * 60 },
      ]),
      ...[2, 4].map((weekday) => ({ tenantId: "tn-north", providerId: "pr-c", clinicId: "cl-au", weekday, startMinute: 10 * 60, endMinute: 14 * 60 })),
    ],
    timeOff: [],
    employers: [
      { id: "em-n-1", tenantId: "tn-north", name: "Acme Logistics (demo)" }, { id: "em-n-2", tenantId: "tn-north", name: "Globex Manufacturing (demo)" },
      { id: "em-n-3", tenantId: "tn-north", name: "Initech Software (demo)" }, { id: "em-n-4", tenantId: "tn-north", name: "Umbrella Retail Group (demo)" },
      { id: "em-b-1", tenantId: "tn-bay", name: "Bayside Shipping (demo)" }, { id: "em-b-2", tenantId: "tn-bay", name: "Harbor Foods (demo)" },
    ],
    insurers: [
      { id: "in-n-1", tenantId: "tn-north", name: "Example Health Plan (demo)" }, { id: "in-n-2", tenantId: "tn-north", name: "Sample Mutual Insurance (demo)" },
      { id: "in-n-3", tenantId: "tn-north", name: "Placeholder Blue Network (demo)" },
      { id: "in-b-1", tenantId: "tn-bay", name: "Bay Example Assurance (demo)" },
    ],
    eligibility: [
      { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-physio-n", providerId: "pr-b", active: true },
      { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", active: true },
      { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-gone", active: true },
      { tenantId: "tn-north", clinicId: "cl-au", serviceId: "sv-pc-n", providerId: "pr-c", active: true },
      { tenantId: "tn-bay", clinicId: "cl-oak", serviceId: "sv-pc-b", providerId: "pr-z", active: true },
    ],
  };
}
