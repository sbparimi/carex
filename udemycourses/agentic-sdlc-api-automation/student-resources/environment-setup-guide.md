# Environment setup guide — learner edition

**Status:** Draft; tool versions and clean-machine walkthrough must be verified before release.

## Required tools

- Python 3.11 or the course-pinned compatible version
- Git
- Postman desktop application
- Postman CLI for the execution lessons
- A GitHub account for the CI lessons
- A supported browser and terminal

## Before starting

1. Download the CareX learner starter package from the course resources.
2. Read the package README and confirm the required Python version.
3. Create a dedicated local working folder.
4. Create a Python virtual environment and install only the pinned requirements supplied with the starter package.
5. Start the local CareX service using the learner instructions.
6. Import the supplied Postman collection and local environment.
7. Confirm the health endpoint and a read-only discovery request before enabling any write operation.

## Database safety

The upstream CareX project uses Neon/PostgreSQL. Learner setup must use a dedicated development or disposable test database branch. Never run demo seeding or destructive tests against production. A learner package must not contain a real database connection string. Provide a documented local/demo option only if it has been built and verified; do not imply SQLite support.

## Postman environment safety

- Keep secrets in Postman Vault or environment-local secret fields where supported.
- Do not export secret values into course files.
- Keep write operations disabled until the learner has verified the target environment.
- Use synthetic accounts and synthetic data only.

## Setup verification checklist

- [ ] Python version matches the course package requirement.
- [ ] Dependencies install from the supplied lock/pinned requirements.
- [ ] CareX starts successfully.
- [ ] API documentation endpoint loads.
- [ ] Postman collection imports without errors.
- [ ] Environment base URL points to the learner's non-production instance.
- [ ] Read-only request succeeds.
- [ ] No secret is present in exported files, screenshots or logs.

Do not mark setup complete until a clean-machine test has passed.
