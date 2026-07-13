-- Read-only administrator operations APIs and tighter write boundaries.

create index if not exists sync_runs_platform_started_idx
  on public.sync_runs (platform, started_at desc);
create index if not exists sync_jobs_failed_created_idx
  on public.sync_jobs (created_at desc)
  where status = 'failed';

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_select on public.profiles
for select to authenticated
using ((select public.is_admin()));

drop policy if exists platform_accounts_admin_all on public.platform_accounts;
create policy platform_accounts_admin_select on public.platform_accounts
for select to authenticated
using ((select public.is_admin()));

drop policy if exists platform_stats_admin_all on public.platform_stats;
create policy platform_stats_admin_select on public.platform_stats
for select to authenticated
using ((select public.is_admin()));

drop policy if exists stat_snapshots_admin_all on public.stat_snapshots;
create policy stat_snapshots_admin_select on public.stat_snapshots
for select to authenticated
using ((select public.is_admin()));

drop policy if exists sync_jobs_admin_all on public.sync_jobs;
create policy sync_jobs_admin_select on public.sync_jobs
for select to authenticated
using ((select public.is_admin()));

drop policy if exists sync_runs_admin_all on public.sync_runs;
create policy sync_runs_admin_select on public.sync_runs
for select to authenticated
using ((select public.is_admin()));

drop policy if exists audit_logs_admin_select on public.audit_logs;

revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, qq, major, is_public) on public.profiles to authenticated;
revoke insert, update, delete on public.platform_stats from authenticated;
revoke insert, update, delete on public.stat_snapshots from authenticated;
revoke insert, update, delete on public.sync_jobs from authenticated;
revoke insert, update, delete on public.sync_runs from authenticated;
revoke select on public.audit_logs from authenticated;
revoke all on sequence public.sync_jobs_id_seq from authenticated;
revoke all on sequence public.sync_runs_id_seq from authenticated;
revoke all on sequence public.stat_snapshots_id_seq from authenticated;

create or replace function public.write_sync_job_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requested_by is not null then
    insert into public.audit_logs (
      actor_id,
      action,
      target_table,
      target_id,
      metadata
    ) values (
      new.requested_by,
      'sync_requested',
      'sync_jobs',
      new.id::text,
      pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'scope', new.scope,
          'profile_id', new.profile_id,
          'platform', new.platform,
          'platforms', new.payload -> 'platforms',
          'trigger_type', new.trigger_type
        )
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists sync_jobs_audit on public.sync_jobs;
create trigger sync_jobs_audit
after insert on public.sync_jobs
for each row execute function public.write_sync_job_audit();

