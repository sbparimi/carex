# ADR-002: CareX-native scheduling and persistence

Status: accepted by the Product Owner's instruction on 2026-10-14 ("stop building mock, I want the real system"). Scope: no AI features.

## Context
Phase 1 proved the booking journey against an in-memory mock source. The Product Owner wants the real system, with CareX itself as the system of record for availability and appointments, branded CareX. No external EHR or scheduler was named, so none is integrated.

## Decision
- **CareX owns scheduling.** Providers have weekly availability rules (in the clinic's local time zone), time off, and eligible visit types. Open slots are computed from those rules minus confirmed appointments. The existing `SchedulingSource` interface stays as the seam, so an external EHR adapter can be added later without touching the booking service.
- **Storage:** SQLite through Node's built-in `node:sqlite` (zero dependencies, real transactions, file persistence). It is a single-node store. Moving to PostgreSQL is a later, separate decision; all SQL lives behind `catalog` and `scheduling` classes so the swap is local. `node:sqlite` is flagged experimental by Node 22; this is accepted for now and recorded as a risk.
- **Integrity in the database, not only in code:** a partial unique index on `(provider_id, starts_at)` for confirmed appointments, and a unique `(tenant_id, idempotency_key)`. Booking runs in one `BEGIN IMMEDIATE` transaction that revalidates the slot. Two concurrent bookings for one slot cannot both commit.
- **Tenant isolation:** every table carries `tenant_id`; every query filters on it; there is no cross-tenant read method. The existing cross-tenant regression tests run against the SQLite implementation.
- **Time:** instants are stored as UTC ISO strings; availability is stored as local minutes-of-day per clinic time zone and converted with `Intl` (DST-aware: nonexistent local times produce no slot; ambiguous ones use the first occurrence).
- **Identity:** guest booking now. Optional login is a separate task and needs an authentication design and Product Owner approval before it is built.
- **Data:** synthetic only. The appointments table holds patient name and contact details, which are PHI once real. Encryption at rest, retention, access logging and the HIPAA/legal question are open and block any real data (PRD §21). No claim of compliance is made.

## Consequences
- The mock is removed from production code. Tests that need faults use a decorator around the real engine (`FaultInjectingScheduling`), which exists only in test and e2e entries.
- Slots are no longer fixed 17:00/17:30/18:00 UTC; e2e tests must read slots from the API instead of assuming times.
- A restart no longer loses bookings; the in-memory idempotency cache in `BookingService` remains an optimisation, with the database unique key as the source of truth.

## Alternatives rejected
- Integrating a named EHR now: none chosen, and guessing a vendor would waste the work.
- PostgreSQL first: needs a server and credentials the Product Owner has not provided; SQLite lets the real logic be built and tested now.
