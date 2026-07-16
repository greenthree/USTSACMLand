-- Expose active synchronization queue progress through a bounded,
-- cursor-paginated administrator projection.

create index if not exists sync_jobs_active_admin_list_idx
  on public.sync_jobs (id desc)
  where status in ('queued', 'running');

create or replace function public.admin_list_active_sync_jobs(
  row_limit integer default 50,
  before_job_id bigint default null
)
returns table (
  job_id bigint,
  profile_id uuid,
  member_name text,
  scope public.sync_job_scope,
  platform public.platform_name,
  status public.sync_job_status,
  trigger_type public.sync_trigger_type,
  attempt_count smallint,
  max_attempts smallint,
  scheduled_for timestamptz,
  started_at timestamptz,
  created_at timestamptz,
  last_error_code public.sync_error_code
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
    job.id,
    job.profile_id,
    profile.full_name,
    job.scope,
    job.platform,
    job.status,
    job.trigger_type,
    job.attempt_count,
    job.max_attempts,
    job.scheduled_for,
    job.started_at,
    job.created_at,
    job.last_error_code
  from public.sync_jobs as job
  left join public.profiles as profile on profile.id = job.profile_id
  where job.status in ('queued', 'running')
    and (before_job_id is null or job.id < before_job_id)
  order by job.id desc
  limit safe_limit;
end;
$$;

revoke all on function public.admin_list_active_sync_jobs(integer, bigint)
  from public, anon, authenticated;
grant execute on function public.admin_list_active_sync_jobs(integer, bigint)
  to authenticated;

comment on function public.admin_list_active_sync_jobs(integer, bigint) is
  'Returns cursor-paginated queued and running synchronization jobs for approved administrators.';
