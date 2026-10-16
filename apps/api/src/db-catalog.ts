import type { BrandConfig, PublicClinic, PublicProvider, VisitType } from "@carex/contracts";
import type { CatalogPort, TenantRow } from "./catalog.js";
import type { Db } from "./db.js";

interface TenantDbRow { id: string; slug: string; status: "active" | "suspended"; display_name: string; primary_color: string; logo_url: string | null; support_email: string | null; support_phone: string | null; analytics_enabled: number }
interface ClinicDbRow { id: string; name: string; city: string; address: string; state_code: string; time_zone: string }
interface VisitTypeDbRow { id: string; canonical_type: string; label: string; description: string; duration_min?: number; modality?: string; requires_referral?: number; min_age?: number | null; max_age?: number | null }
interface ProviderDbRow { id: string; display_name: string; specialty?: string; languages?: string; accepting_new?: number; bio?: string }

const CLINIC_COLS = "c.id, c.name, c.city, c.address, c.state_code, c.time_zone";
const ACTIVE_CLINIC = "c.tenant_id = ? AND c.status = 'active' AND c.bookable = 1";

const toClinic = (r: ClinicDbRow): PublicClinic => ({ id: r.id, name: r.name, city: r.city, address: r.address, stateCode: r.state_code, timeZone: r.time_zone });
const toVisitType = (r: VisitTypeDbRow): VisitType => ({
  id: r.id, canonicalType: r.canonical_type as VisitType["canonicalType"], label: r.label, description: r.description,
  ...(r.duration_min ? { durationMin: r.duration_min } : {}), ...(r.modality ? { modality: r.modality as NonNullable<VisitType["modality"]> } : {}),
  ...(r.requires_referral ? { requiresReferral: true } : {}), ...(r.min_age != null ? { minAge: r.min_age } : {}), ...(r.max_age != null ? { maxAge: r.max_age } : {}),
});
const toProvider = (r: ProviderDbRow): PublicProvider => ({
  id: r.id, displayName: r.display_name,
  ...(r.specialty ? { specialty: r.specialty } : {}), ...(r.languages && r.languages !== "[]" ? { languages: JSON.parse(r.languages) as string[] } : {}),
  ...(r.accepting_new === 0 ? { acceptingNew: false } : {}), ...(r.bio ? { bio: r.bio } : {}),
});

/**
 * SQLite-backed CatalogPort. Mirrors the in-memory Catalog: every query is scoped by tenant_id
 * (on every joined table too) and uses bound parameters only (BR-001, BR-012, ADR-002).
 */
export class DbCatalog implements CatalogPort {
  constructor(private db: Db) {}

  async tenantBySlug(slug: string): Promise<TenantRow | undefined> {
    const r = await this.db.get<TenantDbRow>("SELECT id, slug, status, display_name, primary_color, logo_url, support_email, support_phone, analytics_enabled FROM tenants WHERE slug = ? AND status = 'active'", slug);
    if (!r) return undefined;
    const brand: BrandConfig = { displayName: r.display_name, primaryColor: r.primary_color };
    if (r.logo_url !== null) brand.logoUrl = r.logo_url;
    if (r.support_email !== null) brand.supportEmail = r.support_email;
    if (r.support_phone !== null) brand.supportPhone = r.support_phone;
    return { id: r.id, slug: r.slug, status: r.status, brand, analyticsEnabled: r.analytics_enabled === 1 };
  }

  async states(tenantId: string): Promise<string[]> {
    const rows = await this.db.all<{ state_code: string }>(`SELECT DISTINCT c.state_code FROM clinics c WHERE ${ACTIVE_CLINIC} ORDER BY c.state_code`, tenantId);
    return rows.map((r) => r.state_code);
  }

  async clinics(tenantId: string, stateCode: string): Promise<PublicClinic[]> {
    const rows = await this.db.all<ClinicDbRow>(`SELECT ${CLINIC_COLS} FROM clinics c WHERE ${ACTIVE_CLINIC} AND c.state_code = ? ORDER BY c.name, c.id`, tenantId, stateCode);
    return rows.map(toClinic);
  }

