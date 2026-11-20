# Postman authentication and first-run verification

Use these collections only with synthetic data in an isolated development database. They create and change appointments, preferences and test accounts. Do not point the write-enabled Dev environment at production.

## Connect to the right API

1. Import both collection JSON files and `environments/CareX-Dev.postman_environment.json`.
2. Select the Dev environment. Its default API is `http://127.0.0.1:8127`, tenant `northwind-health`.
3. If Postman runs outside Codespaces, replace `baseUrl` with the private forwarded HTTPS address shown in the Codespace's Ports panel. Your computer's localhost is not the Codespace.
4. The environment names a matching synthetic selection: clinic `cl-sb`, visit type `sv-physio-n`, provider `pr-b`, employer `em-n-1`. Employer discovery searches `Acme`. Change these together when using a different synthetic catalog.
5. Keep `allowWrites=true` only after checking the destination is disposable.

## Run the workflow

The ordinary path uses the seeded synthetic patient and staff credentials already documented by CareX. Leave `runSignup` and `runAccountRecovery` unset or false for that path.

To execute signup too, use a new synthetic `patientEmail`, set a suitable `patientPassword`, and set `runSignup=true`. Signup is not a substitute for login. It cannot recreate an existing seeded account.

Run each collection from the beginning. Discovery obtains valid IDs and at least two future slots. Patient login saves its bearer token, then patient preflight checks it. Staff login and staff preflight do the same with a separate token. Negative requests intentionally expect 401 for missing, invalid, cross-tenant, wrong-role and revoked patient tokens.

The training collection's MFA verification runs when patient login returns a challenge. Supply the delivered test `mfaCode` before sending verification. In a manual run, pause after login to enter it. No code or bearer token is committed. A successful verification saves the newly issued patient token to both the environment and collection.

All generated IDs are saved to the environment and collection. Empty imported environment values no longer hide collection values. Logout happens after every protected operation. The staff lifecycle uses its own new booking instead of trying to change the cancelled patient appointment. A separate upcoming booking is used for the staff cancellation exercise.

For the optional password-reset exercise, use a disposable identity and set `runAccountRecovery=true`, `newPassword`, and the reset link's `resetToken`. In a manual run, pause after requesting the reset to enter its token. Reset runs after logout because it revokes sessions. It changes that synthetic account's password, so update your local environment before the next login.

Never export current bearer tokens, MFA codes, reset tokens, passwords for real accounts or database credentials. Clear current authentication values after a run.

## Evidence and limits

The source authentication model is unchanged: patient and staff use separate opaque session tokens, stored hashed and scoped to a tenant. A 401 on a request without a usable bearer token is expected protection. Successful login, profile and appointment calls establish that the backend works in the verified environment; they do not prove the exact client state behind an earlier 401.

Regression tests cover collection ordering/token scripts and an actual MFA-issued bearer token fetching appointments and being rejected after logout. Live negative checks also verify token expiry. No authentication bypass is used.
