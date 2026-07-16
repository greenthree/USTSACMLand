# Account-deletion fencing production smoke — 2026-07-16

This record contains no member UUID, email, password, lease token, API key, or repository credential.

## Release evidence

- Pull request `#29` merged as production source commit `1ca851d`.
- Required PR checks passed:
  - `verify`
  - `database-security`
  - `gitleaks`
- PostgreSQL 17 empty-database CI applied all migrations and ran 16 pgTAP files with 289 planned assertions.
- Linked migration dry-run contained only `202607160010_transactional_auth_user_deletion.sql`.
- Production migration list then reported 35 local/remote matches and zero pending migrations.
- Production `delete-account` version 3 is `ACTIVE` with JWT verification and the repository import map enabled.

## Non-destructive RPC smoke

The smoke used fresh random UUIDs that did not identify an Auth user. It did not create or delete a member account.

1. The service role acquired a target-bound recovery lease: HTTP 200 and `true`.
2. The final deletion RPC found no live Profile and returned HTTP 200 with `leaseOwned: true` and `deleted: false`.
3. The service role released the lease: HTTP 200 and `true`.
4. Repeating the final RPC after release returned HTTP 200 with `leaseOwned: false`.
5. The anonymous role was denied access to the final RPC with HTTP 401.
6. A database blocking-query inspection reported no blocked or blocking statements after the smoke.

This proves the deployed target binding, missing-Profile refusal, lease release/consumption boundary, and browser-role denial without risking production member data. PostgreSQL 17 pgTAP separately proves that an unfenced direct Auth deletion is rejected and that a valid fenced transaction atomically deletes Auth/Profile state.

## Remaining blocker

Strict production readiness reported:

- project health: `ACTIVE_HEALTHY`
- migrations: 35 observed, zero pending
- Edge Functions: 4 observed
- schema lint findings: zero
- Auth email, anonymous REST, and Edge boundary checks: ready
- PITR: disabled
- provider physical backups: zero

The following Function Secrets remain absent:

- `DELETION_RECOVERY_GITHUB_TOKEN`
- `SYNC_ALERT_WEBHOOK_URL`
- `SYNC_ALERT_WEBHOOK_TOKEN`

`DELETION_RECOVERY_REPOSITORY` is configured. Until the missing recovery token is supplied, production self-service deletion must continue to fail closed before the final RPC. No successful account-deletion, recovery-floor write/confirmation, Storage-blocked `409`, two-connection lock handoff, response-loss reconciliation, or old-JWT RLS smoke is claimed by this record.
