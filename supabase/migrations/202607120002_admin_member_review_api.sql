-- Administrator-only member review API and first-admin bootstrap.

create or replace function public.admin_list_review_members()
returns table (
  id uuid,
  email text,
  full_name text,
  major text,
  qq text,
  review_status public.profile_review_status,
  review_note text,
  review_requested_at timestamptz,
  platform_count bigint
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
    p.qq,
    p.review_status,
    p.review_note,
    p.review_requested_at,
    count(a.id)::bigint
  from public.profiles as p
  join auth.users as u on u.id = p.id
  left join public.platform_accounts as a on a.profile_id = p.id
  where p.role = 'member'
  group by p.id, u.email
  order by
    case p.review_status
      when 'pending' then 0
      when 'rejected' then 1
      when 'suspended' then 2
      when 'approved' then 3
    end,
    p.review_requested_at desc;
end;
$$;

create or replace function public.admin_set_member_review_status(
  target_profile_id uuid,
  next_status public.profile_review_status,
  note text default null
)
returns public.profile_review_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_note text := nullif(btrim(note), '');
  target_role public.app_role;
  current_status public.profile_review_status;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if target_profile_id is null then
    raise exception 'Target profile is required.' using errcode = '22004';
  end if;

  if next_status is null then
    raise exception 'Target review status is required.' using errcode = '22004';
  end if;

  if normalized_note is not null and char_length(normalized_note) > 1000 then
    raise exception 'Review note exceeds 1000 characters.' using errcode = '22001';
  end if;

  update public.profiles
  set
    review_status = next_status,
    review_note = case when next_status = 'rejected' then normalized_note else null end
  where id = target_profile_id
    and role = 'member'
    and (
      (review_status = 'pending' and next_status in ('approved', 'rejected', 'suspended'))
      or (review_status = 'approved' and next_status = 'suspended')
      or (review_status = 'rejected' and next_status in ('approved', 'pending'))
      or (review_status = 'suspended' and next_status = 'pending')
    )
  returning role into target_role;

  if not found then
    select role, review_status
    into target_role, current_status
    from public.profiles
    where id = target_profile_id;

    if not found then
      raise exception 'Profile not found.' using errcode = 'P0002';
    end if;

    if target_role <> 'member' then
      raise exception 'Administrator profiles cannot be changed by the member review API.'
        using errcode = '42501';
    end if;

    raise exception 'Review status transition from % to % is not allowed.', current_status, next_status
      using errcode = '22023';
  end if;

  return next_status;
end;
$$;

create or replace function public.bootstrap_first_admin(target_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
begin
  if coalesce((select auth.role()), '') <> 'service_role'
    and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Service-role or SQL administrator access required.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.bootstrap_first_admin', 0)
  );

  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'An administrator already exists.' using errcode = '23505';
  end if;

  select id
  into target_user_id
  from auth.users
  where lower(email) = lower(btrim(target_email))
  limit 1;

  if target_user_id is null then
    raise exception 'Auth user not found.' using errcode = 'P0002';
  end if;

  update public.profiles
  set
    role = 'admin',
    review_status = 'approved',
    review_note = null
  where id = target_user_id;

  if not found then
    raise exception 'Profile not found for auth user.' using errcode = 'P0002';
  end if;

  return target_user_id;
end;
$$;

revoke all on function public.admin_list_review_members() from public, anon, authenticated;
revoke all on function public.admin_set_member_review_status(uuid, public.profile_review_status, text)
  from public, anon, authenticated;
revoke all on function public.bootstrap_first_admin(text) from public, anon, authenticated;

grant execute on function public.admin_list_review_members() to authenticated;
grant execute on function public.admin_set_member_review_status(uuid, public.profile_review_status, text)
  to authenticated;
grant execute on function public.bootstrap_first_admin(text) to service_role;

comment on function public.admin_list_review_members() is
  'Returns private member review data only after an explicit approved-admin check.';
comment on function public.admin_set_member_review_status(uuid, public.profile_review_status, text) is
  'Changes a member review state through the existing profile protection and audit triggers.';
comment on function public.bootstrap_first_admin(text) is
  'One-time first-admin bootstrap. Callable only by service_role or a Supabase SQL administrator.';
