# ADR-008: Clinical intake, notifications, staff console and audit (CareX is the system of record)

Status: built; **needs clinical and legal review before real patients** (see "Review required").

## Decision
No external EHR is connected. CareX holds scheduling, patient (self and dependents), consent, screening result, coverage decision and the audit trail. Everything below is server-enforced; the web screens only make problems visible earlier.

## What was built
| Area | Behaviour | Where |
|---|---|---|
| Scheduling rules | Weekly hours minus appointments, time off, clinic closures, buffers, rooms/resources, per-visit lead time and horizon, age limits, new vs established patient. Per-provider advisory lock; unique indexes make double booking impossible. | `db-scheduling.ts` |
| Who the visit is for | Account holder plus dependents (child, spouse, parent, other). Rules use the patient's age, not the account holder's. | `intake.ts` |
| Safety screening | Red-flag list; any "yes" is refused by the server with `emergency_redirect` and the 911/988 message. Never booked. | `triage.ts` |
| Consent | Versioned text; each booking records who consented, version and time. Staff-booked patients: staff attests verbal consent. | `intake.ts` |
| Reason, referral | Reason required when intake is on; visit types can require a referral number. | `intake.ts` |
| Video visits | Patient's state must be a state the provider is licensed in; join link from the tenant's video base URL. | `intake.ts` |
| Coverage | Insurer network and per-visit copay/covered rules; employer sign-up verified against domain or roster. Eligibility of an individual member is **not** verified (needs a vendor feed). | `intake.ts` |
| Notifications | Transactional outbox written in the booking transaction: confirmation, 24 h and 2 h reminders, cancellation, reschedule, waitlist opening. Email via Resend, SMS via Twilio (opt-in only). Retries with backoff, lease so two workers never send twice. | `notify.ts` |
| Waitlist | Patients ask to be told when an earlier time opens; oldest three are told on each release. | `waitlist.ts` |
| Cancellation policy | Reason captured; late cancel flagged using the tenant's `late_cancel_hours`. | `db-scheduling.ts` |
| Sessions and MFA | 30 min idle timeout (tenant setting), 24 h absolute (patients), 12 h (staff). Optional emailed 6-digit code per tenant (`mfa_required`). | `accounts.ts` |
| Audit | Append-only log of views, bookings, changes, exports, logins, failures. Stores a hashed IP, never secrets or message bodies. | `audit.ts` |
| Staff console | Separate staff accounts and cookie. Roles: front desk, provider (own patients only; check-in/complete), admin. Day schedule, status changes, cancel, reschedule, book for phone/walk-in patients, time off, closures, CSV export, FHIR R4 Appointment bundle (admin API). | `staff.ts`, `apps/web/src/staff.ts` |

## Review required (not engineering decisions)
1. **Red-flag list and phrases** (`triage.ts`) are a placeholder. A clinician must approve the list, wording and any condition-specific variants.
2. **Consent text** (`intake.ts`) is a placeholder. Counsel must supply the real text and version it.
3. **HIPAA / state law:** business associate agreements with the database, hosting, email and SMS vendors; retention and deletion policy; breach process; minimum-necessary review of what the staff CSV export contains; reminder wording (no diagnosis or visit reason in email/SMS).
4. **Telehealth licensure rules** differ by state and profession; the data (`licensed_states`) must be maintained by the clinic.

## Known limits
- Concurrency tests run on PGlite only; run them against a Neon branch before launch.
- Request rate limits are per serverless instance (needs a shared store).
- No payment capture or fee handling; copay is shown, collected at the visit.
- SMS and email work only when vendor credentials are configured; otherwise rows stay queued.
- Staff hours (weekly availability) are edited through the admin API, not the staff screen.
- No interpreter scheduling, UI translation or distance search.
- Commits in this repository are not cryptographically signed.
