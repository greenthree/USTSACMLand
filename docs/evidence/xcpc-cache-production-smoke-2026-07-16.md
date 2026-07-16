# XCPC ELO shared-cache production smoke evidence — 2026-07-16

This record contains no member UUID, name, platform account, request body, or raw XCPC ELO player identity.

## Environment

- Supabase project: `qzggoqdmsvktrtnjislw`
- Edge Function: `sync-member` version `32`, status `ACTIVE`
- Observation window: `2026-07-16T09:02Z`
- Source adapter version: `xcpc-elo-data-js-v2-cache-1`

## Controlled smoke test

1. Before the test, the singleton cache row had `active_version = 0` and no source or validation timestamps.
2. A production XCPC ELO synchronization for one verified member succeeded and atomically published cache version `1`.
3. The published version contained `53` players from the target organization and retained the database's two-decimal Rating representation.
4. A second production synchronization for a different verified member succeeded with the same source version, `xcpc-elo-data-js-v2-cache-1`.
5. After the second request, `active_version` remained `1` and `validated_at` was unchanged. The second request therefore used the fresh shared cache instead of refreshing the upstream dataset again.

## Automated coverage used with this smoke test

The required `main` checks for commit `5c46c62` passed on 2026-07-16:

- `246` Deno Edge Function tests, including fresh-cache hits, lease waiting, conditional `304` validation, cooldown after failure, size/schema guards, stale-data rejection, and inactive-version cleanup.
- `15` pgTAP files with `257` assertions, including service-role-only cache access, lease ownership, atomic version publication, decimal Rating storage, cooldown, and old-version deletion.
- GitHub Pages build/deploy and the production ranking audit.

## Conclusion

The production database and Edge Function demonstrate an empty-cache refresh followed by a cache hit across independent synchronization requests. Together with the required fault and concurrency tests, this verifies the XCPC ELO shared-cache, expiry, lease, conditional-request, and failure-cooldown strategy without exposing private member data.
