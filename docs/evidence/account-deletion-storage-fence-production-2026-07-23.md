# Account deletion Storage fence production smoke - 2026-07-23

## Scope

This controlled production smoke verified the deployed generic Storage ownership fence without
using a real member account. The script generated a random temporary password and session in
memory and did not print or persist credentials, JWTs, API keys, object identifiers, or recovery
tokens.

The deployed changes were:

- `202607230005_sync_job_platform_isolation.sql`
- `202607230006_sync_worker_service_role_permissions.sql`
- `202607230007_account_deletion_storage_fence.sql`
- `sync-member` Edge Function v47 with JWT verification and the repository import map

`202607230001_webchat_image_attachments.sql` and
`202607230004_webchat_image_global_limits.sql` remained pending.

## Result

1. A random temporary member and private temporary Bucket were created.
2. One `storage.objects` catalog row was assigned to the temporary Auth UUID through
   `owner_id`.
3. The first self-service deletion returned HTTP `409`.
4. Read-only reconciliation confirmed Auth, Profile, and the owned Storage row all remained.
5. Storage cleanup through the Storage API returned HTTP `200`.
6. The second self-service deletion returned HTTP `200`.
7. Final reconciliation confirmed zero Auth user, Profile, recovery lease, Storage row, and
   temporary Bucket.

The Edge operation releases its recovery lease when a blocked request finishes, so the first
`409` left no lease residue. The second request acquired a fresh lease before committing the Auth
deletion. This differs from the lower-level rollback-only database test, where the direct RPC
keeps the same lease available inside the test transaction.

## Remaining work

This smoke proves the production Storage `409` boundary and cleanup retry path. It does not prove
the response-loss reconciliation path, a fresh old-JWT boundary after deletion, or every future
service-role upload convention. Those items remain open in `ROADMAP.md`.
