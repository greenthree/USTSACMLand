-- Define the current enabled WebChat cohort as the formal pilot roster and
-- expose a content-free rolling observation summary to administrators. The
-- observation clock restarts whenever any enabled cohort access row changes.

create function public.admin_read_webchat_pilot_observation()
returns table (
  checked_at timestamptz,
  cohort_started_at timestamptz,
  observation_hours integer,
  enabled_members integer,
  active_members integer,
  observed_requests bigint,
  successful_requests bigint,
  incomplete_requests bigint,
  failed_requests bigint,
  unknown_usage_requests bigint,
  active_generation_count integer,
  cache_eligible_requests bigint,
  cache_hit_requests bigint,
  last_request_at timestamptz,
  observation_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  with clock as (
    select pg_catalog.statement_timestamp() as checked_at
  ),
  cohort as (
    select access.user_id, access.updated_at
    from private.webchat_member_access as access
    join public.profiles as profile on profile.id = access.user_id
    where access.access_enabled
      and profile.review_status = 'approved'::public.profile_review_status
  ),
  cohort_summary as (
    select
      pg_catalog.count(*)::integer as enabled_members,
      pg_catalog.max(cohort.updated_at) as cohort_started_at
    from cohort
  ),
  observed as (
    select request.*
    from private.webchat_requests as request
    join cohort on cohort.user_id = request.user_id
    cross join cohort_summary
    where cohort_summary.cohort_started_at is not null
      and request.claimed_at >= cohort_summary.cohort_started_at
  ),
  request_summary as (
    select
      pg_catalog.count(distinct observed.user_id) filter (
        where observed.status = 'finished'
      )::integer as active_members,
      pg_catalog.count(*) filter (
        where observed.status = 'finished'
      )::bigint as observed_requests,
      pg_catalog.count(*) filter (
        where observed.status = 'finished' and observed.outcome = 'completed'
      )::bigint as successful_requests,
      pg_catalog.count(*) filter (
        where observed.status = 'finished' and observed.outcome like 'incomplete\_%' escape '\'
      )::bigint as incomplete_requests,
      pg_catalog.count(*) filter (
        where observed.status = 'finished'
          and observed.outcome is distinct from 'completed'
          and coalesce(observed.outcome, '') not like 'incomplete\_%' escape '\'
      )::bigint as failed_requests,
      pg_catalog.count(*) filter (
        where observed.status = 'finished' and observed.total_tokens is null
      )::bigint as unknown_usage_requests,
      pg_catalog.count(*) filter (
        where observed.status in ('claimed', 'started')
          and observed.lease_expires_at > clock.checked_at
      )::integer as active_generation_count,
      pg_catalog.count(*) filter (
        where observed.status = 'finished'
          and observed.cached_input_tokens is not null
          and observed.input_tokens >= 1024
      )::bigint as cache_eligible_requests,
      pg_catalog.count(*) filter (
        where observed.status = 'finished'
          and observed.cached_input_tokens > 0
          and observed.input_tokens >= 1024
      )::bigint as cache_hit_requests,
      pg_catalog.max(observed.claimed_at) as last_request_at
    from observed
    cross join clock
  ),
  summary as (
    select
      clock.checked_at,
      cohort_summary.cohort_started_at,
      greatest(
        pg_catalog.floor(
          pg_catalog.extract(epoch from (clock.checked_at - cohort_summary.cohort_started_at))
            / 3600
        ),
        0
      )::integer as observation_hours,
      cohort_summary.enabled_members,
      request_summary.active_members,
      request_summary.observed_requests,
      request_summary.successful_requests,
      request_summary.incomplete_requests,
      request_summary.failed_requests,
      request_summary.unknown_usage_requests,
      request_summary.active_generation_count,
      request_summary.cache_eligible_requests,
      request_summary.cache_hit_requests,
      request_summary.last_request_at
    from clock
    cross join cohort_summary
    cross join request_summary
  )
  select
    summary.checked_at,
    summary.cohort_started_at,
    summary.observation_hours,
    summary.enabled_members,
    summary.active_members,
    summary.observed_requests,
    summary.successful_requests,
    summary.incomplete_requests,
    summary.failed_requests,
    summary.unknown_usage_requests,
    summary.active_generation_count,
    summary.cache_eligible_requests,
    summary.cache_hit_requests,
    summary.last_request_at,
    case
      when summary.enabled_members < 3 or summary.enabled_members > 5
        then 'cohort_size_invalid'
      when summary.active_generation_count > 0
        then 'active_requests'
      when summary.failed_requests > 0 or summary.unknown_usage_requests > 0
        then 'needs_review'
      when summary.active_members < summary.enabled_members
        then 'awaiting_member_activity'
      when summary.observation_hours < 168
        then 'observing'
      else 'ready_for_review'
    end::text as observation_status
  from summary;
end;
$$;

revoke all on function public.admin_read_webchat_pilot_observation()
from public, anon, authenticated, service_role;

grant execute on function public.admin_read_webchat_pilot_observation() to authenticated;

comment on function public.admin_read_webchat_pilot_observation() is
  'Returns a content-free health summary for the current 3-5 account WebChat pilot cohort since its latest access change.';
