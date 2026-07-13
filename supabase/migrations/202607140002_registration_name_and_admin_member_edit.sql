-- Require a registration name and let administrators edit member profile fields.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_full_name text := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
begin
  if normalized_full_name is null then
    raise exception 'A full name is required during registration.' using errcode = '23514';
  end if;

  if char_length(normalized_full_name) > 64 then
    raise exception 'Full name exceeds 64 characters.' using errcode = '22001';
  end if;

  insert into public.profiles (
    id,
    full_name,
    review_status,
    approved_at,
    approved_by
  )
  values (
    new.id,
    normalized_full_name,
    'approved',
    now(),
    new.id
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create function public.admin_update_member_profile(
  target_profile_id uuid,
  member_full_name text,
  member_qq text,
  member_grade text,
  member_major text,
  member_is_public boolean,
  expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_full_name text := nullif(btrim(member_full_name), '');
  normalized_qq text := nullif(btrim(member_qq), '');
  normalized_grade text := nullif(btrim(member_grade), '');
  normalized_major text := nullif(btrim(member_major), '');
  target_role public.app_role;
  target_status public.profile_review_status;
  current_updated_at timestamptz;
  current_full_name text;
  current_qq text;
  current_grade text;
  current_major text;
  current_is_public boolean;
  next_updated_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if target_profile_id is null then
    raise exception 'Target profile is required.' using errcode = '22004';
  end if;

  if expected_updated_at is null then
    raise exception 'Expected profile version is required.' using errcode = '22004';
  end if;

  if normalized_full_name is null or char_length(normalized_full_name) > 64 then
    raise exception 'Full name must contain between 1 and 64 characters.' using errcode = '22023';
  end if;

  if normalized_qq is null or normalized_qq !~ '^[1-9][0-9]{4,11}$' then
    raise exception 'QQ must contain between 5 and 12 digits and cannot start with zero.'
      using errcode = '22023';
  end if;

  if normalized_grade is null or normalized_grade !~ '^[0-9]{2}级$' then
    raise exception 'Grade must use the two-digit format, for example 24级.'
      using errcode = '22023';
  end if;

  if normalized_major is null or char_length(normalized_major) > 100 then
    raise exception 'Major must contain between 1 and 100 characters.' using errcode = '22023';
  end if;

  if member_is_public is null then
    raise exception 'Public visibility is required.' using errcode = '22004';
  end if;

  select
    role,
    review_status,
    updated_at,
    full_name,
    qq,
    grade,
    major,
    is_public
  into
    target_role,
    target_status,
    current_updated_at,
    current_full_name,
    current_qq,
    current_grade,
    current_major,
    current_is_public
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

  if target_status not in ('approved', 'suspended') then
    raise exception 'Member status % is not supported by member management.', target_status
      using errcode = '22023';
  end if;

  if current_updated_at is distinct from expected_updated_at then
    raise exception 'Profile changed after it was loaded. Refresh and try again.'
      using errcode = '40001';
  end if;

  if current_full_name is not distinct from normalized_full_name
    and current_qq is not distinct from normalized_qq
    and current_grade is not distinct from normalized_grade
    and current_major is not distinct from normalized_major
    and current_is_public is not distinct from member_is_public then
    return current_updated_at;
  end if;

  update public.profiles
  set
    full_name = normalized_full_name,
    qq = normalized_qq,
    grade = normalized_grade,
    major = normalized_major,
    is_public = member_is_public
  where id = target_profile_id
  returning updated_at into next_updated_at;

  return next_updated_at;
end;
$$;

revoke all on function public.admin_update_member_profile(
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.admin_update_member_profile(
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  timestamptz
) to authenticated;

comment on function public.admin_update_member_profile(
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  timestamptz
) is 'Updates editable member profile fields with administrator authorization and optimistic locking.';
