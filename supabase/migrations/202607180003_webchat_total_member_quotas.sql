-- Member WebChat allowances are lifetime cumulative quotas. The authoritative
-- usage ledger remains partitioned by Beijing date for accounting and global
-- daily budgets, but member admission sums every historical ledger row.

drop function if exists public.admin_list_webchat_pilot_members();
drop function if exists public.read_own_webchat_usage();
drop function if exists public.read_webchat_member_runtime_access(uuid);
drop function if exists public.admin_get_webchat_member_access(uuid);
drop function if exists public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
);
drop function if exists public.claim_authorized_webchat_request(
  uuid, text, text, uuid, integer, bigint, integer
);

alter function public.claim_webchat_request(
  uuid, text, text, uuid, integer, integer, bigint, integer, bigint, bigint, integer
)
rename to claim_webchat_request_internal;

alter table private.webchat_member_access
  rename column daily_request_limit to total_request_limit;
alter table private.webchat_member_access
  rename column daily_token_limit to total_token_limit;
alter table private.webchat_member_access
  rename constraint webchat_member_access_daily_request_limit
  to webchat_member_access_total_request_limit;
alter table private.webchat_member_access
  rename constraint webchat_member_access_daily_token_limit
  to webchat_member_access_total_token_limit;

create function public.calculate_webchat_member_total_usage(
  requested_user_id uuid,
  checked_at timestamptz default pg_catalog.statement_timestamp()
)
returns table (
  used_requests integer,
  used_tokens bigint,
  reserved_tokens bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with ledger as (
    select
      coalesce(pg_catalog.sum(usage.request_count), 0)::bigint as request_count,
      coalesce(pg_catalog.sum(usage.total_tokens), 0)::bigint as total_tokens,
      coalesce(pg_catalog.sum(usage.reserved_tokens), 0)::bigint as reserved_tokens
    from private.webchat_daily_usage as usage
    where usage.user_id = requested_user_id
  ),
  expired_active as (
    select
      pg_catalog.count(*) filter (
        where request.status = 'claimed' and request.request_counted
      )::bigint as claimed_requests,
      coalesce(pg_catalog.sum(request.reserved_tokens) filter (
        where request.status = 'claimed'
      ), 0)::bigint as claimed_tokens,
      coalesce(pg_catalog.sum(request.reserved_tokens) filter (
        where request.status = 'started'
      ), 0)::bigint as started_tokens
    from private.webchat_requests as request
    where request.user_id = requested_user_id
      and request.status in ('claimed', 'started')
      and request.lease_expires_at <= checked_at
  )
  select
    greatest(ledger.request_count - expired_active.claimed_requests, 0)::integer,
    (ledger.total_tokens + expired_active.started_tokens)::bigint,
    greatest(
      ledger.reserved_tokens
        - expired_active.claimed_tokens
        - expired_active.started_tokens,
      0::bigint
    )::bigint
  from ledger
  cross join expired_active
$$;

create function public.reconcile_expired_webchat_member_requests(
  requested_user_id uuid,
  checked_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale_request private.webchat_requests%rowtype;
begin
  for stale_request in
    select request.*
    from private.webchat_requests as request
    where request.user_id = requested_user_id
      and request.status in ('claimed', 'started')
      and request.lease_expires_at <= checked_at
    order by request.claimed_at, request.request_id
    for update
  loop
    if stale_request.status = 'claimed' then
      update private.webchat_daily_usage as usage
      set
        request_count = greatest(
          usage.request_count - case when stale_request.request_counted then 1 else 0 end,
          0
        ),
        reserved_tokens = greatest(
          usage.reserved_tokens - stale_request.reserved_tokens,
          0::bigint
        ),
        updated_at = checked_at
      where usage.user_id = stale_request.user_id
        and usage.usage_date = stale_request.quota_date;

      update private.webchat_global_daily_usage as usage
      set
        request_count = greatest(
          usage.request_count - case when stale_request.request_counted then 1 else 0 end,
          0
        ),
        reserved_tokens = greatest(
          usage.reserved_tokens - stale_request.reserved_tokens,
          0::bigint
        ),
        updated_at = checked_at
      where usage.usage_date = stale_request.quota_date;

      update private.webchat_requests as request
      set
        status = 'released',
        request_counted = false,
        lease_expires_at = null,
        finished_at = checked_at,
        outcome = 'lease_expired_before_start',
        updated_at = checked_at
      where request.user_id = stale_request.user_id
        and request.request_id = stale_request.request_id
        and request.status = 'claimed';
    else
      update private.webchat_daily_usage as usage
      set
        reserved_tokens = greatest(
          usage.reserved_tokens - stale_request.reserved_tokens,
          0::bigint
        ),
        unknown_tokens = usage.unknown_tokens + stale_request.reserved_tokens,
        total_tokens = usage.total_tokens + stale_request.reserved_tokens,
        updated_at = checked_at
      where usage.user_id = stale_request.user_id
        and usage.usage_date = stale_request.quota_date;

      update private.webchat_global_daily_usage as usage
      set
        reserved_tokens = greatest(
          usage.reserved_tokens - stale_request.reserved_tokens,
          0::bigint
        ),
        unknown_tokens = usage.unknown_tokens + stale_request.reserved_tokens,
        total_tokens = usage.total_tokens + stale_request.reserved_tokens,
        updated_at = checked_at
      where usage.usage_date = stale_request.quota_date;

      update private.webchat_requests as request
      set
        status = 'expired',
        lease_expires_at = null,
        finished_at = checked_at,
        charged_tokens = request.reserved_tokens,
        outcome = 'lease_expired_after_start',
        updated_at = checked_at
      where request.user_id = stale_request.user_id
        and request.request_id = stale_request.request_id
        and request.status = 'started';
    end if;
  end loop;
end;
$$;

create function public.claim_webchat_total_request(
  requested_user_id uuid,
  requested_request_id text,
  requested_fingerprint text,
  requested_owner_token uuid,
  minute_request_limit integer,
  total_request_limit integer,
  total_token_limit bigint,
  global_daily_request_limit integer,
  global_daily_token_limit bigint,
  requested_reserved_tokens bigint,
  lease_seconds integer default 180
)
returns table (
  decision text,
  status text,
  remaining_minute_requests integer,
  remaining_total_requests integer,
  remaining_total_tokens bigint,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  existing_request private.webchat_requests%rowtype;
  current_usage record;
  core_result record;
  core_reserved_tokens bigint;
  core_token_limit bigint;
begin
  if requested_user_id is null or requested_owner_token is null then
    raise exception 'User ID and owner token are required.' using errcode = '22004';
  end if;
  if total_request_limit is null or total_request_limit not between 1 and 10000 then
    raise exception 'Total request limit must be between 1 and 10000.' using errcode = '22023';
  end if;
  if total_token_limit is null or total_token_limit not between 100 and 1000000000 then
    raise exception 'Total token limit must be between 100 and 1000000000.' using errcode = '22023';
  end if;
  if requested_reserved_tokens is null
    or requested_reserved_tokens not between 1 and 1000000000 then
    raise exception 'Reserved tokens must be between 1 and 1000000000.'
      using errcode = '22023';
  end if;

  perform 1
  from private.webchat_global_quota_state as global_state
  where global_state.singleton
  for update;
  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;

  insert into private.webchat_quota_states as quota_state (user_id, updated_at)
  values (requested_user_id, checked_at)
  on conflict (user_id) do nothing;

  perform 1
  from private.webchat_quota_states as quota_state
  where quota_state.user_id = requested_user_id
  for update;

  perform public.reconcile_expired_webchat_member_requests(requested_user_id, checked_at);

  select request.* into existing_request
  from private.webchat_requests as request
  where request.user_id = requested_user_id
    and request.request_id = requested_request_id;

  if found then
    core_reserved_tokens := least(greatest(requested_reserved_tokens, 1::bigint), 1000000000::bigint);
    core_token_limit := greatest(total_token_limit, core_reserved_tokens);

    select * into core_result
    from public.claim_webchat_request_internal(
      requested_user_id,
      requested_request_id,
      requested_fingerprint,
      requested_owner_token,
      minute_request_limit,
      total_request_limit,
      core_token_limit,
      global_daily_request_limit,
      global_daily_token_limit,
      core_reserved_tokens,
      lease_seconds
    );

    select * into current_usage
    from public.calculate_webchat_member_total_usage(requested_user_id, checked_at);

    return query select
      core_result.decision,
      core_result.status,
      core_result.remaining_minute_requests,
      greatest(total_request_limit - current_usage.used_requests, 0),
      greatest(
        total_token_limit - current_usage.used_tokens - current_usage.reserved_tokens,
        0::bigint
      ),
      core_result.retry_after_seconds;
    return;
  end if;

  select * into current_usage
  from public.calculate_webchat_member_total_usage(requested_user_id, checked_at);

  if current_usage.used_requests >= total_request_limit then
    return query select
      'member_total_request_limited'::text,
      'blocked'::text,
      minute_request_limit,
      0,
      greatest(
        total_token_limit - current_usage.used_tokens - current_usage.reserved_tokens,
        0::bigint
      ),
      null::integer;
    return;
  end if;

  if current_usage.used_tokens
      + current_usage.reserved_tokens
      + requested_reserved_tokens > total_token_limit then
    return query select
      'member_total_token_limited'::text,
      'blocked'::text,
      minute_request_limit,
      greatest(total_request_limit - current_usage.used_requests, 0),
      greatest(
        total_token_limit - current_usage.used_tokens - current_usage.reserved_tokens,
        0::bigint
      ),
      null::integer;
    return;
  end if;

  select * into core_result
  from public.claim_webchat_request_internal(
    requested_user_id,
    requested_request_id,
    requested_fingerprint,
    requested_owner_token,
    minute_request_limit,
    total_request_limit,
    total_token_limit,
    global_daily_request_limit,
    global_daily_token_limit,
    requested_reserved_tokens,
    lease_seconds
  );

  select * into current_usage
  from public.calculate_webchat_member_total_usage(requested_user_id, checked_at);

  return query select
    case core_result.decision
      when 'daily_request_limited' then 'member_total_request_limited'::text
      when 'daily_token_limited' then 'member_total_token_limited'::text
      else core_result.decision
    end,
    core_result.status,
    core_result.remaining_minute_requests,
    greatest(total_request_limit - current_usage.used_requests, 0),
    greatest(
      total_token_limit - current_usage.used_tokens - current_usage.reserved_tokens,
      0::bigint
    ),
    case
      when core_result.decision in ('daily_request_limited', 'daily_token_limited')
        then null::integer
      else core_result.retry_after_seconds
    end;
end;
$$;

create function public.admin_get_webchat_member_access(target_profile_id uuid)
returns table (
  access_enabled boolean,
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
    coalesce(access.total_request_limit, 30),
    coalesce(access.total_token_limit, 100000::bigint),
    coalesce(access.version, 0::bigint),
    access.updated_at
  from (select true) as singleton
  left join private.webchat_member_access as access on access.user_id = target_profile_id;
end;
$$;

create function public.admin_update_webchat_member_access(
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
  actor_id uuid := (select auth.uid());
  normalized_reason text := nullif(pg_catalog.btrim(reason), '');
  current_access private.webchat_member_access%rowtype;
  checked_at timestamptz := pg_catalog.clock_timestamp();
  changed_fields text[] := array[]::text[];
  previous_enabled boolean := false;
  previous_request_limit integer := 30;
  previous_token_limit bigint := 100000;
  previous_version bigint := 0;
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
  if requested_access_enabled and not exists (
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

  if previous_enabled is distinct from requested_access_enabled then
    changed_fields := pg_catalog.array_append(changed_fields, 'accessEnabled');
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
      user_id, access_enabled, total_request_limit, total_token_limit,
      version, updated_at, updated_by
    ) values (
      target_profile_id, requested_access_enabled,
      requested_total_request_limit, requested_total_token_limit,
      1, checked_at, actor_id
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
      'totalRequestLimit', previous_request_limit,
      'totalTokenLimit', previous_token_limit,
      'version', previous_version
    ),
    pg_catalog.jsonb_build_object(
      'accessEnabled', current_access.access_enabled,
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
    current_access.total_request_limit,
    current_access.total_token_limit,
    current_access.version,
    current_access.updated_at;
end;
$$;

create function public.read_webchat_member_runtime_access(requested_user_id uuid)
returns table (
  account_eligible boolean,
  access_enabled boolean,
  total_request_limit integer,
  total_token_limit bigint,
  version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if requested_user_id is null then
    raise exception 'User ID is required.' using errcode = '22004';
  end if;
  return query
  select
    coalesce(profile.role in ('member', 'admin') and profile.review_status = 'approved', false),
    coalesce(access.access_enabled, false),
    coalesce(access.total_request_limit, 30),
    coalesce(access.total_token_limit, 100000::bigint),
    coalesce(access.version, 0::bigint)
  from (select true) as singleton
  left join public.profiles as profile on profile.id = requested_user_id
  left join private.webchat_member_access as access on access.user_id = requested_user_id;
end;
$$;

create function public.read_own_webchat_usage()
returns table (
  access_enabled boolean,
  model text,
  total_request_limit integer,
  used_requests integer,
  remaining_requests integer,
  total_token_limit bigint,
  used_tokens bigint,
  reserved_tokens bigint,
  remaining_tokens bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'Authenticated member access required.' using errcode = '42501';
  end if;

  return query
  with policy as (
    select
      coalesce(
        profile.role in ('member', 'admin') and profile.review_status = 'approved',
        false
      ) and coalesce(access.access_enabled, false) as access_enabled,
      case when coalesce(
        profile.role in ('member', 'admin') and profile.review_status = 'approved',
        false
      ) and coalesce(access.access_enabled, false)
        then nullif(pg_catalog.btrim(config.model), '') else null::text end as model,
      coalesce(access.total_request_limit, 30)::integer as total_request_limit,
      coalesce(access.total_token_limit, 100000::bigint)::bigint as total_token_limit
    from (select true) as singleton
    left join public.profiles as profile on profile.id = actor_id
    left join private.webchat_member_access as access on access.user_id = actor_id
    left join private.webchat_relay_config as config on config.singleton
  ),
  usage as (
    select * from public.calculate_webchat_member_total_usage(
      actor_id,
      pg_catalog.statement_timestamp()
    )
  )
  select
    policy.access_enabled,
    policy.model,
    policy.total_request_limit,
    usage.used_requests,
    greatest(policy.total_request_limit - usage.used_requests, 0)::integer,
    policy.total_token_limit,
    usage.used_tokens,
    usage.reserved_tokens,
    greatest(
      policy.total_token_limit - usage.used_tokens - usage.reserved_tokens,
      0::bigint
    )::bigint
  from policy cross join usage;
end;
$$;

create function public.claim_authorized_webchat_request(
  requested_user_id uuid,
  requested_request_id text,
  requested_fingerprint text,
  requested_owner_token uuid,
  minute_request_limit integer,
  requested_reserved_tokens bigint,
  lease_seconds integer default 180
)
returns table (
  decision text,
  status text,
  remaining_minute_requests integer,
  remaining_total_requests integer,
  remaining_total_tokens bigint,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  relay_config private.webchat_relay_config%rowtype;
  member_access private.webchat_member_access%rowtype;
  account_eligible boolean := false;
begin
  if requested_user_id is null or requested_owner_token is null then
    raise exception 'User ID and owner token are required.' using errcode = '22004';
  end if;

  select config.* into relay_config
  from private.webchat_relay_config as config
  where config.singleton for share;
  if not found then
    raise exception 'WebChat relay configuration singleton is missing.' using errcode = '55000';
  end if;

  select profile.role in ('member', 'admin') and profile.review_status = 'approved'
  into account_eligible
  from public.profiles as profile
  where profile.id = requested_user_id for share;
  account_eligible := coalesce(account_eligible, false);

  select access.* into member_access
  from private.webchat_member_access as access
  where access.user_id = requested_user_id for share;

  if not account_eligible or not found or not coalesce(member_access.access_enabled, false) then
    return query select 'member_access_denied'::text, 'blocked'::text, 0, 0, 0::bigint, null::integer;
    return;
  end if;
  if not relay_config.requests_enabled then
    return query select 'requests_disabled'::text, 'blocked'::text, 0, 0, 0::bigint, null::integer;
    return;
  end if;

  return query
  select * from public.claim_webchat_total_request(
    requested_user_id,
    requested_request_id,
    requested_fingerprint,
    requested_owner_token,
    minute_request_limit,
    member_access.total_request_limit,
    member_access.total_token_limit,
    relay_config.global_daily_request_limit,
    relay_config.global_daily_token_limit,
    requested_reserved_tokens,
    lease_seconds
  );
end;
$$;

create function public.admin_list_webchat_pilot_members()
returns table (
  user_id uuid,
  full_name text,
  grade text,
  major text,
  role public.app_role,
  review_status public.profile_review_status,
  access_enabled boolean,
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
    select
      access.user_id,
      usage.used_requests,
      usage.used_tokens,
      usage.reserved_tokens
    from private.webchat_member_access as access
    cross join usage_clock
    cross join lateral public.calculate_webchat_member_total_usage(
      access.user_id,
      usage_clock.checked_at
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
  order by access.access_enabled desc, history.last_request_at desc nulls last,
    access.updated_at desc, access.user_id;
end;
$$;

revoke all on function public.calculate_webchat_member_total_usage(uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.reconcile_expired_webchat_member_requests(uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.claim_webchat_total_request(
  uuid, text, text, uuid, integer, integer, bigint, integer, bigint, bigint, integer
) from public, anon, authenticated, service_role;
revoke all on function public.claim_webchat_request_internal(
  uuid, text, text, uuid, integer, integer, bigint, integer, bigint, bigint, integer
) from public, anon, authenticated, service_role;

revoke all on function public.admin_get_webchat_member_access(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.read_webchat_member_runtime_access(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.read_own_webchat_usage()
from public, anon, authenticated, service_role;
revoke all on function public.claim_authorized_webchat_request(
  uuid, text, text, uuid, integer, bigint, integer
) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_webchat_pilot_members()
from public, anon, authenticated, service_role;

grant execute on function public.admin_get_webchat_member_access(uuid) to authenticated;
grant execute on function public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
) to authenticated;
grant execute on function public.read_own_webchat_usage() to authenticated;
grant execute on function public.admin_list_webchat_pilot_members() to authenticated;
grant execute on function public.read_webchat_member_runtime_access(uuid) to service_role;
grant execute on function public.claim_authorized_webchat_request(
  uuid, text, text, uuid, integer, bigint, integer
) to service_role;

comment on column private.webchat_member_access.total_request_limit is
  'Lifetime cumulative member request allowance; renamed from the former daily limit without changing stored values.';
comment on column private.webchat_member_access.total_token_limit is
  'Lifetime cumulative member token allowance; renamed from the former daily limit without changing stored values.';
comment on function public.read_own_webchat_usage() is
  'Returns the JWT account cumulative WebChat usage, effective access, authorized model, total limits, and remaining allowance.';
comment on function public.claim_authorized_webchat_request(
  uuid, text, text, uuid, integer, bigint, integer
) is 'Claims paid WebChat work against lifetime member quotas and Beijing-day global budgets.';
comment on function public.admin_list_webchat_pilot_members() is
  'Lists explicit pilot accounts with cumulative member allowance and separate current Beijing-day activity.';
