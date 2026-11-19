# CareX product traceability and implementation status

**Reviewed:** 2026-11-19  
**Source of truth:** current Python implementation on the repository default branch. This document supersedes older TypeScript/Node-era evidence. A passing test count is not asserted here; use the current CI run as the authoritative execution record.

## Product boundary
CareX currently provides multi-tenant appointment booking and outpatient practice operations. It is **not yet a complete electronic health record (EHR)** and must not be marketed as one. The current clinical record scope is limited; there are no production-ready encounter, diagnosis, medication, allergy, order or result workflows.

The supported runtime is Python, FastAPI, Jinja-rendered HTML and SQLite/PostgreSQL. ADR-009 is authoritative. The application is intentionally usable without JavaScript.

## Current capabilities
| Area | Current implementation | Important limitation |
|---|---|---|
| Tenant and clinic configuration | Tenant, clinic, visit type, provider, eligibility and brand configuration | Tenant isolation needs database-enforced controls and adversarial tests |
| Patient access | Patient accounts, dependents, sessions, password reset, optional email MFA | Workforce MFA/SSO and recovery hardening remain |
| Scheduling | Availability, time off, closures, resources, booking, cancellation, rescheduling | Scheduling is not a clinical encounter |
| Practice operations | Staff console, waitlist, reminders/outbox, insights, CSV workflows | Revenue-cycle and claims workflows are incomplete |
| Privacy | Patient export, activity history and account anonymisation | Retention/legal basis and erasure orchestration need policy and validation |
| Audit | Tenant-scoped audit event table and service | Audit durability and immutability controls require production hardening |
| Interoperability | Limited FHIR R4 Appointment export | Not a FHIR server, US Core implementation or certification |
| Deployment | Vercel + Neon configuration | AWS target architecture and production controls are not implemented |
| UI | Server-rendered pages and responsive CSS | Needs ongoing WCAG 2.2 AA validation and task-based usability testing |

## Release evidence rules
- CI is the source of truth for test execution. Do not copy historical test counts from old harness reports into current release claims.
- Tests must cover SQLite and PostgreSQL paths, including migrations and concurrency.
- Accessibility evidence must name the tested commit, browser/assistive technology, WCAG criteria and known exceptions.
- No HIPAA compliance, certification, ONC certification, FHIR conformance or clinical safety claim is permitted without relevant independent evidence and accountable review.
- Until a production security and privacy programme is approved, use synthetic data only.

## Required capability backlog
### P0 — security and data integrity
- Make required audit persistence failures visible and prevent silent success.
- Make account closure recoverable; do not anonymise an account while future confirmed appointments remain active.
- Enforce tenant boundaries through database constraints/RLS where supported, plus negative cross-tenant tests.
- Remove demo seed credentials and routes from production deployments; isolate demo data and secrets.
- Replace per-instance rate limits with a shared store for multi-instance production and validate trusted proxy configuration.
- Require MFA for workforce/admin access; implement session/device revocation and privileged-access controls.
- Establish security logging, incident response, backup/restore and key rotation evidence.

### P1 — clinical record foundation
- Patient identity and duplicate reconciliation.
- Encounter lifecycle, provider attribution, signed/amended notes and provenance.
- Problem list, conditions, allergies and medication reconciliation.
- Orders, results, acknowledgement and escalation tracking.
- Clinical document storage with access policy and retention.
- Clinical safety review, hazard log and usability validation before enabling clinical decision workflows.

### P2 — practice operations and revenue cycle
- Provider/clinic administration UI, referrals and patient communications.
- Eligibility checks, estimates, statements, payment reconciliation and claims workflow.
- Operational dashboards with privacy-safe aggregation and auditable exports.

### P3 — interoperability
- FHIR R4/US Core resources and conformance testing.
- SMART on FHIR/OAuth2 authorization and consent-aware access.
- HL7 v2, X12 and NCPDP adapters behind vendor-neutral interfaces.
- Matching, reconciliation, provenance, retries and dead-letter operations.

### P4 — infrastructure and operations
- AWS deployment design: WAF, ALB, ECS Fargate, RDS PostgreSQL, S3, KMS, Secrets Manager, CloudWatch and Terraform.
- Separate production and synthetic Test Lab accounts, networks, databases, keys, credentials and pipelines.
- Tested restore, disaster recovery, availability, performance and incident runbooks.

## Superseded material
- ADR-009 (Python-only) is the authoritative stack decision. Earlier ADRs retain product decisions where relevant but Node/TypeScript-specific implementation instructions are historical.
- Historical harness assessments and acceptance reports describe prior work and must not be used as evidence for the current Python build.
- Update older documents in place only when the historical record would otherwise mislead; prefer adding a superseding note to preserve decision history.
