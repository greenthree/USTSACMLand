-- Allow Supabase Auth's internal database role to clear managed profile
-- references while deleting an Auth user. Browser and API roles remain subject
-- to the existing administrator-only field boundary.

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_is_admin boolean := public.is_admin()
    or coalesce((select auth.role()), '') = 'service_role'
    or (
      (select auth.role()) is null
      and session_user in ('postgres', 'supabase_admin', 'supabase_auth_admin')
    );
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

comment on function public.protect_profile_fields() is
  'Protects administrator-managed profile fields while allowing Supabase Auth to clear deletion references.';
