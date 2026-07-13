-- Admit members immediately after registration while preserving account suspension.

alter table public.profiles
alter column review_status set default 'approved';

alter table public.profiles
alter column approved_at set default now();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    review_status,
    approved_at,
    approved_by
  )
  values (
    new.id,
    'approved',
    now(),
    new.id
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_is_admin boolean := public.is_admin()
    or coalesce((select auth.role()), '') = 'service_role'
    or ((select auth.role()) is null and session_user in ('postgres', 'supabase_admin'));
begin
  if requester_is_admin then
    if new.review_status = 'approved' and old.review_status is distinct from 'approved' then
      new.approved_at := coalesce(new.approved_at, now());
      new.approved_by := coalesce((select auth.uid()), new.approved_by, new.id);
      new.review_note := null;
    elsif new.review_status is distinct from 'approved' then
      new.approved_at := null;
      new.approved_by := null;
    end if;
  else
    if old.review_status = 'suspended' then
      raise exception 'Suspended profiles cannot be modified.';
    end if;

    if new.id is distinct from old.id
      or new.role is distinct from old.role
      or new.review_status is distinct from old.review_status
      or new.review_note is distinct from old.review_note
      or new.approved_at is distinct from old.approved_at
      or new.approved_by is distinct from old.approved_by then
      raise exception 'Managed profile fields can only be changed by an administrator.';
    end if;

    if new.full_name is distinct from old.full_name
      or new.qq is distinct from old.qq
      or new.major is distinct from old.major
      or new.grade is distinct from old.grade
      or new.review_requested_at is distinct from old.review_requested_at then
      new.review_note := null;
      new.review_requested_at := now();
    end if;
  end if;

  return new;
end;
$$;

-- Pending and rejected states no longer have a product meaning. Suspended accounts stay suspended.
alter table public.profiles disable trigger profiles_protect_fields;

update public.profiles
set
  review_status = 'approved',
  review_note = null,
  approved_at = coalesce(approved_at, now()),
  approved_by = coalesce(approved_by, id)
where review_status in ('pending', 'rejected');

alter table public.profiles enable trigger profiles_protect_fields;

create or replace view public.public_members
with (security_barrier = true)
as
select id, full_name, major, created_at, updated_at, grade
from public.profiles
where review_status = 'approved'
  and is_public
  and full_name is not null
  and major is not null
  and grade is not null;

create or replace view public.public_platform_accounts
with (security_barrier = true)
as
select a.profile_id, a.platform, a.external_id, a.verified_at
from public.platform_accounts as a
join public.profiles as p on p.id = a.profile_id
where p.review_status = 'approved'
  and p.is_public
  and p.full_name is not null
  and p.major is not null
  and p.grade is not null
  and a.status = 'verified';

create or replace view public.public_platform_stats
with (security_barrier = true)
as
select
  s.profile_id,
  s.platform,
  s.current_rating,
  s.max_rating,
  s.solved_count,
  s.status,
  s.source_observed_at,
  s.fetched_at,
  s.last_success_at,
  s.stale_after,
  s.error_code,
  s.source_version,
  s.updated_at
from public.platform_stats as s
join public.profiles as p on p.id = s.profile_id
join public.platform_accounts as a
  on a.profile_id = s.profile_id and a.platform = s.platform
where p.review_status = 'approved'
  and p.is_public
  and p.full_name is not null
  and p.major is not null
  and p.grade is not null
  and a.status = 'verified';

create or replace view public.public_stat_snapshots
with (security_barrier = true)
as
select
  s.id,
  s.profile_id,
  s.platform,
  s.current_rating,
  s.max_rating,
  s.solved_count,
  s.status,
  s.source_observed_at,
  s.recorded_at
from public.stat_snapshots as s
join public.profiles as p on p.id = s.profile_id
join public.platform_accounts as a
  on a.profile_id = s.profile_id and a.platform = s.platform
where p.review_status = 'approved'
  and p.is_public
  and p.full_name is not null
  and p.major is not null
  and p.grade is not null
  and a.status = 'verified';

drop function if exists public.admin_list_review_members();
drop function if exists public.admin_set_member_review_status(
  uuid,
  public.profile_review_status,
  text
);
drop function if exists public.admin_set_member_review_status(
  uuid,
  public.profile_review_status,
  timestamptz,
  text
);

comment on function public.handle_new_user() is
  'Creates an immediately admitted member profile for every new Auth user.';
comment on view public.public_members is
  'Public fields for active members with complete ranking identity data; excludes QQ and internal state.';
