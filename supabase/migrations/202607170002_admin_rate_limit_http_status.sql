-- Administrative quota exhaustion is an expected HTTP condition, not an
-- internal PostgreSQL error. Return PT429 so PostgREST responds immediately
-- with the standard Too Many Requests status while preserving the structured
-- retry delay consumed by the frontend and Edge Functions.

create or replace function public.consume_admin_rate_limit(
  rate_actor_id uuid,
  rate_action_key text,
  rate_max_requests integer,
  rate_window_seconds integer
)
returns table (
  remaining_requests integer,
  resets_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  next_count integer;
  active_window_started_at timestamptz;
  retry_after_seconds integer;
begin
  if rate_actor_id is null then
    raise exception 'Administrator identity is required.' using errcode = '42501';
  end if;
  if rate_action_key is null or rate_action_key !~ '^[a-z0-9_.:-]{1,80}$' then
    raise exception 'A valid rate-limit action key is required.' using errcode = '22023';
  end if;
  if rate_max_requests is null or rate_max_requests < 1 or rate_max_requests > 10000 then
    raise exception 'Rate-limit maximum must be between 1 and 10000.' using errcode = '22023';
  end if;
  if rate_window_seconds is null or rate_window_seconds < 1 or rate_window_seconds > 86400 then
    raise exception 'Rate-limit window must be between 1 and 86400 seconds.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = rate_actor_id
      and profile.role = 'admin'
      and profile.review_status = 'approved'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  insert into public.admin_rate_limit_buckets as bucket (
    actor_id,
    action_key,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    rate_actor_id,
    rate_action_key,
    checked_at,
    1,
    checked_at
  )
  on conflict (actor_id, action_key) do update
  set
    window_started_at = case
      when bucket.window_started_at
        <= checked_at - pg_catalog.make_interval(secs => rate_window_seconds)
      then checked_at
      else bucket.window_started_at
    end,
    request_count = case
      when bucket.window_started_at
        <= checked_at - pg_catalog.make_interval(secs => rate_window_seconds)
      then 1
      else bucket.request_count + 1
    end,
    updated_at = checked_at
  returning request_count, window_started_at
  into next_count, active_window_started_at;

  resets_at := active_window_started_at
    + pg_catalog.make_interval(secs => rate_window_seconds);
  remaining_requests := greatest(rate_max_requests - next_count, 0);

  if next_count > rate_max_requests then
    retry_after_seconds := greatest(
      1,
      pg_catalog.ceil(pg_catalog.date_part('epoch', resets_at - checked_at))::integer
    );
    raise exception 'admin_rate_limited'
      using
        errcode = 'PT429',
        detail = pg_catalog.jsonb_build_object(
          'action', rate_action_key,
          'retry_after_seconds', retry_after_seconds
        )::text,
        hint = 'Wait for the current administrative rate-limit window to reset.';
  end if;

  return next;
end;
$$;

revoke all on function public.consume_admin_rate_limit(uuid, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_admin_rate_limit(uuid, text, integer, integer)
to service_role;

comment on function public.consume_admin_rate_limit(uuid, text, integer, integer) is
  'Atomically consumes one administrator rate-limit slot and returns quota exhaustion as HTTP 429; callable directly only by the service role.';
