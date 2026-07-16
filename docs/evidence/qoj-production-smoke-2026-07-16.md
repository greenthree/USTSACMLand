# QOJ production smoke evidence — 2026-07-16

This record contains no member UUID, name, platform account, credential, request body, Firecrawl job ID, or raw third-party response.

## Read-only observation

- Observed at: `2026-07-16T03:28:37Z`
- Supabase project: `qzggoqdmsvktrtnjislw`
- Source: anonymous read of `public_platform_stats`
- Filter: `platform = qoj`
- Automated source version: `qoj-firecrawl-interact-v1`
- Automated rows observed: `2`
- Statuses: both `fresh`
- Successful snapshots:
  - `last_success_at = 2026-07-14T22:49:29.259+08:00`, `solved_count = 31`
  - `last_success_at = 2026-07-14T12:38:15.508+08:00`, `solved_count = 10`

Three additional QOJ rows used `admin-manual/v1`; they are intentionally excluded from automated-login evidence.

## Controlled production smoke

- Completed at: `2026-07-16T17:18:52.841+08:00`
- Invocation path: deployed `sync-member` Edge Function using its production QOJ and Firecrawl secrets
- Result: `succeeded`
- Attempts: `1` of `1`; `retryAt = null`
- Adapter result: `ok = true`
- Source version: `qoj-firecrawl-interact-v1`
- Unique Accepted count: `10`
- Anonymous post-commit verification: the newest public QOJ statistic reported the same count, source version, success timestamp, and `fresh` status

The member identity, platform account, request body, private synchronization run ID, Firecrawl job ID, credentials, and raw third-party response are intentionally omitted.

## What this proves

The production database contains successful QOJ snapshots written by the Firecrawl interact adapter. The controlled invocation additionally proves that the currently deployed service-account credentials and Firecrawl allowance can create a new authenticated session, calculate the unique Accepted count, commit the result, and expose it as fresh public data. The one-attempt execution proves that QOJ automatic retries remain disabled.

## What this does not prove

This evidence does not deliberately submit an invalid password, trigger a Cloudflare challenge or Firecrawl `429`, or deliver an alert to a production Webhook. Those failure-path and alert-delivery exercises remain required before formal release.
