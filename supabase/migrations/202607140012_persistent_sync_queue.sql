-- Turn sync_jobs into a recoverable work queue. Only the service role may
-- atomically claim due work; stale workers are recovered before each claim.

create index if not exists sync_jobs_due_queue_idx
  on public.sync_jobs (priority desc, scheduled_for, id)
  where status = 'queued';

create or replace function public.claim_due_sync_jobs(
  batch_limit integer default 12,
  stale_timeout interval default interval '15 minutes'
)
returns table (
  job_id bigint,
  profile_id uuid,
  platform public.platform_name,
  payload jsonb,
  attempt_count smallint,
  max_attempts smallint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if batch_limit < 1 or batch_limit > 50 then
    raise exception 'batch_limit must be between 1 and 50.' using errcode = '22023';
  end if;
  if stale_timeout < interval '5 minutes' or stale_timeout > interval '1 day' then
    raise exception 'stale_timeout must be between 5 minutes and 1 day.' using errcode = '22023';
  end if;

  update public.sync_runs as run
  set
    status = 'failed',
    finished_at = pg_catalog.clock_timestamp(),
    duration_ms = greatest(
      0,
      least(
        2147483647,
        floor(
          extract(epoch from (pg_catalog.clock_timestamp() - run.started_at)) * 1000
        )
      )::integer
    ),
    error_code = 'timeout',
    error_message = 'Queue worker stopped before completing this synchronization attempt.'
  from public.sync_jobs as job
  where run.job_id = job.id
    and run.status = 'running'
    and job.status = 'running'
    and job.started_at < pg_catalog.clock_timestamp() - stale_timeout;

  update public.sync_jobs as job
  set
    status = 'queued',
    scheduled_for = pg_catalog.clock_timestamp(),
    started_at = null,
    finished_at = null,
    last_error_code = 'timeout',
    last_error_message = 'Previous queue worker stopped before completing the job.'
  where job.status = 'running'
    and job.started_at < pg_catalog.clock_timestamp() - stale_timeout
    and job.attempt_count < job.max_attempts;

  update public.sync_jobs as job
  set
    status = 'failed',
    finished_at = pg_catalog.clock_timestamp(),
    last_error_code = coalesce(job.last_error_code, 'timeout'),
    last_error_message = coalesce(
      job.last_error_message,
      'Synchronization exhausted its maximum queue attempts.'
    )
  where (
      job.status = 'queued'
      or (
        job.status = 'running'
        and job.started_at < pg_catalog.clock_timestamp() - stale_timeout
      )
    )
    and job.attempt_count >= job.max_attempts;

  return query
  with candidates as (
    select queued.id
    from public.sync_jobs as queued
    where queued.status = 'queued'
      and queued.scheduled_for <= pg_catalog.clock_timestamp()
      and queued.attempt_count < queued.max_attempts
      and queued.profile_id is not null
      and queued.platform is not null
    order by queued.priority desc, queued.scheduled_for, queued.id
    for update skip locked
    limit batch_limit
  )
  update public.sync_jobs as claimed
  set
    status = 'running',
    attempt_count = claimed.attempt_count + 1,
    started_at = pg_catalog.clock_timestamp(),
    finished_at = null
  from candidates
  where claimed.id = candidates.id
  returning
    claimed.id,
    claimed.profile_id,
    claimed.platform,
    claimed.payload,
    claimed.attempt_count,
    claimed.max_attempts;
end;
$$;

revoke all on function public.claim_due_sync_jobs(integer, interval)
  from public, anon, authenticated;
grant execute on function public.claim_due_sync_jobs(integer, interval) to service_role;

comment on function public.claim_due_sync_jobs(integer, interval) is
  'Recovers stale synchronization jobs and atomically claims due jobs with SKIP LOCKED.';
