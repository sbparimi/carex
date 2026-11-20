# CareX REST API v1

## Entry points

- Interactive OpenAPI: `/api/docs`
- OpenAPI JSON: `/api/openapi.json`
- Tenant API base: `/t/{tenant_slug}/api/v1`
- Tenant administration API: `/t/{tenant_slug}/api/admin` (existing admin-key authentication)

All API responses are JSON unless the endpoint returns HTTP 204. Authenticated patient and staff routes use the existing CareX opaque session token as `Authorization: Bearer <access_token>`. Patient and staff tokens are separate.

## Import into Postman

Import `postman/CareX-REST-API.postman_collection.json`. Set collection variables:
- `baseUrl`: deployed CareX origin
- `tenant`: active tenant slug
- `patientEmail` and `patientPassword`: unique email and password for a synthetic patient account
- `staffEmail` and `staffPassword`: a provisioned synthetic staff account
- `appointmentDate`: local date in the clinic timezone

Run public discovery first. The collection automatically stores the first clinic, visit type, provider, available slot and employer from the API responses. Patient signup stores the patient Bearer token; staff login stores the staff token. Use a fresh `Idempotency-Key` for each new appointment. The collection is intended for synthetic training data only.

## Patient API

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | Tenant API health | Public |
| GET | `/practice-types` | Practice categories | Public |
| GET | `/clinics` | Search/filter clinics | Public |
| GET | `/clinics/{clinic_id}` | Clinic details | Public |
| GET | `/clinics/{clinic_id}/visit-types` | Visit types | Public |
| GET | `/clinics/{clinic_id}/providers?visit_type_id=` | Eligible providers | Public |
| GET | `/clinics/{clinic_id}/plans` | Accepted plans | Public |
| GET | `/availability?... ` | Available appointment slots | Public or patient |
| GET | `/intake/config` | Intake and consent configuration | Public |
| GET | `/accounts/access-options?q=` | Employer and insurer signup choices | Public |
| POST | `/auth/signup` | Create patient account | Public |
| POST | `/auth/login` | Login; may return MFA challenge | Public |
| POST | `/auth/mfa/verify` | Complete MFA | Public |\n| POST | `/auth/password-reset/request` | Request reset instructions (non-enumerating response) | Public |\n| POST | `/auth/password-reset/confirm` | Set password using reset token | Public |
| GET | `/auth/me` | Current patient profile | Patient |
| POST | `/auth/logout` | Revoke patient session | Patient |
| GET/POST | `/patients` | List/add dependents | Patient |
| DELETE | `/patients/{patient_id}` | Remove dependent | Patient |
| POST | `/appointments` | Book an available slot | Patient |
| GET | `/appointments` | List own appointments | Patient |
| GET | `/appointments/{appointment_id}` | Get own appointment | Patient |
| POST | `/appointments/{appointment_id}/cancel` | Cancel own appointment | Patient |
| POST | `/appointments/{appointment_id}/reschedule` | Reschedule own appointment | Patient |
| PATCH | `/notifications/preferences` | Email/SMS preferences | Patient |
| GET/POST | `/waitlist` | List/join waitlist | Patient |
| DELETE | `/waitlist/{entry_id}` | Leave waitlist | Patient |

### Booking request

```http
POST /t/{tenant_slug}/api/v1/appointments
Authorization: Bearer <patient_token>
Idempotency-Key: course-booking-0001
Content-Type: application/json
```

```json
{
  "clinic_id": "clinic-id",
  "service_id": "visit-type-id",
  "provider_id": "provider-id",
  "slot_id": "slot-id",
  "reason": "Routine appointment",
  "modality": "in_person",
  "consent_version": "v1"
}
```

Booking uses the same intake, consent, coverage, eligibility, slot-locking and idempotency rules as the web application. A successful booking is immediately `confirmed` in the current business model; there is no separate provider-approval/pending-approval state.

## Staff/provider API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/staff/auth/login` | Staff login |
| GET | `/staff/auth/me` | Current staff profile |
| POST | `/staff/auth/logout` | Revoke staff session |
| GET | `/staff/catalog` | Staff-scoped clinics, providers and visit types |
| GET | `/staff/availability?...` | Provider-scoped slot lookup |\n| POST | `/staff/appointments` | Book a phone/walk-in patient (front desk/admin only; verbal consent attestation required) |\n| GET | `/staff/appointments?date=YYYY-MM-DD` | Day schedule (provider scope enforced) |
| GET | `/staff/appointments/{appointment_id}` | Appointment detail (provider scope enforced) |
| PATCH | `/staff/appointments/{appointment_id}/status` | Mark arrived/completed/no-show where permitted |
| POST | `/staff/appointments/{appointment_id}/cancel` | Staff cancellation |
| POST | `/staff/appointments/{appointment_id}/reschedule` | Staff reschedule |

Status transitions are validated by the existing domain state machine. Providers may mark visits `arrived` or `completed`; broader staff roles retain the existing permissions. Completing a visit queues a patient completion email/SMS in the transactional outbox. Actual delivery depends on configured channels and the notification dispatcher.

## Scheduling and notifications

- Confirmation, cancellation, reschedule and reminder messages are queued by the existing booking workflow.
- 24-hour and 2-hour reminders are scheduled relative to the current appointment time. Rescheduling supersedes old pending reminders and creates reminders for the new time.
- Visit completion queues a completion notification.
- The protected operational dispatcher remains `POST /internal/dispatch` with `Authorization: Bearer <CRON_SECRET>`. Do not expose the cron secret to course learners or put it in a Postman shared environment.
- Notification delivery is asynchronous. An API response confirms the workflow event was accepted/queued, not that an email or SMS reached a recipient.

## Important current product semantics

1. A patient booking is confirmed immediately. The current appointment schema/state machine does not include doctor approval or `pending_approval`.
2. The scheduled time does not automatically check a patient in or complete a visit. Staff/provider actions move the lifecycle to `arrived`, `completed` or `no_show`; reminder dispatch is time-driven.
3. Completion details are operational appointment details, not a clinical encounter note or medical record.
4. Use only synthetic data in training. Do not use real patient data, shared production credentials, or production admin/cron secrets.
