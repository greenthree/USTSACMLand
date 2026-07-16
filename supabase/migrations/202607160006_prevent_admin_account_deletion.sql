-- Enforce administrator handoff at the final profile-deletion boundary so a
-- role promotion racing with self-service account deletion fails closed.

create or replace function public.prevent_profile_delete_with_active_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'::public.app_role then
    raise exception 'Administrator profiles must be demoted before account deletion.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.sync_jobs as job
    where job.profile_id = old.id
      and job.status in ('queued', 'running')
  ) then
    raise exception 'Account synchronization is active.' using errcode = '55006';
  end if;

  return old;
end;
$$;

revoke all on function public.prevent_profile_delete_with_active_sync() from public;

comment on function public.prevent_profile_delete_with_active_sync() is
  'Final profile-deletion guard: rejects administrators and profiles with queued or running synchronization.';
