-- Make the status transition enum types explicit for PostgreSQL's function linter.

create or replace function public.admin_set_member_suspension(
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
  next_status public.profile_review_status := case
    when suspended then 'suspended'::public.profile_review_status
    else 'approved'::public.profile_review_status
  end;
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
