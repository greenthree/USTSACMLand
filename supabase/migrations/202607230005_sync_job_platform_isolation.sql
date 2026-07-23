-- Allow independent platform jobs for one member while keeping member-wide
-- jobs exclusive. The deferred constraint trigger serializes transaction
-- commits per member, so hierarchy checks remain correct under concurrency.

update public.sync_jobs
set dedupe_key = case scope
  when 'account'::public.sync_job_scope then
    'member:' || profile_id::text || ':platform:' || platform::text
  when 'member'::public.sync_job_scope then
    'member:' || profile_id::text
  else dedupe_key
end
where scope in (
    'account'::public.sync_job_scope,
    'member'::public.sync_job_scope
  )
  and profile_id is not null
  and (
    (scope = 'account'::public.sync_job_scope and platform is not null)
    or scope = 'member'::public.sync_job_scope
  );

create or replace function private.enforce_sync_job_platform_isolation()
returns trigger
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  locked_profile_id uuid;
  old_profile_to_lock uuid;
  new_profile_to_lock uuid;
  current_job public.sync_jobs%rowtype;
  conflicting_job_id bigint;
begin
  -- Lock both profiles in a stable order if a row is ever retargeted. Normal
  -- queue operations lock only one member, and no external work occurs here.
  if tg_op <> 'INSERT'
    and old.scope in (
      'account'::public.sync_job_scope,
      'member'::public.sync_job_scope
    )
    and old.profile_id is not null
    and old.status in (
      'queued'::public.sync_job_status,
      'running'::public.sync_job_status
    ) then
    old_profile_to_lock := old.profile_id;
  end if;

  if tg_op <> 'DELETE'
    and new.scope in (
      'account'::public.sync_job_scope,
      'member'::public.sync_job_scope
    )
    and new.profile_id is not null
    and new.status in (
      'queued'::public.sync_job_status,
      'running'::public.sync_job_status
    ) then
    new_profile_to_lock := new.profile_id;
  end if;

  for locked_profile_id in
    select distinct affected.profile_id
    from pg_catalog.unnest(array[old_profile_to_lock, new_profile_to_lock])
      as affected(profile_id)
    where affected.profile_id is not null
    order by affected.profile_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'public.sync_jobs:profile:' || locked_profile_id::text,
        0
      )
    );
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- A deferred event may observe a later state of the same row. Validate the
  -- state that will actually commit rather than the event's earlier NEW image.
  select job.*
  into current_job
  from public.sync_jobs as job
  where job.id = new.id;

  if not found
    or current_job.profile_id is null
    or current_job.scope not in (
      'account'::public.sync_job_scope,
      'member'::public.sync_job_scope
    )
    or current_job.status not in (
      'queued'::public.sync_job_status,
      'running'::public.sync_job_status
    ) then
    return new;
  end if;

  select job.id
  into conflicting_job_id
  from public.sync_jobs as job
  where job.id <> current_job.id
    and job.profile_id = current_job.profile_id
    and job.status in (
      'queued'::public.sync_job_status,
      'running'::public.sync_job_status
    )
    and (
      current_job.scope = 'member'::public.sync_job_scope
      or job.scope = 'member'::public.sync_job_scope
      or (
        current_job.scope = 'account'::public.sync_job_scope
        and job.scope = 'account'::public.sync_job_scope
        and job.platform = current_job.platform
      )
    )
  order by job.id
  limit 1;

  if conflicting_job_id is not null then
    raise exception using
      errcode = '23505',
      message = 'An active synchronization job already exists for this member scope or platform.',
      constraint = 'sync_jobs_active_platform_isolation';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_sync_job_platform_isolation()
  from public, anon, authenticated, service_role;

drop trigger if exists sync_jobs_platform_isolation on public.sync_jobs;
create constraint trigger sync_jobs_platform_isolation
after insert or update or delete on public.sync_jobs
deferrable initially deferred
for each row execute function private.enforce_sync_job_platform_isolation();

comment on function private.enforce_sync_job_platform_isolation() is
  'Serializes active synchronization job hierarchy checks per member at transaction commit.';

comment on trigger sync_jobs_platform_isolation on public.sync_jobs is
  'Allows active account jobs on different platforms, rejects same-platform duplicates, and makes active member jobs exclusive with every account job for that member.';
