-- Separate paid WebChat access from the formal 3-5 member observation roster.
-- Roster changes and policy changes for an enrolled member reset a dedicated
-- observation clock, including removals and profile suspension/restoration.

alter table private.webchat_member_access
  add column pilot_observation_enabled boolean not null default false;

alter table private.webchat_member_access
  add constraint webchat_member_access_pilot_requires_access
  check (not pilot_observation_enabled or access_enabled);

create index webchat_member_access_pilot_roster_idx
  on private.webchat_member_access (user_id)
  where pilot_observation_enabled and access_enabled;

create table private.webchat_pilot_observation_state (
  singleton boolean primary key default true,
  roster_version bigint not null default 1,
  roster_changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint webchat_pilot_observation_state_singleton check (singleton),
  constraint webchat_pilot_observation_state_version_positive check (roster_version >= 1)
);

insert into private.webchat_pilot_observation_state (singleton)
values (true);

alter table private.webchat_pilot_observation_state enable row level security;
revoke all on table private.webchat_pilot_observation_state
from public, anon, authenticated, service_role;

create function private.touch_webchat_pilot_observation_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_enrolled boolean := false;
  current_enrolled boolean := false;
begin
  if tg_op <> 'INSERT' then
    previous_enrolled := old.pilot_observation_enabled;
  end if;
  if tg_op <> 'DELETE' then
    current_enrolled := new.pilot_observation_enabled;
  end if;

  if previous_enrolled or current_enrolled then
    if tg_op = 'UPDATE'
      and old.access_enabled is not distinct from new.access_enabled
      and old.pilot_observation_enabled is not distinct from new.pilot_observation_enabled
      and old.total_request_limit is not distinct from new.total_request_limit
      and old.total_token_limit is not distinct from new.total_token_limit then
      return new;
    end if;

    update private.webchat_pilot_observation_state as state
    set
      roster_version = state.roster_version + 1,
      roster_changed_at = pg_catalog.clock_timestamp()
    where state.singleton;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger webchat_member_access_touch_pilot_observation
after insert or update or delete on private.webchat_member_access
for each row execute function private.touch_webchat_pilot_observation_state();

create function private.touch_webchat_pilot_observation_for_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.review_status is distinct from new.review_status
    and exists (
      select 1
      from private.webchat_member_access as access
      where access.user_id = new.id
        and access.pilot_observation_enabled
    ) then
    update private.webchat_pilot_observation_state as state
    set
      roster_version = state.roster_version + 1,
      roster_changed_at = pg_catalog.clock_timestamp()
    where state.singleton;
  end if;
  return new;
end;
$$;

create trigger profiles_touch_webchat_pilot_observation
after update of review_status on public.profiles
for each row execute function private.touch_webchat_pilot_observation_for_profile();

revoke all on function private.touch_webchat_pilot_observation_state()
from public, anon, authenticated, service_role;
revoke all on function private.touch_webchat_pilot_observation_for_profile()
from public, anon, authenticated, service_role;

