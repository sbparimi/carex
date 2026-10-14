import type { BrandConfig, PublicClinic, PublicProvider, VisitType } from "@carex/contracts";
import type { CatalogPort, TenantRow } from "./catalog.js";
import type { Db } from "./db.js";

interface TenantDbRow { id: string; slug: string; status: "active" | "suspended"; display_name: string; primary_color: string; logo_url: string | null; support_email: string | null; support_phone: string | null; analytics_enabled: number }
interface ClinicDbRow { id: string; name: string; city: string; address: string; state_code: string; time_zone: string }
interface VisitTypeDbRow { id: string; canonical_type: string; label: string; description: string }
interface ProviderDbRow { id: string; display_name: string }

const CLINIC_COLS = "c.id, c.name, c.city, c.address, c.state_code, c.time_zone";
const ACTIVE_CLINIC = "c.tenant_id = ? AND c.status = 'active' AND c.bookable = 1";

const toClinic = (r: ClinicDbRow): PublicClinic => ({ id: r.id, name: r.name, city: r.city, address: r.address, stateCode: r.state_code, timeZone: r.time_zone });
const toVisitType = (r: VisitTypeDbRow): VisitType => ({ id: r.id, canonicalType: r.canonical_type as VisitType["canonicalType"], label: r.label, description: r.description });
const toProvider = (r: ProviderDbRow): PublicProvider => ({ id: r.id, displayName: r.display_name });

/**
 * SQLite-backed CatalogPort. Mirrors the in-memory Catalog: every query is scoped by tenant_id
 * (on every joined table too) and uses bound parameters only (BR-001, BR-012, ADR-002).
 */
export class SqliteCatalog implements CatalogPort {
  constructor(private db: Db) {}

  tenantBySlug(slug: string): TenantRow | undefined {
    const r = this.db.prepare("SELECT id, slug, status, display_name, primary_color, logo_url, support_email, support_phone, analytics_enabled FROM tenants WHERE slug = ? AND status = 'active'").get(slug) as TenantDbRow | undefined;
    if (!r) return undefined;
    const brand: BrandConfig = { displayName: r.display_name, primaryColor: r.primary_color };
    if (r.logo_url !== null) brand.logoUrl = r.logo_url;
    if (r.support_email !== null) brand.supportEmail = r.support_email;
    if (r.support_phone !== null) brand.supportPhone = r.support_phone;
    return { id: r.id, slug: r.slug, status: r.status, brand, analyticsEnabled: r.analytics_enabled === 1 };
  }

  states(tenantId: string): string[] {
    const rows = this.db.prepare(`SELECT DISTINCT c.state_code FROM clinics c WHERE ${ACTIVE_CLINIC} ORDER BY c.state_code`).all(tenantId) as { state_code: string }[];
    return rows.map((r) => r.state_code);
  }

  clinics(tenantId: string, stateCode: string): PublicClinic[] {
    const rows = this.db.prepare(`SELECT ${CLINIC_COLS} FROM clinics c WHERE ${ACTIVE_CLINIC} AND c.state_code = ? ORDER BY c.name, c.id`).all(tenantId, stateCode) as unknown as ClinicDbRow[];
    return rows.map(toClinic);
  }

  clinic(tenantId: string, clinicId: string): PublicClinic | undefined {
    const r = this.db.prepare(`SELECT ${CLINIC_COLS} FROM clinics c WHERE ${ACTIVE_CLINIC} AND c.id = ?`).get(tenantId, clinicId) as ClinicDbRow | undefined;
    return r && toClinic(r);
  }

  visitTypes(tenantId: string, clinicId: string): VisitType[] {
    const rows = this.db.prepare(
      `SELECT v.id, v.canonical_type, v.label, v.description
         FROM clinics c
         JOIN clinic_visit_types cv ON cv.clinic_id = c.id AND cv.tenant_id = c.tenant_id AND cv.active = 1
         JOIN visit_types v ON v.id = cv.visit_type_id AND v.tenant_id = c.tenant_id AND v.status = 'active'
        WHERE ${ACTIVE_CLINIC} AND c.id = ?
        ORDER BY v.label, v.id`,
    ).all(tenantId, clinicId) as unknown as VisitTypeDbRow[];
    return rows.map(toVisitType);
  }

  providers(tenantId: string, clinicId: string, serviceId: string): PublicProvider[] {
    const rows = this.db.prepare(
      `SELECT p.id, p.display_name
         FROM clinics c
         JOIN clinic_visit_types cv ON cv.clinic_id = c.id AND cv.tenant_id = c.tenant_id AND cv.visit_type_id = ? AND cv.active = 1
         JOIN visit_types v ON v.id = cv.visit_type_id AND v.tenant_id = c.tenant_id AND v.status = 'active'
         JOIN provider_eligibility e ON e.clinic_id = c.id AND e.visit_type_id = v.id AND e.tenant_id = c.tenant_id AND e.active = 1
         JOIN providers p ON p.id = e.provider_id AND p.tenant_id = c.tenant_id AND p.status = 'active'
        WHERE ${ACTIVE_CLINIC} AND c.id = ?
        ORDER BY p.display_name, p.id`,
    ).all(serviceId, tenantId, clinicId) as unknown as ProviderDbRow[];
    return rows.map(toProvider);
  }

  eligible(tenantId: string, clinicId: string, serviceId: string, providerId: string) {
    const clinic = this.clinic(tenantId, clinicId);
    const visitType = this.visitTypes(tenantId, clinicId).find((v) => v.id === serviceId);
    const provider = this.providers(tenantId, clinicId, serviceId).find((p) => p.id === providerId);
    return clinic && visitType && provider ? { clinic, visitType, provider } : undefined;
  }
}
