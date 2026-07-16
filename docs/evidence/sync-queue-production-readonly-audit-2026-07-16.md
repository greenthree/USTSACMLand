# Synchronization queue production read-only audit — 2026-07-16

This audit queried only synchronization job/run metadata through the service role. It did not create, claim, retry, cancel, or delete a job, and it did not read or record member UUIDs or platform account identifiers.

## Codeforces dispatch concurrency

The first identifiable scheduled Codeforces batch after the persistent queue release contained five single-platform jobs. Their execution pattern was:

1. two jobs started together and completed;
2. two more jobs started together and completed;
3. the final job ran alone.

The maximum observed overlap was 2, matching the configured Codeforces dispatcher limit. No third Codeforces run overlapped either pair.

This is production evidence for the Codeforces branch of the dispatcher. It does not prove that independent concurrent invocations cannot exceed the per-invocation limit, and it does not prove the AtCoder, XCPC ELO, 牛客, 洛谷, or QOJ dispatcher branches.

## QOJ retry boundary

Every QOJ job created after the persistent queue release had:

- `attempt_count = 1`
- `max_attempts = 1`

No QOJ job contained a second run attempt. Explicit administrator retry actions created separate jobs, and each new job still had `max_attempts = 1`. This confirms the production queue representation does not silently convert a manual retry into automatic retry of the original QOJ job.

## Current queue and missing evidence

At audit time:

- no job was queued or running;
- no running job was older than 15 minutes;
- no run carried the stale-worker recovery message;
- no ordinary platform job had more than one queue attempt.

Therefore this audit does not claim production verification of stale-worker recovery, the 2-minute/4-minute retry delays, retry exhaustion, or the remaining platform concurrency limits. Those require either naturally occurring retryable failures or a separately authorized synthetic production exercise.
