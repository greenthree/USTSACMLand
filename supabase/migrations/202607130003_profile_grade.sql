-- Add member grade to profile review, public ranking, and administrator read models.

alter table public.profiles
add column if not exists grade text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_grade_valid'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
    add constraint profiles_grade_valid check (
      grade is null or grade ~ '^[0-9]{2}级$'
    );
  end if;
end;
$$;

comment on column public.profiles.grade is
  'Two-digit enrollment grade followed by 级, for example 23级; null until supplied.';

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
      if new.full_name is null or new.qq is null or new.major is null or new.grade is null then
        raise exception 'A profile must contain full_name, qq, major, and grade before approval.';
      end if;
      new.approved_at := now();
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
      new.review_status := 'pending';
      new.review_note := null;
      new.review_requested_at := now();
      new.approved_at := null;
      new.approved_by := null;
    end if;
  end if;

  return new;
end;
$$;

grant update (grade) on public.profiles to authenticated;

create or replace view public.public_members
with (security_barrier = true)
as
select id, full_name, major, created_at, updated_at, grade
from public.profiles
where review_status = 'approved' and is_public;

grant select on public.public_members to anon, authenticated;

comment on view public.public_members is
  'Approved public member fields, including grade; deliberately excludes QQ and review metadata.';

drop function if exists public.admin_list_review_members();
create function public.admin_list_review_members()
returns table (
  id uuid,
  email text,
  full_name text,
  major text,
  grade text,
  qq text,
  review_status public.profile_review_status,
  review_note text,
  review_requested_at timestamptz,
  updated_at timestamptz,
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
    p.grade,
    p.qq,
    p.review_status,
    p.review_note,
    p.review_requested_at,
    p.updated_at,
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

create or replace function public.admin_list_audit_logs(
  row_limit integer default 50,
  before_log_id bigint default null
)
returns table (
  id bigint,
  actor_id uuid,
  actor_label text,
  action text,
  target_table text,
  target_id text,
  target_label text,
  details jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(row_limit, 50), 1), 100);
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select
    log.id,
    log.actor_id,
    coalesce(actor_profile.full_name, actor_user.email::text),
    log.action,
    log.target_table,
    log.target_id,
    coalesce(
      target_profile.full_name,
      log.after_data ->> 'title',
      log.before_data ->> 'title',
      log.target_id
    ),
    case log.target_table
      when 'profiles' then pg_catalog.jsonb_build_object(
        'before_role', log.before_data ->> 'role',
        'after_role', log.after_data ->> 'role',
        'before_review_status', log.before_data ->> 'review_status',
        'after_review_status', log.after_data ->> 'review_status',
        'profile_fields', to_jsonb(array_remove(array[
          case when log.before_data ->> 'full_name' is distinct from log.after_data ->> 'full_name' then 'full_name' end,
          case when log.before_data ->> 'qq' is distinct from log.after_data ->> 'qq' then 'qq' end,
          case when log.before_data ->> 'major' is distinct from log.after_data ->> 'major' then 'major' end,
          case when log.before_data ->> 'grade' is distinct from log.after_data ->> 'grade' then 'grade' end,
          case when log.before_data ->> 'is_public' is distinct from log.after_data ->> 'is_public' then 'is_public' end
        ]::text[], null))
      )
      when 'platform_accounts' then pg_catalog.jsonb_build_object(
        'platform', coalesce(log.after_data ->> 'platform', log.before_data ->> 'platform'),
        'before_status', log.before_data ->> 'status',
        'after_status', log.after_data ->> 'status',
        'external_id_changed',
          log.action = 'update'
          and log.before_data ->> 'external_id' is distinct from log.after_data ->> 'external_id'
      )
      when 'sync_jobs' then pg_catalog.jsonb_build_object(
        'scope', log.metadata ->> 'scope',
        'platform', log.metadata ->> 'platform',
        'trigger_type', log.metadata ->> 'trigger_type',
        'platform_count', case
          when pg_catalog.jsonb_typeof(log.metadata -> 'platforms') = 'array'
            then pg_catalog.jsonb_array_length(log.metadata -> 'platforms')
          else null
        end
      )
      else '{}'::jsonb
    end,
    log.created_at
  from public.audit_logs as log
  left join auth.users as actor_user on actor_user.id = log.actor_id
  left join public.profiles as actor_profile on actor_profile.id = log.actor_id
  left join public.profiles as target_profile
    on target_profile.id::text = coalesce(
      case when log.target_table = 'profiles' then log.target_id end,
      log.after_data ->> 'profile_id',
      log.before_data ->> 'profile_id',
      log.metadata ->> 'profile_id'
    )
  where before_log_id is null or log.id < before_log_id
  order by log.id desc
  limit safe_limit;
end;
$$;

revoke all on function public.admin_list_review_members() from public, anon, authenticated;
revoke all on function public.admin_list_audit_logs(integer, bigint) from public, anon, authenticated;

grant execute on function public.admin_list_review_members() to authenticated;
grant execute on function public.admin_list_audit_logs(integer, bigint) to authenticated;

comment on function public.admin_list_review_members() is
  'Returns private member review data, including grade, only after an explicit approved-admin check.';
comment on function public.admin_list_audit_logs(integer, bigint) is
  'Returns a sanitized audit projection without raw profile or account values.';
