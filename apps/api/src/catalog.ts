import type { BrandConfig, PublicClinic, PublicProvider, VisitType } from "@carex/contracts";

export interface ClinicRow extends PublicClinic { tenantId: string; status: "active" | "inactive"; bookable: boolean }
export interface ServiceRow extends VisitType { tenantId: string; status: "active" | "inactive" }
export interface ProviderRow extends PublicProvider { tenantId: string; status: "active" | "inactive" }
export interface Eligibility { tenantId: string; clinicId: string; serviceId: string; providerId: string }
export interface TenantRow { id: string; slug: string; status: "active" | "suspended"; brand: BrandConfig; analyticsEnabled: boolean }

export interface CatalogData {
  tenants: TenantRow[]; clinics: ClinicRow[]; services: ServiceRow[]; providers: ProviderRow[];
  clinicServices: { tenantId: string; clinicId: string; serviceId: string; active: boolean }[];
  eligibility: (Eligibility & { active: boolean })[];
}

/**
 * Every read takes the tenant id and filters on it; there is no method that reads across tenants.
 * That makes cross-tenant leakage a property of this one class, covered by tests (BR-001, BR-012).
 */
export class Catalog {
  constructor(private data: CatalogData) {}

  tenantBySlug(slug: string): TenantRow | undefined {
    return this.data.tenants.find((t) => t.slug === slug && t.status === "active");
  }
  /** FR-002: only states with at least one active, bookable clinic. */
  states(tenantId: string): string[] {
    return [...new Set(this.clinicsIn(tenantId).map((c) => c.stateCode))].sort();
  }
  /** FR-003 / BR-003 */
  clinics(tenantId: string, stateCode: string): PublicClinic[] {
    return this.clinicsIn(tenantId).filter((c) => c.stateCode === stateCode).map(pubClinic).sort((a, b) => a.name.localeCompare(b.name));
  }
  clinic(tenantId: string, clinicId: string): PublicClinic | undefined {
    const c = this.clinicsIn(tenantId).find((x) => x.id === clinicId);
    return c && pubClinic(c);
  }
  /** FR-004 / BR-004: driven by clinic configuration, not a global list. */
  visitTypes(tenantId: string, clinicId: string): VisitType[] {
    if (!this.clinic(tenantId, clinicId)) return [];
    const ids = new Set(this.data.clinicServices.filter((x) => x.tenantId === tenantId && x.clinicId === clinicId && x.active).map((x) => x.serviceId));
    return this.data.services.filter((s) => s.tenantId === tenantId && s.status === "active" && ids.has(s.id)).map(({ tenantId: _t, status: _s, ...v }) => v);
  }
  /** FR-005 / BR-005 */
  providers(tenantId: string, clinicId: string, serviceId: string): PublicProvider[] {
    if (!this.visitTypes(tenantId, clinicId).some((v) => v.id === serviceId)) return [];
    const ids = new Set(this.data.eligibility.filter((e) => e.tenantId === tenantId && e.clinicId === clinicId && e.serviceId === serviceId && e.active).map((e) => e.providerId));
    return this.data.providers.filter((p) => p.tenantId === tenantId && p.status === "active" && ids.has(p.id)).map(({ id, displayName }) => ({ id, displayName }));
  }
  /** The full eligibility chain, checked server-side at booking time. */
  eligible(tenantId: string, clinicId: string, serviceId: string, providerId: string) {
    const clinic = this.clinic(tenantId, clinicId);
    const visitType = this.visitTypes(tenantId, clinicId).find((v) => v.id === serviceId);
    const provider = this.providers(tenantId, clinicId, serviceId).find((p) => p.id === providerId);
    return clinic && visitType && provider ? { clinic, visitType, provider } : undefined;
  }

  private clinicsIn(tenantId: string): ClinicRow[] {
    return this.data.clinics.filter((c) => c.tenantId === tenantId && c.status === "active" && c.bookable);
  }
}

const pubClinic = ({ tenantId: _t, status: _s, bookable: _b, ...c }: ClinicRow): PublicClinic => c;