  async clinic(tenantId: string, clinicId: string): Promise<PublicClinic | undefined> {
    const r = await this.db.get<ClinicDbRow>(`SELECT ${CLINIC_COLS} FROM clinics c WHERE ${ACTIVE_CLINIC} AND c.id = ?`, tenantId, clinicId);
    return r && toClinic(r);
  }

  async visitTypes(tenantId: string, clinicId: string): Promise<VisitType[]> {
    const rows = await this.db.all<VisitTypeDbRow>(
      `SELECT v.id, v.canonical_type, v.label, v.description, v.duration_min, v.modality, v.requires_referral, v.min_age, v.max_age
         FROM clinics c
         JOIN clinic_visit_types cv ON cv.clinic_id = c.id AND cv.tenant_id = c.tenant_id AND cv.active = 1
         JOIN visit_types v ON v.id = cv.visit_type_id AND v.tenant_id = c.tenant_id AND v.status = 'active'
        WHERE ${ACTIVE_CLINIC} AND c.id = ?
        ORDER BY v.label, v.id`,
      tenantId, clinicId);
    return rows.map(toVisitType);
  }

  async providers(tenantId: string, clinicId: string, serviceId: string): Promise<PublicProvider[]> {
    const rows = await this.db.all<ProviderDbRow>(
      `SELECT p.id, p.display_name, p.specialty, p.languages, p.accepting_new, p.bio
         FROM clinics c
         JOIN clinic_visit_types cv ON cv.clinic_id = c.id AND cv.tenant_id = c.tenant_id AND cv.visit_type_id = ? AND cv.active = 1
         JOIN visit_types v ON v.id = cv.visit_type_id AND v.tenant_id = c.tenant_id AND v.status = 'active'
         JOIN provider_eligibility e ON e.clinic_id = c.id AND e.visit_type_id = v.id AND e.tenant_id = c.tenant_id AND e.active = 1
         JOIN providers p ON p.id = e.provider_id AND p.tenant_id = c.tenant_id AND p.status = 'active'
        WHERE ${ACTIVE_CLINIC} AND c.id = ?
        ORDER BY p.display_name, p.id`,
      serviceId, tenantId, clinicId);
    return rows.map(toProvider);
  }

  async eligible(tenantId: string, clinicId: string, serviceId: string, providerId: string) {
    const clinic = await this.clinic(tenantId, clinicId);
    const visitType = (await this.visitTypes(tenantId, clinicId)).find((v) => v.id === serviceId);
    const provider = (await this.providers(tenantId, clinicId, serviceId)).find((p) => p.id === providerId);
    return clinic && visitType && provider ? { clinic, visitType, provider } : undefined;
  }

  /** For an existing booking: names only, regardless of active/bookable flags, still scoped to the tenant. */
  async describe(tenantId: string, clinicId: string, serviceId: string, providerId: string) {
    const c = await this.db.get<ClinicDbRow>(`SELECT ${CLINIC_COLS} FROM clinics c WHERE c.tenant_id = ? AND c.id = ?`, tenantId, clinicId);
    const v = await this.db.get<VisitTypeDbRow>("SELECT v.id, v.canonical_type, v.label, v.description, v.duration_min, v.modality, v.requires_referral, v.min_age, v.max_age FROM visit_types v WHERE v.tenant_id = ? AND v.id = ?", tenantId, serviceId);
    const p = await this.db.get<ProviderDbRow>("SELECT p.id, p.display_name, p.specialty, p.languages, p.accepting_new, p.bio FROM providers p WHERE p.tenant_id = ? AND p.id = ?", tenantId, providerId);
    return c && v && p ? { clinic: toClinic(c), visitType: toVisitType(v), provider: toProvider(p) } : undefined;
  }
}
