-- Controlled administrator promotion and demotion with a last-admin invariant.

drop function public.admin_list_members();

create function public.admin_list_members()
returns table (
  id uuid,
  email text,
  full_name text,
  major text,
  grade text,
  qq text,
  role public.app_role,
  review_status public.profile_review_status,
  suspension_note text,
  is_public boolean,
  created_at timestamptz,
  updated_at timestamptz,
  platform_count bigint,
  verified_platform_count bigint
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
  select
    profile.id,
    user_account.email::text,
    profile.full_name,
    profile.major,
    profile.grade,
    profile.qq,
    profile.role,
    profile.review_status,
    case when profile.review_status = 'suspended' then profile.review_note else null end,
    profile.is_public,
    profile.created_at,
    profile.updated_at,
    count(account.id)::bigint,
    count(account.id) filter (where account.status = 'verified')
  from public.profiles as profile
  join auth.users as user_account on user_account.id = profile.id
  left join public.platform_accounts as account on account.profile_id = profile.id
  where profile.review_status in ('approved', 'suspended')
  group by profile.id, user_account.email
  order by
    case profile.role when 'admin' then 0 else 1 end,
    case profile.review_status when 'suspended' then 1 else 0 end,
    profile.created_at desc;
end;
$$;

create function public.admin_set_member_role(
  target_profile_id uuid,
  next_role public.app_role,
  expected_updated_at timestamptz,
  reason text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text := nullif(pg_catalog.btrim(reason), '');
  existing_role public.app_role;
  current_status public.profile_review_status;
  current_updated_at timestamptz;
  next_updated_at timestamptz;
begin
  perform public.consume_admin_rate_limit(actor_id, 'member.role', 10, 300);

  if target_profile_id is null or next_role is null then
    raise exception 'Target profile and next role are required.' using errcode = '22004';
  end if;
  if expected_updated_at is null then
    raise exception 'Expected profile version is required.' using errcode = '22004';
  end if;
  if normalized_reason is null or char_length(normalized_reason) < 3 then
    raise exception 'Role change reason must contain at least 3 characters.' using errcode = '22023';
  end if;
  if char_length(normalized_reason) > 500 then
    raise exception 'Role change reason exceeds 500 characters.' using errcode = '22001';
  end if;

  -- Serialize all administrator changes so two concurrent demotions cannot remove the last admin.
  perform 1
  from public.profiles
  where role = 'admin'
  order by id
  for update;

  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select profile.role, profile.review_status, profile.updated_at
  into existing_role, current_status, current_updated_at
  from public.profiles
  as profile
  where id = target_profile_id
  for update;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
  if current_status <> 'approved' then
    raise exception 'Only active profiles can change administrator role.' using errcode = '22023';
  end if;
  if current_updated_at is distinct from expected_updated_at then
    raise exception 'Profile changed after it was loaded. Refresh and try again.'
      using errcode = '40001';
  end if;
  if existing_role = next_role then
    return current_updated_at;
  end if;

  if existing_role = 'admin'
    and next_role = 'member'
    and not exists (
      select 1
      from public.profiles
      where id <> target_profile_id
        and role = 'admin'
        and review_status = 'approved'
    ) then
    raise exception 'At least one active administrator must remain.' using errcode = '23514';
  end if;

  update public.profiles
  set role = next_role
  where id = target_profile_id
  returning updated_at into next_updated_at;

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
    'admin_role_change',
    'profiles',
    target_profile_id::text,
    pg_catalog.jsonb_build_object('role', existing_role),
    pg_catalog.jsonb_build_object('role', next_role),
    pg_catalog.jsonb_build_object('reason', normalized_reason)
  );

  return next_updated_at;
end;
$$;

revoke all on function public.admin_list_members() from public, anon, authenticated;
revoke all on function public.admin_set_member_role(
  uuid, public.app_role, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.admin_list_members() to authenticated;
grant execute on function public.admin_set_member_role(
  uuid, public.app_role, timestamptz, text
) to authenticated;

comment on function public.admin_list_members() is
  'Returns active and suspended member or administrator profiles to active administrators.';
comment on function public.admin_set_member_role(uuid, public.app_role, timestamptz, text) is
  'Promotes or demotes an active profile with audit, optimistic locking, rate limiting, and a last-admin guard.';