drop function if exists public.admin_list_review_members();
create function public.admin_list_review_members()
returns table (
  id uuid,
  email text,
  full_name text,
  major text,
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

drop function if exists public.admin_set_member_review_status(
  uuid,
  public.profile_review_status,
  text
);
create function public.admin_set_member_review_status(
  target_profile_id uuid,
  next_status public.profile_review_status,
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
  next_updated_at timestamptz;
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

  if expected_updated_at is null then
    raise exception 'Expected profile version is required.' using errcode = '22004';
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
    and updated_at = expected_updated_at
    and (
      (review_status = 'pending' and next_status in ('approved', 'rejected', 'suspended'))
      or (review_status = 'approved' and next_status = 'suspended')
      or (review_status = 'rejected' and next_status in ('approved', 'pending'))
      or (review_status = 'suspended' and next_status = 'pending')
    )
  returning updated_at into next_updated_at;

  if not found then
    select role, review_status, updated_at
    into target_role, current_status, current_updated_at
    from public.profiles
    where id = target_profile_id;

    if not found then
      raise exception 'Profile not found.' using errcode = 'P0002';
    end if;

    if target_role <> 'member' then
      raise exception 'Administrator profiles cannot be changed by the member review API.'
        using errcode = '42501';
    end if;

    if current_updated_at is distinct from expected_updated_at then
      raise exception 'Profile changed after it was loaded. Refresh and review again.'
        using errcode = '40001';
    end if;

    raise exception 'Review status transition from % to % is not allowed.', current_status, next_status
      using errcode = '22023';
  end if;

  return next_updated_at;
end;
$$;

create or replace function public.admin_get_overview()
returns table (
  approved_member_count bigint,
  pending_member_count bigint,
  failed_job_count_24h bigint,
  running_job_count bigint,
  overdue_stat_count bigint,
  credential_error_count bigint,
  verified_account_count bigint
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
    (
      select count(*)
      from public.profiles
      where role = 'member' and review_status = 'approved'
    )::bigint,
    (
      select count(*)
      from public.profiles
      where role = 'member' and review_status = 'pending'
    )::bigint,
    (
      select count(*)
      from public.sync_jobs
      where status = 'failed'
        and created_at >= now() - interval '24 hours'
    )::bigint,
    (select count(*) from public.sync_jobs where status = 'running')::bigint,
    (
      select count(*)
      from public.platform_accounts as a
      join public.profiles as p on p.id = a.profile_id
      left join public.platform_stats as s
        on s.profile_id = a.profile_id and s.platform = a.platform
      where a.status = 'verified'
        and p.review_status = 'approved'
        and (
          s.profile_id is null
          or s.status in ('stale', 'unavailable')
          or (s.status = 'fresh' and s.stale_after is not null and s.stale_after <= now())
        )
    )::bigint,
    (
      select count(*)
      from public.platform_stats as s
      join public.platform_accounts as a
        on a.profile_id = s.profile_id and a.platform = s.platform
      join public.profiles as p on p.id = s.profile_id
      where a.status = 'verified'
        and p.review_status = 'approved'
        and s.error_code in ('auth_required', 'auth_expired', 'not_configured')
    )::bigint,
    (
      select count(*)
      from public.platform_accounts as a
      join public.profiles as p on p.id = a.profile_id
      where a.status = 'verified' and p.review_status = 'approved'
    )::bigint;
end;
$$;

create or replace function public.admin_list_sync_runs(
  row_limit integer default 50,
  before_run_id bigint default null
)
returns table (
  run_id bigint,
  job_id bigint,
  profile_id uuid,
  member_name text,
  platform public.platform_name,
  run_status public.sync_run_status,
  job_status public.sync_job_status,
  trigger_type public.sync_trigger_type,
  requested_by uuid,
  duration_ms integer,
  started_at timestamptz,
  finished_at timestamptz,
  error_code public.sync_error_code,
  error_message text,
  source_version text
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
    r.id,
    r.job_id,
    r.profile_id,
    p.full_name,
    r.platform,
    r.status,
    j.status,
    j.trigger_type,
    j.requested_by,
    r.duration_ms,
    r.started_at,
    r.finished_at,
    r.error_code,
    r.error_message,
    r.source_version
  from public.sync_runs as r
  join public.sync_jobs as j on j.id = r.job_id
  join public.profiles as p on p.id = r.profile_id
  where before_run_id is null or r.id < before_run_id
  order by r.id desc
  limit safe_limit;
end;
$$;

create or replace function public.admin_get_source_health(lookback_hours integer default 168)
returns table (
  platform public.platform_name,
  total_runs bigint,
  succeeded_runs bigint,
  failed_runs bigint,
  success_rate numeric,
  average_duration_ms numeric,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  latest_error_code public.sync_error_code
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_hours integer := least(greatest(coalesce(lookback_hours, 168), 1), 720);
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select
    r.platform,
    count(*) filter (where r.status in ('succeeded', 'failed'))::bigint,
    count(*) filter (where r.status = 'succeeded')::bigint,
    count(*) filter (where r.status = 'failed')::bigint,
    round(
      100.0 * count(*) filter (where r.status = 'succeeded')
        / nullif(count(*) filter (where r.status in ('succeeded', 'failed')), 0),
      1
    ),
    round(avg(r.duration_ms) filter (where r.status in ('succeeded', 'failed')), 0),
    max(r.finished_at) filter (where r.status = 'succeeded'),
    max(r.finished_at) filter (where r.status = 'failed'),
    (
      select failed.error_code
      from public.sync_runs as failed
      where failed.platform = r.platform
        and failed.status = 'failed'
        and failed.started_at >= now() - make_interval(hours => safe_hours)
      order by failed.id desc
      limit 1
    )
  from public.sync_runs as r
  where r.started_at >= now() - make_interval(hours => safe_hours)
  group by r.platform
  order by r.platform;
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

revoke all on function public.write_sync_job_audit() from public, anon, authenticated;
revoke all on function public.admin_list_review_members() from public, anon, authenticated;
revoke all on function public.admin_set_member_review_status(
  uuid,
  public.profile_review_status,
  timestamptz,
  text
) from public, anon, authenticated;
revoke all on function public.admin_get_overview() from public, anon, authenticated;
revoke all on function public.admin_list_sync_runs(integer, bigint) from public, anon, authenticated;
revoke all on function public.admin_get_source_health(integer) from public, anon, authenticated;
revoke all on function public.admin_list_audit_logs(integer, bigint) from public, anon, authenticated;

grant execute on function public.admin_list_review_members() to authenticated;
grant execute on function public.admin_set_member_review_status(
  uuid,
  public.profile_review_status,
  timestamptz,
  text
) to authenticated;
grant execute on function public.admin_get_overview() to authenticated;
grant execute on function public.admin_list_sync_runs(integer, bigint) to authenticated;
grant execute on function public.admin_get_source_health(integer) to authenticated;
grant execute on function public.admin_list_audit_logs(integer, bigint) to authenticated;

comment on function public.admin_get_overview() is
  'Returns administrator dashboard counters after an explicit approved-admin check.';
comment on function public.admin_list_sync_runs(integer, bigint) is
  'Returns cursor-paginated synchronization runs for approved administrators.';
comment on function public.admin_get_source_health(integer) is
  'Returns recent per-platform synchronization health for approved administrators.';
comment on function public.admin_list_audit_logs(integer, bigint) is
  'Returns a sanitized audit projection without raw profile or account values.';
