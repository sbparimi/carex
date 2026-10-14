/** Ordered, append-only migrations. `PRAGMA user_version` records how many have been applied. Never edit an applied entry. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE tenants (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('active','suspended')),
    display_name TEXT NOT NULL, primary_color TEXT NOT NULL, logo_url TEXT, support_email TEXT, support_phone TEXT,
    analytics_enabled INTEGER NOT NULL DEFAULT 1 CHECK (analytics_enabled IN (0,1))
  );
  CREATE TABLE clinics (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL, state_code TEXT NOT NULL, time_zone TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','inactive')), bookable INTEGER NOT NULL CHECK (bookable IN (0,1))
  );
  CREATE INDEX clinics_tenant_state ON clinics(tenant_id, state_code);
  CREATE TABLE visit_types (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
    canonical_type TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 240),
    status TEXT NOT NULL CHECK (status IN ('active','inactive'))
  );
  CREATE TABLE clinic_visit_types (
    tenant_id TEXT NOT NULL, clinic_id TEXT NOT NULL REFERENCES clinics(id), visit_type_id TEXT NOT NULL REFERENCES visit_types(id),
    active INTEGER NOT NULL CHECK (active IN (0,1)), PRIMARY KEY (clinic_id, visit_type_id)
  );
  CREATE TABLE providers (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), display_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','inactive'))
  );
  CREATE TABLE provider_eligibility (
    tenant_id TEXT NOT NULL, clinic_id TEXT NOT NULL REFERENCES clinics(id), visit_type_id TEXT NOT NULL REFERENCES visit_types(id),
    provider_id TEXT NOT NULL REFERENCES providers(id), active INTEGER NOT NULL CHECK (active IN (0,1)),
    PRIMARY KEY (clinic_id, visit_type_id, provider_id)
  );
  -- Weekly working hours in the clinic's LOCAL time. weekday: 0 = Sunday .. 6 = Saturday. Minutes since local midnight.
  CREATE TABLE availability_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, provider_id TEXT NOT NULL REFERENCES providers(id),
    clinic_id TEXT NOT NULL REFERENCES clinics(id), weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439), end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
    CHECK (end_minute > start_minute)
  );
  CREATE INDEX availability_provider ON availability_rules(provider_id, clinic_id, weekday);
  CREATE TABLE time_off (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, provider_id TEXT NOT NULL REFERENCES providers(id),
    starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, CHECK (ends_at > starts_at)
  );
  CREATE TABLE appointments (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
    clinic_id TEXT NOT NULL REFERENCES clinics(id), visit_type_id TEXT NOT NULL REFERENCES visit_types(id), provider_id TEXT NOT NULL REFERENCES providers(id),
    starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled')),
    idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
    patient_first_name TEXT NOT NULL, patient_last_name TEXT NOT NULL, patient_email TEXT, patient_phone TEXT,
    created_at TEXT NOT NULL, cancelled_at TEXT
  );
  CREATE UNIQUE INDEX appointments_idem ON appointments(tenant_id, idempotency_key);
  CREATE UNIQUE INDEX appointments_slot ON appointments(provider_id, starts_at) WHERE status = 'confirmed';
  CREATE INDEX appointments_provider_time ON appointments(provider_id, starts_at);
  `,
  `
  ALTER TABLE appointments ADD COLUMN updated_at TEXT;
  ALTER TABLE appointments ADD COLUMN reschedule_count INTEGER NOT NULL DEFAULT 0;
  `,
  `
  CREATE TABLE admin_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL REFERENCES tenants(id),
    key_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT
  );
  `,
];
