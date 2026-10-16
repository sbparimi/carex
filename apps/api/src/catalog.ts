import type { BrandConfig, PublicClinic, PublicProvider, VisitType } from "@carex/contracts";

// Row and port types shared by the catalog implementation (DbCatalog) and the seed/import data.

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
  /** Employers and insurance providers each tenant serves (account sign-up, ADR-005). */
  employers?: { id: string; tenantId: string; name: string }[];
  insurers?: { id: string; tenantId: string; name: string }[];
  /** Per-visit scheduling and clinical rules (engine, intake). */
  rules?: { tenantId: string; serviceId: string; minLeadMinutes?: number; horizonDays?: number; bufferBeforeMin?: number; bufferAfterMin?: number; minAge?: number; maxAge?: number;
    newPatients?: "any" | "new_only" | "established_only"; modality?: "in_person" | "telehealth" | "either"; requiresReferral?: boolean; resourceKind?: string }[];
  resources?: { id: string; tenantId: string; clinicId: string; kind: string; name: string }[];
  closures?: { tenantId: string; clinicId: string; startsAt: string; endsAt: string; reason?: string }[];
  profiles?: { tenantId: string; providerId: string; specialty?: string; languages?: string[]; licensedStates?: string[]; acceptingNew?: boolean; bio?: string }[];
  tenantSettings?: { tenantId: string; intakeRequired?: boolean; videoJoinBaseUrl?: string; consentVersion?: string }[];
  employerRules?: { tenantId: string; employerId: string; verification: "none" | "domain" | "roster"; emailDomain?: string; roster?: string[] }[];
  networks?: { tenantId: string; insurerId: string; clinicId: string }[];
  coverage?: { tenantId: string; serviceId: string; employerId?: string; insurerId?: string; covered?: boolean; copayCents?: number }[];
}

/** What the booking service and HTTP layer need from a catalog. Every read is scoped to one tenant. */
export interface CatalogPort {
  tenantBySlug(slug: string): Promise<TenantRow | undefined>;
  states(tenantId: string): Promise<string[]>;
  clinics(tenantId: string, stateCode: string): Promise<PublicClinic[]>;
  clinic(tenantId: string, clinicId: string): Promise<PublicClinic | undefined>;
  visitTypes(tenantId: string, clinicId: string): Promise<VisitType[]>;
  providers(tenantId: string, clinicId: string, serviceId: string): Promise<PublicProvider[]>;
  eligible(tenantId: string, clinicId: string, serviceId: string, providerId: string): Promise<{ clinic: PublicClinic; visitType: VisitType; provider: PublicProvider } | undefined>;
  /** Display details for an EXISTING booking. Ignores active/bookable flags so a later deactivation never hides a patient's appointment. */
  describe(tenantId: string, clinicId: string, serviceId: string, providerId: string): Promise<{ clinic: PublicClinic; visitType: VisitType; provider: PublicProvider } | undefined>;
}
