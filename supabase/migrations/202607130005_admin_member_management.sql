-- Administrator member directory and active/suspended account controls.

create function public.admin_list_members()
returns table (
  id uuid,
  email text,
  full_name text,
  major text,
  grade text,
  qq text,
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
    p.id,
    u.email::text,
    p.full_name,
    p.major,
    p.grade,
    p.qq,
    p.review_status,
    case when p.review_status = 'suspended' then p.review_note else null end,
    p.is_public,
    p.created_at,
    p.updated_at,
    count(a.id)::bigint,
    count(a.id) filter (where a.status = 'verified')
  from public.profiles as p
  join auth.users as u on u.id = p.id
  left join public.platform_accounts as a on a.profile_id = p.id
  where p.role = 'member'
    and p.review_status in ('approved', 'suspended')
  group by p.id, u.email
  order by
    case p.review_status when 'suspended' then 0 else 1 end,
    p.created_at desc;
end;
$$;

create function public.admin_set_member_suspension(
  target_profile_id uuid,
  suspended boolean,
  expected_updated_at timestamptz,
  note text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_note text := nullif(btrim(note), '');
  target_role public.app_role;
  current_status public.profile_review_status;
  current_updated_at timestamptz;
  next_status public.profile_review_status := case when suspended then 'suspended' else 'approved' end;
  next_updated_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if target_profile_id is null then
    raise exception 'Target profile is required.' using errcode = '22004';
  end if;

  if suspended is null then
    raise exception 'Suspension state is required.' using errcode = '22004';
  end if;

  if target_profile_id = (select auth.uid()) then
    raise exception 'Administrators cannot change their own status through member management.'
      using errcode = '42501';
  end if;

  if expected_updated_at is null then
    raise exception 'Expected profile version is required.' using errcode = '22004';
  end if;

  if normalized_note is not null and char_length(normalized_note) > 1000 then
    raise exception 'Suspension note exceeds 1000 characters.' using errcode = '22001';
  end if;

  select role, review_status, updated_at
  into target_role, current_status, current_updated_at
  from public.profiles
  where id = target_profile_id
  for update;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  if target_role <> 'member' then
    raise exception 'Administrator profiles cannot be changed through member management.'
      using errcode = '42501';
  end if;

  if current_status not in ('approved', 'suspended') then
    raise exception 'Member status % is not supported by member management.', current_status
      using errcode = '22023';
  end if;

  if current_updated_at is distinct from expected_updated_at then
    raise exception 'Profile changed after it was loaded. Refresh and try again.'
      using errcode = '40001';
  end if;

  if current_status = next_status then
    return current_updated_at;
  end if;

  update public.profiles
  set
    review_status = next_status,
    review_note = case when suspended then normalized_note else null end
  where id = target_profile_id
  returning updated_at into next_updated_at;

  return next_updated_at;
end;
$$;

revoke all on function public.admin_list_members() from public, anon, authenticated;
revoke all on function public.admin_set_member_suspension(uuid, boolean, timestamptz, text)
from public, anon, authenticated;

grant execute on function public.admin_list_members() to authenticated;
grant execute on function public.admin_set_member_suspension(uuid, boolean, timestamptz, text)
to authenticated;

comment on function public.admin_list_members() is
  'Returns private member directory data to active administrators only.';
comment on function public.admin_set_member_suspension(uuid, boolean, timestamptz, text) is
  'Suspends or restores a non-admin member with row locking and optimistic concurrency.';