create function public.admin_get_webchat_member_policy(target_profile_id uuid)
returns table (
  access_enabled boolean,
  pilot_observation_enabled boolean,
  total_request_limit integer,
  total_token_limit bigint,
  version bigint,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if target_profile_id is null then
    raise exception 'Target profile is required.' using errcode = '22004';
  end if;
  if not exists (
    select 1 from public.profiles as profile
    where profile.id = target_profile_id
      and profile.role in ('member', 'admin')
      and profile.review_status in ('approved', 'suspended')
  ) then
    raise exception 'Eligible profile not found.' using errcode = 'P0002';
  end if;

  return query
  select
    coalesce(access.access_enabled, false),
    coalesce(access.pilot_observation_enabled, false),
    coalesce(access.total_request_limit, 30),
    coalesce(access.total_token_limit, 100000::bigint),
    coalesce(access.version, 0::bigint),
    access.updated_at
  from (select true) as singleton
  left join private.webchat_member_access as access on access.user_id = target_profile_id;
end;
$$;

create function public.admin_update_webchat_member_policy(
  target_profile_id uuid,
  requested_access_enabled boolean,
  requested_pilot_observation_enabled boolean,
  requested_total_request_limit integer,
  requested_total_token_limit bigint,
  expected_version bigint,
  reason text
)
returns table (
  access_enabled boolean,
  pilot_observation_enabled boolean,
  total_request_limit integer,
  total_token_limit bigint,
  version bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text := nullif(pg_catalog.btrim(reason), '');
  current_access private.webchat_member_access%rowtype;
  checked_at timestamptz := pg_catalog.clock_timestamp();
  changed_fields text[] := array[]::text[];
  previous_enabled boolean := false;
  previous_pilot_enabled boolean := false;
  previous_request_limit integer := 30;
  previous_token_limit bigint := 100000;
  previous_version bigint := 0;
  other_pilot_members integer := 0;
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  perform public.consume_admin_rate_limit(actor_id, 'webchat_member_access.write', 30, 60);

  if target_profile_id is null then
    raise exception 'Target profile is required.' using errcode = '22004';
  end if;
  if requested_access_enabled is null then
    raise exception 'Member WebChat access state is required.' using errcode = '22004';
  end if;
  if requested_pilot_observation_enabled is null then
    raise exception 'Member pilot observation state is required.' using errcode = '22004';
  end if;
  if requested_pilot_observation_enabled and not requested_access_enabled then
    raise exception 'Formal pilot members must retain WebChat access.' using errcode = '22023';
  end if;
  if requested_total_request_limit is null
    or requested_total_request_limit not between 1 and 10000 then
    raise exception 'Member total request limit must be between 1 and 10000.'
      using errcode = '22023';
  end if;
  if requested_total_token_limit is null
    or requested_total_token_limit not between 100 and 1000000000 then
    raise exception 'Member total token limit must be between 100 and 1000000000.'
      using errcode = '22023';
  end if;
  if expected_version is null or expected_version < 0 then
    raise exception 'Expected member access version is required.' using errcode = '22004';
  end if;
  if normalized_reason is null or pg_catalog.char_length(normalized_reason) < 3 then
    raise exception 'Member access change reason must contain at least 3 characters.'
      using errcode = '22023';
  end if;
  if pg_catalog.char_length(normalized_reason) > 500 then
    raise exception 'Member access change reason exceeds 500 characters.'
      using errcode = '22001';
  end if;

  perform 1 from public.profiles as administrator
  where administrator.role = 'admin'
  order by administrator.id for share;
  if actor_id is distinct from (select auth.uid()) or not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  perform 1 from public.profiles as profile
  where profile.id = target_profile_id
    and profile.role in ('member', 'admin')
    and profile.review_status in ('approved', 'suspended')
  for key share;
  if not found then
    raise exception 'Eligible profile not found.' using errcode = 'P0002';
  end if;
  if (requested_access_enabled or requested_pilot_observation_enabled) and not exists (
    select 1 from public.profiles as profile
    where profile.id = target_profile_id
      and profile.role in ('member', 'admin')
      and profile.review_status = 'approved'
  ) then
    raise exception 'Only an active member or administrator can receive WebChat access.'
      using errcode = '42501';
  end if;

  select access.* into current_access
  from private.webchat_member_access as access
  where access.user_id = target_profile_id for update;

  if found then
    previous_enabled := current_access.access_enabled;
    previous_pilot_enabled := current_access.pilot_observation_enabled;
    previous_request_limit := current_access.total_request_limit;
    previous_token_limit := current_access.total_token_limit;
    previous_version := current_access.version;
    if current_access.version is distinct from expected_version then
      raise exception 'Member WebChat access changed after it was loaded.'
        using errcode = '40001';
    end if;
  elsif expected_version <> 0 then
    raise exception 'Member WebChat access changed after it was loaded.'
      using errcode = '40001';
  end if;

  if previous_pilot_enabled or requested_pilot_observation_enabled then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('webchat_pilot_observation_roster', 0)
    );
  end if;

  if requested_pilot_observation_enabled then
    select pg_catalog.count(*)::integer into other_pilot_members
    from private.webchat_member_access as access
    where access.user_id <> target_profile_id
      and access.access_enabled
      and access.pilot_observation_enabled;
    if other_pilot_members >= 5 then
      raise exception 'Formal WebChat pilot roster cannot exceed 5 members.'
        using errcode = '22023';
    end if;
  end if;

  if previous_enabled is distinct from requested_access_enabled then
    changed_fields := pg_catalog.array_append(changed_fields, 'accessEnabled');
  end if;
  if previous_pilot_enabled is distinct from requested_pilot_observation_enabled then
    changed_fields := pg_catalog.array_append(changed_fields, 'pilotObservationEnabled');
  end if;
  if previous_request_limit is distinct from requested_total_request_limit then
    changed_fields := pg_catalog.array_append(changed_fields, 'totalRequestLimit');
  end if;
  if previous_token_limit is distinct from requested_total_token_limit then
    changed_fields := pg_catalog.array_append(changed_fields, 'totalTokenLimit');
  end if;
  if pg_catalog.cardinality(changed_fields) = 0 then
    raise exception 'At least one member WebChat access field must change.'
      using errcode = '22023';
  end if;

  if previous_version = 0 then
    insert into private.webchat_member_access as access (
      user_id, access_enabled, pilot_observation_enabled,
      total_request_limit, total_token_limit, version, updated_at, updated_by
    ) values (
      target_profile_id, requested_access_enabled, requested_pilot_observation_enabled,
      requested_total_request_limit, requested_total_token_limit, 1, checked_at, actor_id
    )
    on conflict (user_id) do nothing
    returning access.* into current_access;
    if not found then
      raise exception 'Member WebChat access changed after it was loaded.'
        using errcode = '40001';
    end if;
  else
    update private.webchat_member_access as access
    set
      access_enabled = requested_access_enabled,
      pilot_observation_enabled = requested_pilot_observation_enabled,
      total_request_limit = requested_total_request_limit,
      total_token_limit = requested_total_token_limit,
      version = access.version + 1,
      updated_at = checked_at,
      updated_by = actor_id
    where access.user_id = target_profile_id and access.version = expected_version
    returning access.* into current_access;
    if not found then
      raise exception 'Member WebChat access changed after it was loaded.'
        using errcode = '40001';
    end if;
  end if;

  insert into public.audit_logs (
    actor_id, action, target_table, target_id, before_data, after_data, metadata
  ) values (
    actor_id,
    'webchat_member_access_update',
    'webchat_member_access',
    target_profile_id::text,
    pg_catalog.jsonb_build_object(
      'accessEnabled', previous_enabled,
      'pilotObservationEnabled', previous_pilot_enabled,
      'totalRequestLimit', previous_request_limit,
      'totalTokenLimit', previous_token_limit,
      'version', previous_version
    ),
    pg_catalog.jsonb_build_object(
      'accessEnabled', current_access.access_enabled,
      'pilotObservationEnabled', current_access.pilot_observation_enabled,
      'totalRequestLimit', current_access.total_request_limit,
      'totalTokenLimit', current_access.total_token_limit,
      'version', current_access.version
    ),
    pg_catalog.jsonb_build_object(
      'profile_id', target_profile_id,
      'reason', normalized_reason,
      'changedFields', pg_catalog.to_jsonb(changed_fields)
    )
  );

  return query select
    current_access.access_enabled,
    current_access.pilot_observation_enabled,
    current_access.total_request_limit,
    current_access.total_token_limit,
    current_access.version,
    current_access.updated_at;
end;
$$;

create or replace function public.admin_update_webchat_member_access(
  target_profile_id uuid,
  requested_access_enabled boolean,
  requested_total_request_limit integer,
  requested_total_token_limit bigint,
  expected_version bigint,
  reason text
)
returns table (
  access_enabled boolean,
  total_request_limit integer,
  total_token_limit bigint,
  version bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  retained_pilot_observation boolean := false;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select coalesce(access.pilot_observation_enabled, false)
  into retained_pilot_observation
  from (select true) as singleton
  left join private.webchat_member_access as access on access.user_id = target_profile_id;

  return query
  select
    policy.access_enabled,
    policy.total_request_limit,
    policy.total_token_limit,
    policy.version,
    policy.updated_at
  from public.admin_update_webchat_member_policy(
    target_profile_id,
    requested_access_enabled,
    case when requested_access_enabled then retained_pilot_observation else false end,
    requested_total_request_limit,
    requested_total_token_limit,
    expected_version,
    reason
  ) as policy;
end;
$$;

drop function public.admin_list_webchat_pilot_members();

create function public.admin_list_webchat_pilot_members()
returns table (
  user_id uuid,
  full_name text,
  grade text,
  major text,
  role public.app_role,
  review_status public.profile_review_status,
  access_enabled boolean,
  pilot_observation_enabled boolean,
  total_request_limit integer,
  total_token_limit bigint,
  used_requests integer,
  used_tokens bigint,
  reserved_tokens bigint,
  remaining_requests integer,
  remaining_tokens bigint,
  today_usage_date date,
  today_request_count integer,
  today_settled_tokens bigint,
  today_reserved_tokens bigint,
  active_request_count integer,
  last_request_at timestamptz,
  version bigint,
  updated_at timestamptz
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
  with usage_clock as (
    select
      pg_catalog.statement_timestamp() as checked_at,
      (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date as usage_date
  ),
  total_usage as (
    select access.user_id, usage.used_requests, usage.used_tokens, usage.reserved_tokens
    from private.webchat_member_access as access
    cross join usage_clock
    cross join lateral public.calculate_webchat_member_total_usage(
      access.user_id, usage_clock.checked_at
    ) as usage
  ),
  today_expired as (
    select
      request.user_id,
      pg_catalog.count(*) filter (
        where request.status = 'claimed' and request.request_counted
      )::integer as claimed_requests,
      coalesce(pg_catalog.sum(request.reserved_tokens) filter (
        where request.status = 'claimed'
      ), 0)::bigint as claimed_tokens,
      coalesce(pg_catalog.sum(request.reserved_tokens) filter (
        where request.status = 'started'
      ), 0)::bigint as started_tokens
    from private.webchat_requests as request
    cross join usage_clock
    where request.quota_date = usage_clock.usage_date
      and request.status in ('claimed', 'started')
      and request.lease_expires_at <= usage_clock.checked_at
    group by request.user_id
  ),
  active_requests as (
    select request.user_id, pg_catalog.count(*)::integer as active_request_count
    from private.webchat_requests as request
    cross join usage_clock
    where request.status in ('claimed', 'started')
      and request.lease_expires_at > usage_clock.checked_at
    group by request.user_id
  ),
  request_history as (
    select request.user_id, pg_catalog.max(request.claimed_at) as last_request_at
    from private.webchat_requests as request group by request.user_id
  )
  select
    access.user_id,
    profile.full_name,
    profile.grade,
    profile.major,
    profile.role,
    profile.review_status,
    access.access_enabled,
    access.pilot_observation_enabled,
    access.total_request_limit,
    access.total_token_limit,
    total_usage.used_requests,
    total_usage.used_tokens,
    total_usage.reserved_tokens,
    greatest(access.total_request_limit - total_usage.used_requests, 0)::integer,
    greatest(
      access.total_token_limit - total_usage.used_tokens - total_usage.reserved_tokens,
      0::bigint
    )::bigint,
    usage_clock.usage_date,
    greatest(
      coalesce(today_usage.request_count, 0) - coalesce(today_expired.claimed_requests, 0),
      0
    )::integer,
    (
      coalesce(today_usage.total_tokens, 0) + coalesce(today_expired.started_tokens, 0)
    )::bigint,
    greatest(
      coalesce(today_usage.reserved_tokens, 0)
        - coalesce(today_expired.claimed_tokens, 0)
        - coalesce(today_expired.started_tokens, 0),
      0::bigint
    )::bigint,
    coalesce(active.active_request_count, 0)::integer,
    history.last_request_at,
    access.version,
    access.updated_at
  from private.webchat_member_access as access
  join public.profiles as profile on profile.id = access.user_id
  join total_usage on total_usage.user_id = access.user_id
  cross join usage_clock
  left join private.webchat_daily_usage as today_usage
    on today_usage.user_id = access.user_id
    and today_usage.usage_date = usage_clock.usage_date
  left join today_expired on today_expired.user_id = access.user_id
  left join active_requests as active on active.user_id = access.user_id
  left join request_history as history on history.user_id = access.user_id
  order by access.pilot_observation_enabled desc, access.access_enabled desc,
    history.last_request_at desc nulls last, access.updated_at desc, access.user_id;
end;
$$;

create or replace function public.admin_read_webchat_pilot_observation()
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
  observation_state as (
    select state.roster_changed_at
    from private.webchat_pilot_observation_state as state
    where state.singleton
  ),
  cohort as (
    select access.user_id
    from private.webchat_member_access as access
    join public.profiles as profile on profile.id = access.user_id
    where access.access_enabled
      and access.pilot_observation_enabled
      and profile.review_status = 'approved'::public.profile_review_status
  ),
  cohort_summary as (
    select pg_catalog.count(*)::integer as enabled_members from cohort
  ),
  observed as (
    select request.*
    from private.webchat_requests as request
    join cohort on cohort.user_id = request.user_id
    cross join observation_state
    where request.claimed_at >= observation_state.roster_changed_at
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
    from observed cross join clock
  ),
  summary as (
    select
      clock.checked_at,
      case when cohort_summary.enabled_members > 0
        then observation_state.roster_changed_at else null::timestamptz end as cohort_started_at,
      case when cohort_summary.enabled_members > 0 then greatest(
        pg_catalog.floor(
          extract(epoch from (clock.checked_at - observation_state.roster_changed_at)) / 3600
        ),
        0
      )::integer else 0 end as observation_hours,
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
    from clock cross join observation_state cross join cohort_summary cross join request_summary
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

revoke all on function public.admin_get_webchat_member_policy(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.admin_update_webchat_member_policy(
  uuid, boolean, boolean, integer, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_webchat_pilot_members()
from public, anon, authenticated, service_role;
revoke all on function public.admin_read_webchat_pilot_observation()
from public, anon, authenticated, service_role;

grant execute on function public.admin_get_webchat_member_policy(uuid) to authenticated;
grant execute on function public.admin_update_webchat_member_policy(
  uuid, boolean, boolean, integer, bigint, bigint, text
) to authenticated;
grant execute on function public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
) to authenticated;
grant execute on function public.admin_list_webchat_pilot_members() to authenticated;
grant execute on function public.admin_read_webchat_pilot_observation() to authenticated;

comment on column private.webchat_member_access.pilot_observation_enabled is
  'Whether the authorized account is explicitly enrolled in the formal 3-5 member WebChat observation cohort.';
comment on table private.webchat_pilot_observation_state is
  'Private singleton clock reset by formal WebChat roster and enrolled-member policy changes.';
comment on function public.admin_get_webchat_member_policy(uuid) is
  'Reads bounded WebChat access, cumulative quotas, and formal pilot enrollment for one eligible account.';
comment on function public.admin_update_webchat_member_policy(
  uuid, boolean, boolean, integer, bigint, bigint, text
) is 'Atomically updates WebChat access, cumulative quotas, and formal pilot enrollment with a five-member ceiling.';
comment on function public.admin_list_webchat_pilot_members() is
  'Lists explicitly configured WebChat accounts and indicates which are enrolled in the formal observation cohort.';
comment on function public.admin_read_webchat_pilot_observation() is
  'Returns a content-free health summary for the independently selected 3-5 member WebChat pilot cohort.';
