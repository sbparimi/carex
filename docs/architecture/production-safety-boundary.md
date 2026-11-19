# CareX production architecture and safety boundary

**Status:** target architecture; not evidence of deployed controls.  
**Current stack:** Python/FastAPI, Jinja HTML, SQLite/PostgreSQL. Preserve the modular monolith until operational evidence justifies service extraction.

## Environment isolation
Production and synthetic Test Lab are separate security domains, not merely separate tenants. They require separate cloud accounts/projects, networks, databases, credentials, encryption keys, storage, observability destinations, CI identities and operators. Production PHI must never be copied into Test Lab. Seed, reset, fixture and chaos capabilities exist only in Test Lab and are absent from production builds/routes.

## Target AWS topology
- Edge: Route 53, CloudFront where appropriate, AWS WAF and TLS.
- Application: ALB to ECS Fargate tasks running the FastAPI modular monolith in private subnets.
- Data: RDS PostgreSQL with private networking, encryption, automated backups and tested point-in-time restore.
- Files: private S3 buckets, object encryption, versioning/lifecycle and scoped access.
- Secrets and keys: Secrets Manager and KMS with rotation and least-privilege IAM.
- Operations: CloudWatch logs/metrics/alarms, distributed tracing, security findings and incident runbooks.
- Delivery: GitHub Actions with OIDC federation, Terraform plan review, immutable images, signed provenance and gated promotion.

No migration or deployment is implied by this target design. Current Vercel + Neon hosting remains the deployed configuration until an approved migration is executed and verified.

## Data isolation
- Every tenant-owned record carries tenant identity.
- Prefer composite tenant-aware foreign keys and uniqueness constraints for tenant-owned relationships.
- PostgreSQL Row Level Security is defence in depth; the application must still validate tenant context and scope every query.
- Add negative tests proving cross-tenant reads, writes, exports, updates, deletes and support access are denied.
- Privileged support access must be time-bound, justified, approved, logged and reviewable.

## Audit and privacy
- Required security audit writes must not fail silently.
- Audit details use an allowlist; do not store passwords, secrets, raw request bodies or free-text clinical content.
- Audit history needs restricted write/delete permissions, retention policy, monitoring and tamper-evidence appropriate to the threat model.
- Account closure is a stateful workflow with reconciliation, cancellation checks, retention/legal holds and retry handling; it is not a single blind anonymisation operation.
- Retention and deletion schedules require legal/privacy approval per jurisdiction and record type.

## Clinical data safety
The current application is not a complete EHR. Do not add diagnosis, prescribing, triage or treatment recommendations as casual UI features. Each clinical workflow requires a defined clinical owner, intended use, hazard analysis, validation evidence, access policy and jurisdictional regulatory review.

## Interoperability
Implement standards through bounded adapters:
- FHIR R4 and applicable US Core profiles, with validation and provenance.
- SMART on FHIR/OAuth2 for delegated access.
- HL7 v2, X12 and NCPDP only where product workflows and partner contracts require them.
- Explicit identity matching, consent checks, idempotency, retries, dead-letter queues and reconciliation.

A minimal Appointment export is not a FHIR server or conformance claim.

## Compliance boundary
HIPAA applicability, covered-entity/business-associate roles, BAAs, risk analysis, policies, workforce training, incident response, retention and independent assessment require accountable legal/security review. Do not claim HIPAA compliance or certification based on application code alone.
