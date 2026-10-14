import type { BrandConfig, PublicClinic, PublicProvider, VisitType } from "@carex/contracts";

// Row and port types shared by the catalog implementation (SqliteCatalog) and the seed/import data.

export interface ClinicRow extends PublicClinic { tenantId: string; status: "active" | "inactive"; bookable: boolean }
export interface ServiceRow extends VisitType { tenantId: string; status: "active" | "inactive"; durationMin?: number }
export interface ProviderRow extends PublicProvider { tenantId: string; status: "active" | "inactive" }
export interface Eligibility { tenantId: string; clinicId: string; serviceId: string; providerId: string }
export interface TenantRow { id: string; slug: string; status: "active" | "suspended"; brand: BrandConfig; analyticsEnabled: boolean }

export interface CatalogData {
  tenants: TenantRow[]; clinics: ClinicRow[]; services: ServiceRow[]; providers: ProviderRow[];
  clinicServices: { tenantId: string; clinicId: string; serviceId: string; active: boolean }[];
  eligibility: (Eligibility & { active: boolean })[];
  /** Weekly working hours in the clinic's local time. weekday 0 = Sunday. */
  availability?: { tenantId: string; providerId: string; clinicId: string; weekday: number; startMinute: number; endMinute: number }[];
  timeOff?: { tenantId: string; providerId: string; startsAt: string; endsAt: string }[];
}

/** What the booking service and HTTP layer need from a catalog. Every read is scoped to one tenant. */
export interface CatalogPort {
  tenantBySlug(slug: string): TenantRow | undefined;
  states(tenantId: string): string[];
  clinics(tenantId: string, stateCode: string): PublicClinic[];
  clinic(tenantId: string, clinicId: string): PublicClinic | undefined;
  visitTypes(tenantId: string, clinicId: string): VisitType[];
  providers(tenantId: string, clinicId: string, serviceId: string): PublicProvider[];
  eligible(tenantId: string, clinicId: string, serviceId: string, providerId: string): { clinic: PublicClinic; visitType: VisitType; provider: PublicProvider } | undefined;
  /** Display details for an EXISTING booking. Ignores active/bookable flags so a later deactivation never hides a patient's appointment. */
  describe(tenantId: string, clinicId: string, serviceId: string, providerId: string): { clinic: PublicClinic; visitType: VisitType; provider: PublicProvider } | undefined;
}
