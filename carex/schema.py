"""Append-only migrations. Never edit an applied entry; add a new one. Each migration is a list of portable SQL statements.
`{ID}` expands to an auto-incrementing primary key. Timestamps are ISO-8601 UTC text; flags are 0/1 integers."""

V1 = [
    """CREATE TABLE tenants (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK (status IN ('active','suspended')),
        display_name TEXT NOT NULL, primary_color TEXT NOT NULL, logo_url TEXT, support_email TEXT, support_phone TEXT,
        analytics_enabled INTEGER NOT NULL DEFAULT 1 CHECK (analytics_enabled IN (0,1)),
        video_join_base_url TEXT, intake_required INTEGER NOT NULL DEFAULT 1 CHECK (intake_required IN (0,1)),
        consent_version TEXT NOT NULL DEFAULT 'v1', late_cancel_hours INTEGER NOT NULL DEFAULT 24, policy_text TEXT NOT NULL DEFAULT '',
        session_idle_minutes INTEGER NOT NULL DEFAULT 30 CHECK (session_idle_minutes BETWEEN 5 AND 480),
        mfa_required INTEGER NOT NULL DEFAULT 0 CHECK (mfa_required IN (0,1))
    )""",
    """CREATE TABLE clinics (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL,
        state_code TEXT NOT NULL, time_zone TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','inactive')),
        bookable INTEGER NOT NULL CHECK (bookable IN (0,1))
    )""",
    "CREATE INDEX clinics_tenant_state ON clinics(tenant_id, state_code)",
    """CREATE TABLE visit_types (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), canonical_type TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL,
        duration_min INTEGER NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 240), status TEXT NOT NULL CHECK (status IN ('active','inactive')),
        min_lead_minutes INTEGER, horizon_days INTEGER,
        buffer_before_min INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_min BETWEEN 0 AND 120),
        buffer_after_min INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_min BETWEEN 0 AND 120),
        min_age INTEGER, max_age INTEGER,
        new_patients TEXT NOT NULL DEFAULT 'any' CHECK (new_patients IN ('any','new_only','established_only')),
        modality TEXT NOT NULL DEFAULT 'in_person' CHECK (modality IN ('in_person','telehealth','either')),
        requires_referral INTEGER NOT NULL DEFAULT 0 CHECK (requires_referral IN (0,1)), resource_kind TEXT
    )""",
    """CREATE TABLE clinic_visit_types (
        tenant_id TEXT NOT NULL, clinic_id TEXT NOT NULL REFERENCES clinics(id), visit_type_id TEXT NOT NULL REFERENCES visit_types(id),
        active INTEGER NOT NULL CHECK (active IN (0,1)), PRIMARY KEY (clinic_id, visit_type_id)
    )""",
    """CREATE TABLE providers (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), display_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active','inactive')),
        specialty TEXT NOT NULL DEFAULT '', languages TEXT NOT NULL DEFAULT '[]', licensed_states TEXT NOT NULL DEFAULT '[]',
        accepting_new INTEGER NOT NULL DEFAULT 1 CHECK (accepting_new IN (0,1)), bio TEXT NOT NULL DEFAULT ''
    )""",
    """CREATE TABLE provider_eligibility (
        tenant_id TEXT NOT NULL, clinic_id TEXT NOT NULL REFERENCES clinics(id), visit_type_id TEXT NOT NULL REFERENCES visit_types(id),
        provider_id TEXT NOT NULL REFERENCES providers(id), active INTEGER NOT NULL CHECK (active IN (0,1)),
        PRIMARY KEY (clinic_id, visit_type_id, provider_id)
    )""",
    # Weekly hours in the clinic's LOCAL time. weekday: 0 = Sunday .. 6 = Saturday. Minutes since local midnight.
    """CREATE TABLE availability_rules (
        id {ID}, tenant_id TEXT NOT NULL, provider_id TEXT NOT NULL REFERENCES providers(id), clinic_id TEXT NOT NULL REFERENCES clinics(id),
        weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
        end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 1 AND 1440), CHECK (end_minute > start_minute)
    )""",
    "CREATE INDEX availability_provider ON availability_rules(provider_id, clinic_id, weekday)",
    """CREATE TABLE time_off (
        id {ID}, tenant_id TEXT NOT NULL, provider_id TEXT NOT NULL REFERENCES providers(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
        CHECK (ends_at > starts_at)
    )""",
    """CREATE TABLE clinic_resources (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), clinic_id TEXT NOT NULL REFERENCES clinics(id),
        kind TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
    )""",
    "CREATE INDEX clinic_resources_kind ON clinic_resources(tenant_id, clinic_id, kind)",
    """CREATE TABLE clinic_closures (
        id {ID}, tenant_id TEXT NOT NULL REFERENCES tenants(id), clinic_id TEXT NOT NULL REFERENCES clinics(id),
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', CHECK (ends_at > starts_at)
    )""",
    "CREATE INDEX clinic_closures_clinic ON clinic_closures(tenant_id, clinic_id, starts_at)",
    """CREATE TABLE admin_keys (
        id {ID}, tenant_id TEXT NOT NULL REFERENCES tenants(id), key_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
        created_at TEXT NOT NULL, revoked_at TEXT
    )""",
    """CREATE TABLE employers (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
        verification TEXT NOT NULL DEFAULT 'none' CHECK (verification IN ('none','domain','roster')), email_domain TEXT,
        UNIQUE (tenant_id, name)
    )""",
    "CREATE TABLE insurers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, UNIQUE (tenant_id, name))",
    """CREATE TABLE employer_roster (
        tenant_id TEXT NOT NULL REFERENCES tenants(id), employer_id TEXT NOT NULL REFERENCES employers(id), email TEXT NOT NULL,
        PRIMARY KEY (employer_id, email)
    )""",
    """CREATE TABLE insurer_networks (
        tenant_id TEXT NOT NULL REFERENCES tenants(id), insurer_id TEXT NOT NULL REFERENCES insurers(id), clinic_id TEXT NOT NULL REFERENCES clinics(id),
        PRIMARY KEY (insurer_id, clinic_id)
    )""",
    # Most specific rule wins: (employer or insurer + visit) > (visit only). No rule means covered with no copay.
    """CREATE TABLE coverage_rules (
        id {ID}, tenant_id TEXT NOT NULL REFERENCES tenants(id), visit_type_id TEXT NOT NULL REFERENCES visit_types(id),
        employer_id TEXT REFERENCES employers(id), insurer_id TEXT REFERENCES insurers(id),
        covered INTEGER NOT NULL DEFAULT 1 CHECK (covered IN (0,1)), copay_cents INTEGER NOT NULL DEFAULT 0 CHECK (copay_cents >= 0),
        CHECK (employer_id IS NULL OR insurer_id IS NULL)
    )""",
    "CREATE INDEX coverage_rules_visit ON coverage_rules(tenant_id, visit_type_id)",
    """CREATE TABLE users (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL, password_hash TEXT NOT NULL,
        first_name TEXT NOT NULL, last_name TEXT NOT NULL, date_of_birth TEXT NOT NULL, phone TEXT NOT NULL,
        access_type TEXT NOT NULL CHECK (access_type IN ('employer','insurer')),
        employer_id TEXT REFERENCES employers(id), insurer_id TEXT REFERENCES insurers(id),
        failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL,
        notify_email INTEGER NOT NULL DEFAULT 1 CHECK (notify_email IN (0,1)), notify_sms INTEGER NOT NULL DEFAULT 0 CHECK (notify_sms IN (0,1)),
        UNIQUE (tenant_id, email),
        CHECK ((access_type = 'employer' AND employer_id IS NOT NULL AND insurer_id IS NULL) OR (access_type = 'insurer' AND insurer_id IS NOT NULL AND employer_id IS NULL))
    )""",
    """CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT NOT NULL, created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL, last_seen_at TEXT
    )""",
    "CREATE INDEX sessions_user ON sessions(user_id)",
    """CREATE TABLE password_resets (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
    )""",
    """CREATE TABLE mfa_challenges (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT NOT NULL,
        code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used_at TEXT
    )""",
    """CREATE TABLE patients (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id),
        relationship TEXT NOT NULL CHECK (relationship IN ('self','child','spouse','parent','other')),
        first_name TEXT NOT NULL, last_name TEXT NOT NULL, date_of_birth TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    "CREATE INDEX patients_user ON patients(tenant_id, user_id)",
    "CREATE UNIQUE INDEX patients_one_self ON patients(user_id) WHERE relationship = 'self'",
    """CREATE TABLE staff_users (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('front_desk','provider','admin')), provider_id TEXT REFERENCES providers(id),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL,
        UNIQUE (tenant_id, email), CHECK (role <> 'provider' OR provider_id IS NOT NULL)
    )""",
    """CREATE TABLE staff_sessions (
        token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff_users(id), tenant_id TEXT NOT NULL, created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
    )""",
    "CREATE INDEX staff_sessions_staff ON staff_sessions(staff_id)",
    """CREATE TABLE appointments (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), clinic_id TEXT NOT NULL REFERENCES clinics(id),
        visit_type_id TEXT NOT NULL REFERENCES visit_types(id), provider_id TEXT NOT NULL REFERENCES providers(id),
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled','arrived','completed','no_show')),
        idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
        patient_first_name TEXT NOT NULL, patient_last_name TEXT NOT NULL, patient_email TEXT, patient_phone TEXT,
        created_at TEXT NOT NULL, cancelled_at TEXT, updated_at TEXT, reschedule_count INTEGER NOT NULL DEFAULT 0,
        user_id TEXT REFERENCES users(id), resource_id TEXT REFERENCES clinic_resources(id), status_changed_at TEXT,
        patient_id TEXT REFERENCES patients(id), reason TEXT,
        modality TEXT NOT NULL DEFAULT 'in_person' CHECK (modality IN ('in_person','telehealth')),
        patient_state TEXT, interpreter_language TEXT, accommodations TEXT, referral_ref TEXT,
        copay_cents INTEGER NOT NULL DEFAULT 0, join_url TEXT, booked_by TEXT NOT NULL DEFAULT 'patient',
        cancel_reason TEXT, cancelled_by TEXT, late_cancel INTEGER NOT NULL DEFAULT 0,
        patient_dob TEXT, booked_by_staff_id TEXT, contact_sms_ok INTEGER NOT NULL DEFAULT 0
    )""",
    "CREATE UNIQUE INDEX appointments_idem ON appointments(tenant_id, idempotency_key)",
    "CREATE UNIQUE INDEX appointments_slot ON appointments(provider_id, starts_at) WHERE status <> 'cancelled'",
    "CREATE UNIQUE INDEX appointments_resource_slot ON appointments(resource_id, starts_at) WHERE status <> 'cancelled' AND resource_id IS NOT NULL",
    "CREATE INDEX appointments_provider_time ON appointments(provider_id, starts_at)",
    "CREATE INDEX appointments_user ON appointments(tenant_id, user_id, starts_at)",
    "CREATE INDEX appointments_patient ON appointments(tenant_id, patient_id)",
    """CREATE TABLE consent_records (
        id {ID}, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT REFERENCES users(id), patient_id TEXT REFERENCES patients(id),
        kind TEXT NOT NULL, version TEXT NOT NULL, accepted_at TEXT NOT NULL, appointment_id TEXT, recorded_by TEXT
    )""",
    """CREATE TABLE outbox (
        id {ID}, tenant_id TEXT NOT NULL REFERENCES tenants(id), kind TEXT NOT NULL, channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
        appointment_id TEXT REFERENCES appointments(id), user_id TEXT REFERENCES users(id), waitlist_id INTEGER,
        send_after TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, sent_at TEXT, dedupe_key TEXT NOT NULL,
        to_email TEXT, to_phone TEXT, to_name TEXT, to_sms_ok INTEGER NOT NULL DEFAULT 0
    )""",
    "CREATE UNIQUE INDEX outbox_dedupe ON outbox(tenant_id, dedupe_key)",
    "CREATE INDEX outbox_due ON outbox(status, send_after)",
    "CREATE INDEX outbox_appt ON outbox(appointment_id)",
    """CREATE TABLE waitlist (
        id {ID}, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), patient_id TEXT REFERENCES patients(id),
        clinic_id TEXT NOT NULL REFERENCES clinics(id), visit_type_id TEXT NOT NULL REFERENCES visit_types(id), provider_id TEXT REFERENCES providers(id),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','notified','booked','cancelled')), created_at TEXT NOT NULL, notified_at TEXT
    )""",
    "CREATE INDEX waitlist_match ON waitlist(tenant_id, clinic_id, visit_type_id, status)",
    """CREATE TABLE audit_log (
        id {ID}, tenant_id TEXT NOT NULL, at TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK (actor_type IN ('user','staff','admin','system','anonymous')), actor_id TEXT,
        action TEXT NOT NULL, target_type TEXT, target_id TEXT, ip_hash TEXT, detail TEXT
    )""",
    "CREATE INDEX audit_tenant_time ON audit_log(tenant_id, at)",
    "CREATE INDEX audit_target ON audit_log(tenant_id, target_type, target_id)",
]

# Version 2: clinics are grouped into headquarters / prominent / other locations on the state screen.
V2 = [
    "ALTER TABLE clinics ADD COLUMN tier TEXT NOT NULL DEFAULT 'other' CHECK (tier IN ('hq','major','other'))",
    "ALTER TABLE clinics ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100",
]

# Version 3: clinic details shown to patients, one-tap manage links in messages, and anonymous funnel events (no personal data).
V3 = [
    "ALTER TABLE clinics ADD COLUMN phone TEXT",
    "ALTER TABLE clinics ADD COLUMN hours_text TEXT",
    "ALTER TABLE clinics ADD COLUMN about TEXT",
    "ALTER TABLE clinics ADD COLUMN image_url TEXT",
    "ALTER TABLE appointments ADD COLUMN manage_token TEXT",
    "CREATE UNIQUE INDEX appointments_manage_token ON appointments(manage_token) WHERE manage_token IS NOT NULL",
    """CREATE TABLE events (
        id {ID}, tenant_id TEXT NOT NULL, at TEXT NOT NULL, name TEXT NOT NULL, ref TEXT
    )""",
    "CREATE INDEX events_tenant_time ON events(tenant_id, at)",
]

# Version 4: an optional clinician photo shown on clinic pages.
V4 = [
    "ALTER TABLE providers ADD COLUMN photo_url TEXT",
]

# Version 5: durable account-closure state. Booking transactions lock the user row and
# reject accounts once closure begins, preventing new bookings during erasure retries.
V5 = [
    "ALTER TABLE users ADD COLUMN closure_status TEXT NOT NULL DEFAULT 'active' CHECK (closure_status IN ('active','pending','erased'))",
    "CREATE INDEX users_closure_status ON users(tenant_id, closure_status)",
]


# Version 6: first-class practice categories. Categories are assigned per clinic;
# booking continues to use visit_types, providers and availability.
V6 = [
    """CREATE TABLE practice_types (
        code TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 100
    )""",
    "INSERT INTO practice_types (code, label, description, sort_order) VALUES ('physiotherapy','Physiotherapy','Movement, recovery and physical rehabilitation',10)",
    "INSERT INTO practice_types (code, label, description, sort_order) VALUES ('dental','Dental care','Preventive and general oral healthcare',20)",
    "INSERT INTO practice_types (code, label, description, sort_order) VALUES ('fitness','Fitness','Fitness assessments, coaching and exercise programmes',30)",
    "INSERT INTO practice_types (code, label, description, sort_order) VALUES ('primary_care','Primary care','Everyday healthcare, prevention and ongoing care',40)",
    "INSERT INTO practice_types (code, label, description, sort_order) VALUES ('womens_wellness','Women’s wellness','Women’s health and wellbeing services',50)",
    "INSERT INTO practice_types (code, label, description, sort_order) VALUES ('general_health','General health','General health and wellbeing services',60)",
    """CREATE TABLE clinic_practice_types (
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        clinic_id TEXT NOT NULL REFERENCES clinics(id),
        practice_type_code TEXT NOT NULL REFERENCES practice_types(code),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        PRIMARY KEY (clinic_id, practice_type_code)
    )""",
    "CREATE INDEX clinic_practice_types_tenant ON clinic_practice_types(tenant_id, practice_type_code, active)",
]

MIGRATIONS = [V1, V2, V3, V4, V5, V6]

