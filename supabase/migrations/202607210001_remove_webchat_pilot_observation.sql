-- Retire the formal WebChat pilot roster and continuous observation workflow.
-- Member authorization, cumulative quotas, usage accounting, cache metrics,
-- conversations, and global budgets remain unchanged.

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

update private.webchat_member_access
set pilot_observation_enabled = false
where pilot_observation_enabled;

alter table private.webchat_member_access
  drop constraint if exists webchat_member_access_pilot_requires_access;
alter table private.webchat_member_access
  add constraint webchat_member_access_pilot_retired
  check (not pilot_observation_enabled);

drop trigger if exists webchat_member_access_touch_pilot_observation
on private.webchat_member_access;
drop trigger if exists profiles_touch_webchat_pilot_observation
on public.profiles;

drop function if exists public.admin_read_webchat_pilot_observation();
drop function if exists public.admin_update_webchat_member_policy(
  uuid, boolean, boolean, integer, bigint, bigint, text
);
drop function if exists public.admin_get_webchat_member_policy(uuid);
drop function if exists private.touch_webchat_pilot_observation_state();
drop function if exists private.touch_webchat_pilot_observation_for_profile();

drop table if exists private.webchat_pilot_observation_state;
drop index if exists private.webchat_member_access_pilot_roster_idx;

revoke all on function public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
) to authenticated;

comment on column private.webchat_member_access.pilot_observation_enabled is
  'Deprecated compatibility column. Formal WebChat pilot observation was retired; values remain false.';
comment on function public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
) is 'Atomically updates member WebChat authorization and cumulative quotas without a pilot roster.';
comment on function public.admin_list_webchat_pilot_members() is
  'Legacy-named RPC listing configured WebChat accounts and aggregate usage; formal pilot observation is retired.';
