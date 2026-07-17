-- Finish one claimed queue attempt under a row lock. A worker may only
-- transition the exact attempt it claimed, so a recovered stale worker
-- cannot overwrite a newer attempt after it eventually returns.

create or replace function public.complete_sync_job_attempt(
  target_job_id bigint,
  expected_attempt smallint,
  attempt_succeeded boolean,
  failure_retryable boolean default false,
  failure_code public.sync_error_code default null,
  failure_message text default null
)
returns table (
  transitioned boolean,
  job_status public.sync_job_status,
  retry_at timestamptz,
  transitioned_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.sync_jobs%rowtype;
  transition_time timestamptz := pg_catalog.clock_timestamp();
  delay_seconds integer;
begin
  if target_job_id is null or expected_attempt is null or expected_attempt < 1 then
    raise exception 'Job ID and positive expected attempt are required.' using errcode = '22023';
  end if;
  if attempt_succeeded is null or failure_retryable is null then
    raise exception 'Attempt outcome flags are required.' using errcode = '22023';
  end if;
  if failure_message is not null and pg_catalog.char_length(failure_message) > 4000 then
    raise exception 'Failure message exceeds 4000 characters.' using errcode = '22001';
  end if;
  if attempt_succeeded and (
    failure_retryable or failure_code is not null or failure_message is not null
  ) then
    raise exception 'Successful attempts cannot include failure metadata.' using errcode = '22023';
  end if;

  select * into job
  from public.sync_jobs
  where id = target_job_id
  for update;

  if not found then
    raise exception 'Synchronization job was not found.' using errcode = 'P0002';
  end if;

  if job.status <> 'running' or job.attempt_count <> expected_attempt then
    return query select false, job.status, null::timestamptz, null::timestamptz;
    return;
  end if;

  if attempt_succeeded then
    update public.sync_jobs
    set
      status = 'succeeded',
      finished_at = transition_time,
      last_error_code = null,
      last_error_message = null
    where id = job.id;

    return query
    select true, 'succeeded'::public.sync_job_status, null::timestamptz, transition_time;
    return;
  end if;

  if failure_retryable
    and job.scope = 'account'
    and job.platform is not null
    and job.platform <> 'qoj'
    and job.attempt_count < job.max_attempts then
    delay_seconds := least(
      1800,
      120 * pg_catalog.power(2, greatest(0, job.attempt_count - 1))::integer
    );

    update public.sync_jobs
    set
      status = 'queued',
      scheduled_for = transition_time + pg_catalog.make_interval(secs => delay_seconds),
      started_at = null,
      finished_at = null,
      last_error_code = failure_code,
      last_error_message = failure_message
    where id = job.id;

    return query
    select
      true,
      'queued'::public.sync_job_status,
      transition_time + pg_catalog.make_interval(secs => delay_seconds),
      transition_time;
    return;
  end if;

  update public.sync_jobs
  set
    status = 'failed',
    finished_at = transition_time,
    last_error_code = failure_code,
    last_error_message = failure_message
  where id = job.id;

  return query
  select true, 'failed'::public.sync_job_status, null::timestamptz, transition_time;
end;
$$;

revoke all on function public.complete_sync_job_attempt(
  bigint,
  smallint,
  boolean,
  boolean,
  public.sync_error_code,
  text
) from public, anon, authenticated;
grant execute on function public.complete_sync_job_attempt(
  bigint,
  smallint,
  boolean,
  boolean,
  public.sync_error_code,
  text
) to service_role;

comment on function public.complete_sync_job_attempt(
  bigint,
  smallint,
  boolean,
  boolean,
  public.sync_error_code,
  text
) is
  'Atomically completes the exact claimed attempt, applying bounded exponential backoff without allowing stale workers to overwrite newer attempts.';
