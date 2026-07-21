-- Make AI access available to every current and future member by default.
-- Paid-request admission remains fail-closed: service RPCs still require an
-- explicit private.webchat_member_access row before upstream work can start.

alter table private.webchat_member_access
  alter column access_enabled set default true,
  alter column total_request_limit set default 10000,
  alter column total_token_limit set default 5000000;

create function private.create_default_webchat_member_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.webchat_member_access (
    user_id,
    access_enabled,
    pilot_observation_enabled,
    total_request_limit,
    total_token_limit
  ) values (
    new.id,
    true,
    false,
    10000,
    5000000
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function private.create_default_webchat_member_access()
from public, anon, authenticated, service_role;

create trigger profiles_create_default_webchat_member_access
after insert on public.profiles
for each row execute function private.create_default_webchat_member_access();

insert into private.webchat_member_access (
  user_id,
  access_enabled,
  pilot_observation_enabled,
  total_request_limit,
  total_token_limit
)
select
  profile.id,
  true,
  false,
  10000,
  5000000
from public.profiles as profile
on conflict (user_id) do nothing;

update private.webchat_member_access as access
set
  access_enabled = true,
  pilot_observation_enabled = false,
  total_request_limit = 10000,
  total_token_limit = 5000000,
  version = access.version + 1,
  updated_at = pg_catalog.clock_timestamp()
where access.access_enabled is distinct from true
  or access.pilot_observation_enabled is distinct from false
  or access.total_request_limit is distinct from 10000
  or access.total_token_limit is distinct from 5000000;

create or replace function public.admin_get_webchat_member_access(target_profile_id uuid)
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
    coalesce(access.access_enabled, true),
    coalesce(access.total_request_limit, 10000),
    coalesce(access.total_token_limit, 5000000::bigint),
    coalesce(access.version, 0::bigint),
    access.updated_at
  from (select true) as singleton
  left join private.webchat_member_access as access on access.user_id = target_profile_id;
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
  actor_id uuid := (select auth.uid());
  normalized_reason text := nullif(pg_catalog.btrim(reason), '');
  current_access private.webchat_member_access%rowtype;
  checked_at timestamptz := pg_catalog.clock_timestamp();
  changed_fields text[] := array[]::text[];
  previous_enabled boolean := true;
  previous_request_limit integer := 10000;
  previous_token_limit bigint := 5000000;
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
      user_id, access_enabled, pilot_observation_enabled,
      total_request_limit, total_token_limit, version, updated_at, updated_by
    ) values (
      target_profile_id, requested_access_enabled, false,
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
      pilot_observation_enabled = false,
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

create or replace function public.read_webchat_member_runtime_access(requested_user_id uuid)
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
    coalesce(access.access_enabled, true),
    coalesce(access.total_request_limit, 10000),
    coalesce(access.total_token_limit, 5000000::bigint),
    coalesce(access.version, 0::bigint)
  from (select true) as singleton
  left join public.profiles as profile on profile.id = requested_user_id
  left join private.webchat_member_access as access on access.user_id = requested_user_id;
end;
$$;

create or replace function public.read_own_webchat_usage()
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
      ) and coalesce(access.access_enabled, true) as access_enabled,
      case when coalesce(
        profile.role in ('member', 'admin') and profile.review_status = 'approved',
        false
      ) and coalesce(access.access_enabled, true)
        then nullif(pg_catalog.btrim(config.model), '') else null::text end as model,
      coalesce(access.total_request_limit, 10000)::integer as total_request_limit,
      coalesce(access.total_token_limit, 5000000::bigint)::bigint as total_token_limit
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

comment on function private.create_default_webchat_member_access() is
  'Creates the explicit private AI access row required for every new profile.';
comment on column private.webchat_member_access.access_enabled is
  'Per-account AI assistant switch; defaults enabled and may be disabled by an administrator.';
comment on column private.webchat_member_access.total_request_limit is
  'Lifetime request ceiling; defaults to 10000 and never resets automatically.';
comment on column private.webchat_member_access.total_token_limit is
  'Lifetime settled plus reserved token ceiling; defaults to 5000000 and never resets automatically.';
