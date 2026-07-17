-- WebChat pilot access is deny-by-default and remains separate from public
-- profiles. Browser administrators may change only bounded, non-secret member
-- policy, while paid-request admission stays inside service-only database RPCs.

create table private.webchat_member_access (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  access_enabled boolean not null default false,
  daily_request_limit integer not null default 30,
  daily_token_limit bigint not null default 100000,
  version bigint not null default 1,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint webchat_member_access_daily_request_limit check (
    daily_request_limit between 1 and 10000
  ),
  constraint webchat_member_access_daily_token_limit check (
    daily_token_limit between 100 and 1000000000
  ),
  constraint webchat_member_access_version_positive check (version >= 1)
);

create index webchat_member_access_updated_by_idx
  on private.webchat_member_access (updated_by)
  where updated_by is not null;

alter table private.webchat_member_access enable row level security;
revoke all on table private.webchat_member_access
from public, anon, authenticated, service_role;

create function public.admin_get_webchat_member_access(target_profile_id uuid)
returns table (
  access_enabled boolean,
  daily_request_limit integer,
  daily_token_limit bigint,
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
    select 1
    from public.profiles as profile
    where profile.id = target_profile_id
      and profile.role = 'member'
      and profile.review_status in ('approved', 'suspended')
  ) then
    raise exception 'Eligible member profile not found.' using errcode = 'P0002';
  end if;

  return query
  select
    coalesce(access.access_enabled, false),
    coalesce(access.daily_request_limit, 30),
    coalesce(access.daily_token_limit, 100000::bigint),
    coalesce(access.version, 0::bigint),
    access.updated_at
  from (select true) as singleton
  left join private.webchat_member_access as access
    on access.user_id = target_profile_id;
end;
$$;

