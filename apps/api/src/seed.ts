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
      svc("sv-physio-n", "tn-north", "physio", "Physio"), svc("sv-pc-n", "tn-north", "primary_care", "Primary Care"),
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
    eligibility: [
      { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-physio-n", providerId: "pr-b", active: true },
      { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", active: true },
      { tenantId: "tn-north", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-gone", active: true },
      { tenantId: "tn-north", clinicId: "cl-au", serviceId: "sv-pc-n", providerId: "pr-c", active: true },
      { tenantId: "tn-bay", clinicId: "cl-oak", serviceId: "sv-pc-b", providerId: "pr-z", active: true },
    ],
  };
}
