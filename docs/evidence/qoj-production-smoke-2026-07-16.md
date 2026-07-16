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

## What this proves

The production database contains at least two successful QOJ snapshots written by the Firecrawl interact adapter, with non-null solved counts and success timestamps. This is stronger than relying only on an undocumented historical smoke-test statement.

## What this does not prove

This read does not trigger QOJ, test the current service-account password, verify current Firecrawl quota, or expose private `sync_runs` identifiers. A fresh controlled smoke test and alert-delivery check remain required before formal release.