create function public.admin_update_webchat_member_access(
  target_profile_id uuid,
  requested_access_enabled boolean,
  requested_daily_request_limit integer,
  requested_daily_token_limit bigint,
  expected_version bigint,
  reason text
)
returns table (
  access_enabled boolean,
  daily_request_limit integer,
  daily_token_limit bigint,
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

  perform public.consume_admin_rate_limit(
    actor_id,
    'webchat_member_access.write',
    30,
    60
  );

  if target_profile_id is null then
    raise exception 'Target profile is required.' using errcode = '22004';
  end if;
  if requested_access_enabled is null then
    raise exception 'Member WebChat access state is required.' using errcode = '22004';
  end if;
  if requested_daily_request_limit is null
    or requested_daily_request_limit not between 1 and 10000 then
    raise exception 'Member daily request limit must be between 1 and 10000.'
      using errcode = '22023';
  end if;
  if requested_daily_token_limit is null
    or requested_daily_token_limit not between 100 and 1000000000 then
    raise exception 'Member daily token limit must be between 100 and 1000000000.'
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

  -- Use the same deterministic administrator-row order as role handoff. The
  -- caller therefore cannot be demoted or suspended after the live check and
  -- before this policy change commits.
  perform 1
  from public.profiles as administrator
  where administrator.role = 'admin'
  order by administrator.id
  for share;

  if actor_id is distinct from (select auth.uid()) or not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  -- Protect the FK target from deletion while the private policy is changed.
  perform 1
  from public.profiles as profile
  where profile.id = target_profile_id
    and profile.role = 'member'
    and profile.review_status in ('approved', 'suspended')
  for key share;

  if not found then
    raise exception 'Eligible member profile not found.' using errcode = 'P0002';
  end if;

  if requested_access_enabled and not exists (
    select 1
    from public.profiles as profile
    where profile.id = target_profile_id
      and profile.role = 'member'
      and profile.review_status = 'approved'
  ) then
    raise exception 'Only an active member can receive WebChat access.' using errcode = '42501';
  end if;

  select access.* into current_access
  from private.webchat_member_access as access
  where access.user_id = target_profile_id
  for update;

  if found then
    previous_enabled := current_access.access_enabled;
    previous_request_limit := current_access.daily_request_limit;
    previous_token_limit := current_access.daily_token_limit;
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
  if previous_request_limit is distinct from requested_daily_request_limit then
    changed_fields := pg_catalog.array_append(changed_fields, 'dailyRequestLimit');
  end if;
  if previous_token_limit is distinct from requested_daily_token_limit then
    changed_fields := pg_catalog.array_append(changed_fields, 'dailyTokenLimit');
  end if;
  if pg_catalog.cardinality(changed_fields) = 0 then
    raise exception 'At least one member WebChat access field must change.'
      using errcode = '22023';
  end if;

  if previous_version = 0 then
    insert into private.webchat_member_access as access (
      user_id,
      access_enabled,
      daily_request_limit,
      daily_token_limit,
      version,
      updated_at,
      updated_by
    ) values (
      target_profile_id,
      requested_access_enabled,
      requested_daily_request_limit,
      requested_daily_token_limit,
      1,
      checked_at,
      actor_id
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
      daily_request_limit = requested_daily_request_limit,
      daily_token_limit = requested_daily_token_limit,
      version = access.version + 1,
      updated_at = checked_at,
      updated_by = actor_id
    where access.user_id = target_profile_id
      and access.version = expected_version
    returning access.* into current_access;

    if not found then
      raise exception 'Member WebChat access changed after it was loaded.'
        using errcode = '40001';
    end if;
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    before_data,
    after_data,
    metadata
  ) values (
    actor_id,
    'webchat_member_access_update',
    'webchat_member_access',
    target_profile_id::text,
    pg_catalog.jsonb_build_object(
      'accessEnabled', previous_enabled,
      'dailyRequestLimit', previous_request_limit,
      'dailyTokenLimit', previous_token_limit,
      'version', previous_version
    ),
    pg_catalog.jsonb_build_object(
      'accessEnabled', current_access.access_enabled,
      'dailyRequestLimit', current_access.daily_request_limit,
      'dailyTokenLimit', current_access.daily_token_limit,
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
    current_access.daily_request_limit,
    current_access.daily_token_limit,
    current_access.version,
    current_access.updated_at;
end;
$$;

create function public.read_webchat_member_runtime_access(requested_user_id uuid)
returns table (
  account_eligible boolean,
  access_enabled boolean,
  daily_request_limit integer,
  daily_token_limit bigint,
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
    coalesce(profile.role = 'member' and profile.review_status = 'approved', false),
    coalesce(access.access_enabled, false),
    coalesce(access.daily_request_limit, 30),
    coalesce(access.daily_token_limit, 100000::bigint),
    coalesce(access.version, 0::bigint)
  from (select true) as singleton
  left join public.profiles as profile
    on profile.id = requested_user_id
  left join private.webchat_member_access as access
    on access.user_id = requested_user_id;
end;
$$;

create function public.read_own_webchat_usage()
returns table (
  access_enabled boolean,
  usage_date date,
  daily_request_limit integer,
  request_count integer,
  remaining_requests integer,
  daily_token_limit bigint,
  settled_tokens bigint,
  reserved_tokens bigint,
  remaining_tokens bigint,
  reset_at timestamptz
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
  with usage_clock as (
    select
      pg_catalog.statement_timestamp() as checked_at,
      (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date as usage_date
  ),
  policy as (
    select
      coalesce(profile.role = 'member' and profile.review_status = 'approved', false)
        and coalesce(access.access_enabled, false) as access_enabled,
      coalesce(access.daily_request_limit, 30)::integer as daily_request_limit,
      coalesce(access.daily_token_limit, 100000::bigint)::bigint as daily_token_limit
    from (select true) as singleton
    left join public.profiles as profile on profile.id = actor_id
    left join private.webchat_member_access as access on access.user_id = actor_id
  ),
  expired_active as (
    select
      pg_catalog.count(*) filter (
        where request.status = 'claimed' and request.request_counted
      )::integer as claimed_requests,
      coalesce(pg_catalog.sum(request.reserved_tokens) filter (
        where request.status = 'claimed'
      ), 0)::bigint as claimed_tokens,
      coalesce(pg_catalog.sum(request.reserved_tokens) filter (
        where request.status = 'started'
      ), 0)::bigint as started_tokens
    from usage_clock
    left join private.webchat_requests as request
      on request.user_id = actor_id
      and request.quota_date = usage_clock.usage_date
      and request.status in ('claimed', 'started')
      and request.lease_expires_at <= usage_clock.checked_at
  ),
  effective_usage as (
    select
      usage_clock.usage_date,
      greatest(
        coalesce(usage.request_count, 0) - expired_active.claimed_requests,
        0
      )::integer as request_count,
      (
        coalesce(usage.total_tokens, 0) + expired_active.started_tokens
      )::bigint as settled_tokens,
      greatest(
        coalesce(usage.reserved_tokens, 0)
          - expired_active.claimed_tokens
          - expired_active.started_tokens,
        0::bigint
      )::bigint as reserved_tokens
    from usage_clock
    cross join expired_active
    left join private.webchat_daily_usage as usage
      on usage.user_id = actor_id
      and usage.usage_date = usage_clock.usage_date
  )
  select
    policy.access_enabled,
    effective_usage.usage_date,
    policy.daily_request_limit,
    effective_usage.request_count,
    greatest(
      policy.daily_request_limit - effective_usage.request_count,
      0
    )::integer,
    policy.daily_token_limit,
    effective_usage.settled_tokens,
    effective_usage.reserved_tokens,
    greatest(
      policy.daily_token_limit
        - effective_usage.settled_tokens
        - effective_usage.reserved_tokens,
      0::bigint
    )::bigint,
    ((effective_usage.usage_date + 1)::timestamp at time zone 'Asia/Shanghai')
  from policy
  cross join effective_usage;
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
  remaining_daily_requests integer,
  remaining_daily_tokens bigint,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  beijing_date date := (checked_at at time zone 'Asia/Shanghai')::date;
  relay_config private.webchat_relay_config%rowtype;
  member_access private.webchat_member_access%rowtype;
  account_eligible boolean := false;
  current_request_count integer := 0;
  current_total_tokens bigint := 0;
  current_reserved_tokens bigint := 0;
begin
  if requested_user_id is null or requested_owner_token is null then
    raise exception 'User ID and owner token are required.' using errcode = '22004';
  end if;
  if requested_request_id is null
    or requested_request_id !~ '^[A-Za-z0-9._:-]{1,128}$' then
    raise exception 'Request ID has an invalid format.' using errcode = '22023';
  end if;
  if requested_fingerprint is null
    or requested_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Request fingerprint has an invalid format.' using errcode = '22023';
  end if;
  if minute_request_limit is null or minute_request_limit not between 1 and 1000 then
    raise exception 'Minute request limit must be between 1 and 1000.' using errcode = '22023';
  end if;
  if requested_reserved_tokens is null
    or requested_reserved_tokens not between 1 and 1000000000 then
    raise exception 'Reserved tokens must be between 1 and 1000000000.'
      using errcode = '22023';
  end if;
  if lease_seconds is null or lease_seconds not between 121 and 600 then
    raise exception 'Lease must be between 121 and 600 seconds.' using errcode = '22023';
  end if;

  -- Match every accounting transition: global lock before any member quota lock.
  -- Relay/profile/access share locks then make the admission decision stable
  -- through the nested legacy claim without introducing a reverse lock path.
  perform 1
  from private.webchat_global_quota_state as global_state
  where global_state.singleton
  for update;

  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;

  select config.* into relay_config
  from private.webchat_relay_config as config
  where config.singleton
  for share;

  if not found then
    raise exception 'WebChat relay configuration singleton is missing.' using errcode = '55000';
  end if;

  select profile.role = 'member' and profile.review_status = 'approved' into account_eligible
  from public.profiles as profile
  where profile.id = requested_user_id
  for share;

  account_eligible := coalesce(account_eligible, false);

  select access.* into member_access
  from private.webchat_member_access as access
  where access.user_id = requested_user_id
  for share;

  if not account_eligible
    or not found
    or not coalesce(member_access.access_enabled, false) then
    return query select
      'member_access_denied'::text,
      'blocked'::text,
      0,
      0,
      0::bigint,
      null::integer;
    return;
  end if;

  if not relay_config.requests_enabled then
    return query select
      'requests_disabled'::text,
      'blocked'::text,
      0,
      0,
      0::bigint,
      null::integer;
    return;
  end if;

  if requested_reserved_tokens > member_access.daily_token_limit then
    select
      coalesce(usage.request_count, 0),
      coalesce(usage.total_tokens, 0),
      coalesce(usage.reserved_tokens, 0)
    into current_request_count, current_total_tokens, current_reserved_tokens
    from (select true) as singleton
    left join private.webchat_daily_usage as usage
      on usage.user_id = requested_user_id
      and usage.usage_date = beijing_date;

    return query select
      'request_token_limited'::text,
      'blocked'::text,
      minute_request_limit,
      greatest(member_access.daily_request_limit - current_request_count, 0),
      greatest(
        member_access.daily_token_limit - current_total_tokens - current_reserved_tokens,
        0::bigint
      ),
      null::integer;
    return;
  end if;

  return query
  select *
  from public.claim_webchat_request(
    requested_user_id,
    requested_request_id,
    requested_fingerprint,
    requested_owner_token,
    minute_request_limit,
    member_access.daily_request_limit,
    member_access.daily_token_limit,
    relay_config.global_daily_request_limit,
    relay_config.global_daily_token_limit,
    requested_reserved_tokens,
    lease_seconds
  );
end;
$$;

create function public.mark_authorized_webchat_request_started(
  requested_user_id uuid,
  requested_request_id text,
  requested_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  relay_requests_enabled boolean := false;
  account_eligible boolean := false;
  member_enabled boolean := false;
begin
  -- This lock order is a suffix of claim admission and precedes the legacy
  -- per-user quota lock: relay config -> profile -> access -> quota state.
  select config.requests_enabled into relay_requests_enabled
  from private.webchat_relay_config as config
  where config.singleton
  for share;

  if not found or not relay_requests_enabled then
    return false;
  end if;

  select profile.role = 'member' and profile.review_status = 'approved' into account_eligible
  from public.profiles as profile
  where profile.id = requested_user_id
  for share;

  if not found or not account_eligible then
    return false;
  end if;

  select access.access_enabled into member_enabled
  from private.webchat_member_access as access
  where access.user_id = requested_user_id
  for share;

  if not found or not member_enabled then
    return false;
  end if;

  return public.mark_webchat_request_started(
    requested_user_id,
    requested_request_id,
    requested_owner_token
  );
end;
$$;

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
revoke all on function public.mark_authorized_webchat_request_started(uuid, text, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.admin_get_webchat_member_access(uuid)
to authenticated;
grant execute on function public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
) to authenticated;
grant execute on function public.read_own_webchat_usage()
to authenticated;

grant execute on function public.read_webchat_member_runtime_access(uuid)
to service_role;
grant execute on function public.claim_authorized_webchat_request(
  uuid, text, text, uuid, integer, bigint, integer
) to service_role;
grant execute on function public.mark_authorized_webchat_request_started(uuid, text, uuid)
to service_role;

-- The service role must use the authorization-aware wrappers. Finalize and
-- release remain callable so an already claimed request can always settle or
-- refund after an administrator revokes access.
revoke all on function public.claim_webchat_request(
  uuid, text, text, uuid, integer, integer, bigint, integer, bigint, bigint, integer
) from service_role;
revoke all on function public.mark_webchat_request_started(uuid, text, uuid)
from service_role;

comment on table private.webchat_member_access is
  'Private deny-by-default WebChat access and daily quota policy for selected members.';
comment on function public.admin_get_webchat_member_access(uuid) is
  'Returns one member WebChat policy, using disabled version-zero defaults when no private row exists.';
comment on function public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
) is 'Changes bounded member WebChat access with live administrator checks, rate limiting, optimistic locking, and redacted audit.';
comment on function public.read_webchat_member_runtime_access(uuid) is
  'Returns service-only member eligibility and private WebChat quota policy without profile details.';
comment on function public.read_own_webchat_usage() is
  'Returns only the JWT member current Beijing-day WebChat usage, effective access, limits, and remaining quota.';
comment on function public.claim_authorized_webchat_request(
  uuid, text, text, uuid, integer, bigint, integer
) is 'Atomically rechecks account, member access, relay switch, member quotas, and global quotas before claiming paid WebChat work.';
comment on function public.mark_authorized_webchat_request_started(uuid, text, uuid) is
  'Starts a claimed WebChat request only while the relay, account, and member authorization remain enabled.';
