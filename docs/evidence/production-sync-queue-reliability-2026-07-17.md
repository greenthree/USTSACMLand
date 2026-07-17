# Production synchronization queue reliability smoke — 2026-07-17

## Scope and data handling

This record verifies bounded retries, exponential backoff, stale-worker fencing, QOJ's
single-attempt rule, and per-platform dispatch limits against the production Supabase
project. It intentionally omits service keys, JWTs, member IDs, job/run IDs, emails,
platform account IDs, upstream messages, and raw function responses.

One final fixture used a random non-public Auth member with synthetic profile fields and
no platform bindings. The fixture was removed through the target-bound recovery lease and
transactional Auth deletion RPC. A final query found zero Profile, Job, or Run rows for the
fixture. Two earlier setup attempts stopped before queue work; the only created temporary
Auth/Profile row was also removed and a follow-up search found no fixture Profile or Job.

## Atomic completion boundary

PR [#50](https://github.com/greenthree/USTSACMLand/pull/50) introduced migration
`202607170003_atomic_sync_job_completion.sql` and changed `sync-member` so normal and
exceptional completion both use `complete_sync_job_attempt`.

The RPC locks the target job and transitions it only when `status = running` and
`attempt_count` still equals the worker's expected attempt. The same transaction either:

- marks the current attempt successful;
- requeues one retryable single-platform attempt with database-clock backoff;
- or marks the job terminally failed.

QOJ is rejected from automatic requeue even if a malformed job row has `max_attempts > 1`.
The RPC is executable by `service_role` only.

PR checks all passed in Actions run
[`29549248442`](https://github.com/greenthree/USTSACMLand/actions/runs/29549248442):

- PostgreSQL 17 created an empty database, applied all migrations, and passed 17 pgTAP
  files with 314 planned assertions;
- Vitest passed 259 tests;
- Deno Edge tests passed 262 tests;
- browser/accessibility, build, formatting, lint, Edge type-check, and Gitleaks gates passed.

After merge, the production migration list showed all 38 local/remote versions aligned.
The migration was deployed before the updated `sync-member`. The first function deployment
attempt omitted the documented import map and was rejected during remote bundling, before
activation; redeployment with `--use-api --import-map supabase/functions/deno.json` succeeded.

## Retry and stale-worker smoke

The controlled production fixture produced these assertions:

| Invariant                      | Observed result                                                  |
| ------------------------------ | ---------------------------------------------------------------- |
| first retryable failure        | exact 120-second retry delay                                     |
| second retryable failure       | exact 240-second retry delay                                     |
| third retryable failure        | terminal at attempt 3, no retry time                             |
| stale running attempt          | prior Run closed as `failed/timeout`, job reclaimed as attempt 2 |
| late completion from attempt 1 | `transitioned=false`; attempt 2 remained current                 |
| QOJ retryable failure          | terminal `failed`, no retry time                                 |
| fixture cleanup                | zero Profile/Job/Run residual rows                               |

The production queue was empty after the smoke.

## Platform dispatch limits

Each batch used existing verified, approved bindings. Database Run intervals were compared
to determine the maximum simultaneous work observed for that platform.

| Platform | Requested | Succeeded | Queued | Failed | Observed maximum | Configured limit |
| -------- | --------: | --------: | -----: | -----: | ---------------: | ---------------: |
| AtCoder  |         3 |         3 |      0 |      0 |                2 |                2 |
| XCPC ELO |         5 |         5 |      0 |      0 |                4 |                4 |
| Nowcoder |         2 |         2 |      0 |      0 |                1 |                1 |
| Luogu    |         2 |         2 |      0 |      0 |                1 |                1 |
| QOJ      |         2 |         0 |      0 |      2 |                1 |                1 |

The earlier Codeforces production scheduler smoke already observed a five-target batch as
`2/2/1`, with maximum concurrency 2. Together, the two records cover all six platform
limits.

Both QOJ runs ended as structured `source_unavailable` failures. They remained strictly
serial and every resulting job had `attempt_count=1`, `max_attempts=1`, and no queued retry.
This proves the scheduler and no-retry invariant, not QOJ source health; QOJ fault-path and
alert-delivery acceptance remain separate ROADMAP work.

## Result

The bounded retry, 2/4-minute backoff, retry exhaustion, stale-worker recovery/fencing, QOJ
single-attempt rule, and all six platform concurrency limits now have CI and production
evidence. No production fixture or active queue work remained after verification.
