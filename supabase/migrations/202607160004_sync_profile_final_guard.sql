-- Serialize profile suspension with final synchronization commits.

create or replace function public.commit_platform_sync_result(
  target_platform_account_id bigint,
  expected_external_id text,
  target_job_id bigint,
  target_run_id bigint,
  sync_succeeded boolean,
  stat_current_rating numeric,
  stat_max_rating numeric,
  stat_solved_count integer,
  stat_status public.stat_freshness_status,
  stat_source_observed_at timestamptz,
  stat_fetched_at timestamptz,
  stat_last_success_at timestamptz,
  stat_stale_after timestamptz,
  stat_error_code public.sync_error_code,
  stat_error_message text,
  stat_source_version text,
  run_finished_at timestamptz,
  run_duration_ms integer,
  run_metrics jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  account_row public.platform_accounts%rowtype;
  target_profile_id uuid;
  profile_status public.profile_review_status;
  affected_rows bigint;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;

  select profile_id into target_profile_id
  from public.platform_accounts
  where id = target_platform_account_id;

  if not found then
    raise exception 'Platform account changed while synchronization was running'
      using errcode = '40001';
  end if;

  select review_status into profile_status
  from public.profiles
  where id = target_profile_id
  for update;

  if not found or profile_status <> 'approved' then
    raise exception 'Member synchronization is no longer allowed'
      using errcode = '40001';
  end if;

  select * into account_row
  from public.platform_accounts
  where id = target_platform_account_id
  for update;

  if not found
    or account_row.profile_id <> target_profile_id
    or account_row.platform = 'luogu'
    or account_row.status <> 'verified'
    or account_row.external_id <> expected_external_id
  then
    raise exception 'Platform account changed while synchronization was running'
      using errcode = '40001';
  end if;

  perform 1
  from public.sync_runs
  where id = target_run_id
    and job_id = target_job_id
    and profile_id = account_row.profile_id
    and platform = account_row.platform
    and platform_account_id = target_platform_account_id
    and status = 'running'
  for update;

  if not found then
    raise exception 'Synchronization run is no longer writable' using errcode = '40001';
  end if;

  insert into public.platform_stats (
    profile_id,
    platform,
    current_rating,
    max_rating,
    solved_count,
    status,
    source_observed_at,
    fetched_at,
    last_success_at,
    stale_after,
    error_code,
    error_message,
    source_version,
    updated_at
  ) values (
    account_row.profile_id,
    account_row.platform,
    stat_current_rating,
    stat_max_rating,
    stat_solved_count,
    stat_status,
    stat_source_observed_at,
    stat_fetched_at,
    stat_last_success_at,
    stat_stale_after,
    stat_error_code,
    left(stat_error_message, 4000),
    stat_source_version,
    run_finished_at
  )
  on conflict (profile_id, platform) do update
  set current_rating = excluded.current_rating,
      max_rating = excluded.max_rating,
      solved_count = excluded.solved_count,
      status = excluded.status,
      source_observed_at = excluded.source_observed_at,
      fetched_at = excluded.fetched_at,
      last_success_at = excluded.last_success_at,
      stale_after = excluded.stale_after,
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      source_version = excluded.source_version,
      updated_at = excluded.updated_at;

  insert into public.stat_snapshots (
    profile_id,
    platform,
    sync_run_id,
    current_rating,
    max_rating,
    solved_count,
    status,
    source_observed_at,
    recorded_at
  ) values (
    account_row.profile_id,
    account_row.platform,
    target_run_id,
    stat_current_rating,
    stat_max_rating,
    stat_solved_count,
    stat_status,
    case when sync_succeeded then stat_source_observed_at else null end,
    run_finished_at
  )
  on conflict (profile_id, platform, source_observed_at) do nothing;

  update public.sync_runs
  set status = (case when sync_succeeded then 'succeeded' else 'failed' end)::public.sync_run_status,
      finished_at = run_finished_at,
      duration_ms = run_duration_ms,
      error_code = stat_error_code,
      error_message = left(stat_error_message, 4000),
      source_version = stat_source_version,
      metrics = run_metrics
  where id = target_run_id
    and status = 'running';

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Synchronization run is no longer writable' using errcode = '40001';
  end if;
end;
$$;

create or replace function public.commit_luogu_sync_result(
  target_platform_account_id bigint,
  expected_external_id text,
  expected_state_version bigint,
  target_job_id bigint,
  target_run_id bigint,
  sync_succeeded boolean,
  stat_current_rating integer,
  stat_max_rating integer,
  stat_solved_count integer,
  stat_status public.stat_freshness_status,
  stat_source_observed_at timestamptz,
  stat_fetched_at timestamptz,
  stat_last_success_at timestamptz,
  stat_stale_after timestamptz,
  stat_error_code public.sync_error_code,
  stat_error_message text,
  stat_source_version text,
  run_finished_at timestamptz,
  run_duration_ms integer,
  run_metrics jsonb,
  state_boundary_record_id text,
  state_boundary_submit_time bigint,
  state_total_records integer,
  state_problem_ids text[],
  state_last_full_sync_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  account_row public.platform_accounts%rowtype;
  target_profile_id uuid;
  profile_status public.profile_review_status;
  current_state_version bigint;
  state_exists boolean;
  next_state_version bigint := expected_state_version;
  affected_rows bigint;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;
  if expected_state_version < 0 then
    raise exception 'expected state version must be nonnegative' using errcode = '22023';
  end if;

  select profile_id into target_profile_id
  from public.platform_accounts
  where id = target_platform_account_id;

  if not found then
    raise exception 'Luogu account changed while synchronization was running'
      using errcode = '40001';
  end if;

  select review_status into profile_status
  from public.profiles
  where id = target_profile_id
  for update;

  if not found or profile_status <> 'approved' then
    raise exception 'Member synchronization is no longer allowed'
      using errcode = '40001';
  end if;

  select * into account_row
  from public.platform_accounts
  where id = target_platform_account_id
  for update;

  if not found
    or account_row.profile_id <> target_profile_id
    or account_row.platform <> 'luogu'
    or account_row.status <> 'verified'
    or account_row.external_id <> expected_external_id
  then
    raise exception 'Luogu account changed while synchronization was running'
      using errcode = '40001';
  end if;

  select state_version
  into current_state_version
  from public.luogu_sync_states
  where platform_account_id = target_platform_account_id
  for update;
  state_exists := found;

  if expected_state_version = 0 then
    if state_exists then
      raise exception 'Luogu synchronization state changed concurrently' using errcode = '40001';
    end if;
  elsif not state_exists or current_state_version <> expected_state_version then
    raise exception 'Luogu synchronization state changed concurrently' using errcode = '40001';
  end if;

  if sync_succeeded then
    next_state_version := expected_state_version + 1;
    insert into public.luogu_sync_states (
      platform_account_id,
      account_external_id,
      state_version,
      boundary_record_id,
      boundary_submit_time,
      total_records,
      problem_ids,
      last_full_sync_at,
      updated_at
    ) values (
      target_platform_account_id,
      expected_external_id,
      next_state_version,
      state_boundary_record_id,
      state_boundary_submit_time,
      state_total_records,
      state_problem_ids,
      state_last_full_sync_at,
      run_finished_at
    )
    on conflict (platform_account_id) do update
    set account_external_id = excluded.account_external_id,
        state_version = excluded.state_version,
        boundary_record_id = excluded.boundary_record_id,
        boundary_submit_time = excluded.boundary_submit_time,
        total_records = excluded.total_records,
        problem_ids = excluded.problem_ids,
        last_full_sync_at = excluded.last_full_sync_at,
        updated_at = excluded.updated_at;
  end if;

  insert into public.platform_stats (
    profile_id,
    platform,
    current_rating,
    max_rating,
    solved_count,
    status,
    source_observed_at,
    fetched_at,
    last_success_at,
    stale_after,
    error_code,
    error_message,
    source_version,
    updated_at
  ) values (
    account_row.profile_id,
    'luogu',
    stat_current_rating,
    stat_max_rating,
    stat_solved_count,
    stat_status,
    stat_source_observed_at,
    stat_fetched_at,
    stat_last_success_at,
    stat_stale_after,
    stat_error_code,
    stat_error_message,
    stat_source_version,
    run_finished_at
  )
  on conflict (profile_id, platform) do update
  set current_rating = excluded.current_rating,
      max_rating = excluded.max_rating,
      solved_count = excluded.solved_count,
      status = excluded.status,
      source_observed_at = excluded.source_observed_at,
      fetched_at = excluded.fetched_at,
      last_success_at = excluded.last_success_at,
      stale_after = excluded.stale_after,
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      source_version = excluded.source_version,
      updated_at = excluded.updated_at;

  insert into public.stat_snapshots (
    profile_id,
    platform,
    sync_run_id,
    current_rating,
    max_rating,
    solved_count,
    status,
    source_observed_at,
    recorded_at
  ) values (
    account_row.profile_id,
    'luogu',
    target_run_id,
    stat_current_rating,
    stat_max_rating,
    stat_solved_count,
    stat_status,
    case when sync_succeeded then stat_source_observed_at else null end,
    run_finished_at
  )
  on conflict (profile_id, platform, source_observed_at) do nothing;

  update public.sync_runs
  set status = (case when sync_succeeded then 'succeeded' else 'failed' end)::public.sync_run_status,
      finished_at = run_finished_at,
      duration_ms = run_duration_ms,
      error_code = stat_error_code,
      error_message = left(stat_error_message, 4000),
      source_version = stat_source_version,
      metrics = run_metrics
  where id = target_run_id
    and job_id = target_job_id
    and profile_id = account_row.profile_id
    and platform = 'luogu'
    and platform_account_id = target_platform_account_id
    and status = 'running';

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Luogu synchronization run is no longer writable' using errcode = '40001';
  end if;

  return next_state_version;
end;
$$;

comment on function public.commit_platform_sync_result(
  bigint, text, bigint, bigint, boolean, numeric, numeric, integer,
  public.stat_freshness_status, timestamptz, timestamptz, timestamptz, timestamptz,
  public.sync_error_code, text, text, timestamptz, integer, jsonb
) is 'Atomically commits a non-Luogu result only while the member remains active.';

comment on function public.commit_luogu_sync_result(
  bigint, text, bigint, bigint, bigint, boolean, integer, integer, integer,
  public.stat_freshness_status, timestamptz, timestamptz, timestamptz, timestamptz,
  public.sync_error_code, text, text, timestamptz, integer, jsonb, text, bigint,
  integer, text[], timestamptz
) is 'Atomically commits a Luogu result only while the member remains active.';
