-- GitHub scheduled workflows cannot reliably meet the queue's two-minute retry
-- window. Use pg_cron + pg_net as the single automatic five-minute trigger and
-- retain only a manual GitHub recovery scope. Only a scoped
-- scheduler token and the public anon JWT are stored in Vault; the service-role
-- key remains exclusively inside Edge Function Secrets.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists private.sync_queue_scheduler_state (
  singleton boolean primary key default true check (singleton),
  last_request_id bigint,
  last_dispatched_at timestamptz,
  previous_request_id bigint,
  previous_dispatched_at timestamptz
);

revoke all on table private.sync_queue_scheduler_state
from public, anon, authenticated, service_role;

create or replace function private.invoke_sync_queue_scheduler()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  endpoint text;
  anon_key text;
  scheduler_token text;
  request_id bigint;
begin
  select decrypted_secret into endpoint
  from vault.decrypted_secrets
  where name = 'sync_queue_endpoint'
  order by created_at desc
  limit 1;

  select decrypted_secret into anon_key
  from vault.decrypted_secrets
  where name = 'sync_queue_anon_key'
  order by created_at desc
  limit 1;

  select decrypted_secret into scheduler_token
  from vault.decrypted_secrets
  where name = 'sync_queue_scheduler_token'
  order by created_at desc
  limit 1;

  if endpoint is null or anon_key is null or scheduler_token is null then
    raise exception 'Synchronization queue scheduler Vault configuration is incomplete.'
      using errcode = '55000';
  end if;
  if endpoint !~ '^https://[a-z]{20}\.supabase\.co/functions/v1/sync-stats$' then
    raise exception 'Synchronization queue scheduler endpoint is invalid.'
      using errcode = '22023';
  end if;
  if pg_catalog.char_length(anon_key) < 32
    or anon_key ~ '[[:space:]]'
    or pg_catalog.char_length(scheduler_token) not between 32 and 256
    or scheduler_token ~ '[[:space:]]' then
    raise exception 'Synchronization queue scheduler credentials are invalid.'
      using errcode = '22023';
  end if;

  select net.http_post(
    url := endpoint,
    headers := pg_catalog.jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || anon_key,
      'apikey', anon_key,
      'x-sync-queue-token', scheduler_token
    ),
    body := '{"scope":"queue"}'::jsonb,
    timeout_milliseconds := 140000
  ) into request_id;

  if request_id is null then
    raise exception 'Synchronization queue scheduler request was not enqueued.'
      using errcode = '58000';
  end if;

  insert into private.sync_queue_scheduler_state as scheduler_state (
    singleton,
    last_request_id,
    last_dispatched_at
  ) values (
    true,
    request_id,
    pg_catalog.clock_timestamp()
  )
  on conflict (singleton) do update
  set
    previous_request_id = scheduler_state.last_request_id,
    previous_dispatched_at = scheduler_state.last_dispatched_at,
    last_request_id = excluded.last_request_id,
    last_dispatched_at = excluded.last_dispatched_at;
end;
$$;

revoke all on function private.invoke_sync_queue_scheduler()
from public, anon, authenticated, service_role;

create or replace function public.read_sync_queue_scheduler_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with scheduler_job as (
    select jobid, active
    from cron.job
    where jobname = 'sync-queue-every-five-minutes'
    limit 1
  ),
  recent_runs as (
    select
      pg_catalog.count(*)::integer as total,
      pg_catalog.count(*) filter (where details.status = 'succeeded')::integer as succeeded
    from cron.job_run_details as details
    join scheduler_job as job on job.jobid = details.jobid
    where details.start_time >= pg_catalog.clock_timestamp() - interval '15 minutes'
  ),
  configured as (
    select pg_catalog.count(distinct name) = 3 as ready
    from vault.secrets
    where name in (
      'sync_queue_endpoint',
      'sync_queue_anon_key',
      'sync_queue_scheduler_token'
    )
  )
  select pg_catalog.jsonb_build_object(
    'configured', configured.ready,
    'cronActive', coalesce(job.active, false),
    'lastDispatchedAt', state.last_dispatched_at,
    'lastResponseDispatchedAt', response.dispatched_at,
    'lastHttpStatus', response.status_code,
    'lastResponseAt', response.created,
    'lastTimedOut', coalesce(response.timed_out, false),
    'lastTransportError', response.error_msg is not null,
    'recentCronRuns', recent.total,
    'recentCronSuccesses', recent.succeeded
  )
  from configured
  cross join recent_runs as recent
  left join scheduler_job as job on true
  left join private.sync_queue_scheduler_state as state on state.singleton
  left join lateral (
    select
      candidate.dispatched_at,
      completed.status_code,
      completed.created,
      completed.timed_out,
      completed.error_msg
    from (
      values
        (state.last_request_id, state.last_dispatched_at, 1),
        (state.previous_request_id, state.previous_dispatched_at, 2)
    ) as candidate(request_id, dispatched_at, priority)
    join net._http_response as completed on completed.id = candidate.request_id
    order by candidate.priority
    limit 1
  ) as response on true;
$$;

revoke all on function public.read_sync_queue_scheduler_health()
from public, anon, authenticated;
grant execute on function public.read_sync_queue_scheduler_health()
to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'sync-queue-every-five-minutes';

select cron.schedule(
  'sync-queue-every-five-minutes',
  '*/5 * * * *',
  $command$select private.invoke_sync_queue_scheduler();$command$
);

comment on function private.invoke_sync_queue_scheduler() is
  'Enqueues one scoped sync-stats queue request using Vault credentials; callable only by the database scheduler owner.';
comment on function public.read_sync_queue_scheduler_health() is
  'Returns non-secret queue scheduler configuration, dispatch, HTTP, and recent cron health to service_role.';
