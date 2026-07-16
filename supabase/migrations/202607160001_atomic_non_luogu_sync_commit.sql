-- Commit non-Luogu synchronization results atomically and preserve XCPC ELO decimals.

drop view if exists public.public_platform_stats;
drop view if exists public.public_stat_snapshots;
drop function if exists public.admin_get_member_detail(uuid);

alter table public.platform_stats
  alter column current_rating type numeric(12, 2) using current_rating::numeric,
  alter column max_rating type numeric(12, 2) using max_rating::numeric;

alter table public.stat_snapshots
  alter column current_rating type numeric(12, 2) using current_rating::numeric,
  alter column max_rating type numeric(12, 2) using max_rating::numeric;

alter table public.xcpc_elo_cache_players
  alter column rating type numeric(12, 2) using rating::numeric,
  alter column max_rating type numeric(12, 2) using max_rating::numeric;

create view public.public_platform_stats
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

create view public.public_stat_snapshots
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

grant select on public.public_platform_stats to anon, authenticated;
grant select on public.public_stat_snapshots to anon, authenticated;

comment on view public.public_platform_stats is
  'Sanitized current statistics for approved public members.';
comment on view public.public_stat_snapshots is
  'Sanitized historical statistics for approved public members.';

create function public.admin_get_member_detail(target_profile_id uuid)
returns table (
  id uuid,
  email text,
  full_name text,
  qq text,
  grade text,
  major text,
  review_status public.profile_review_status,
  suspension_note text,
  is_public boolean,
  created_at timestamptz,
  updated_at timestamptz,
  platform public.platform_name,
  account_id bigint,
  external_id text,
  account_status public.account_verification_status,
  verified_at timestamptz,
  verification_error_message text,
  account_updated_at timestamptz,
  current_rating numeric,
  max_rating numeric,
  solved_count integer,
  stat_status public.stat_freshness_status,
  source_observed_at timestamptz,
  last_success_at timestamptz,
  stale_after timestamptz,
  source_version text,
  stat_updated_at timestamptz
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

  if target_profile_id is null then
    raise exception 'Target profile is required.' using errcode = '22004';
  end if;

  return query
  select
    p.id,
    u.email::text,
    p.full_name,
    p.qq,
    p.grade,
    p.major,
    p.review_status,
    case when p.review_status = 'suspended' then p.review_note else null end,
    p.is_public,
    p.created_at,
    p.updated_at,
    platform_list.platform,
    a.id,
    a.external_id,
    a.status,
    a.verified_at,
    a.verification_error_message,
    a.updated_at,
    s.current_rating,
    s.max_rating,
    s.solved_count,
    s.status,
    s.source_observed_at,
    s.last_success_at,
    s.stale_after,
    s.source_version,
    s.updated_at
  from public.profiles as p
  join auth.users as u on u.id = p.id
  cross join lateral unnest(enum_range(null::public.platform_name))
    as platform_list(platform)
  left join public.platform_accounts as a
    on a.profile_id = p.id
    and a.platform = platform_list.platform
  left join public.platform_stats as s
    on s.profile_id = p.id
    and s.platform = platform_list.platform
  where p.id = target_profile_id
    and p.role = 'member'
    and p.review_status in ('approved', 'suspended')
  order by platform_list.platform;
end;
$$;

revoke all on function public.admin_get_member_detail(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_get_member_detail(uuid) to authenticated;
comment on function public.admin_get_member_detail(uuid) is
  'Returns a private member profile with all platform accounts and decimal-capable current statistics.';

create or replace function public.commit_xcpc_elo_cache_refresh(
  requested_owner uuid,
  cache_ttl_seconds integer,
  response_etag text,
  response_last_modified text,
  response_source_generated_at timestamptz,
  response_players jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  state public.xcpc_elo_cache_state%rowtype;
  next_version bigint;
  inserted_count integer;
begin
  if requested_owner is null or response_source_generated_at is null then
    raise exception 'Refresh owner and source generation time are required.' using errcode = '22004';
  end if;
  if cache_ttl_seconds not between 60 and 86400 then
    raise exception 'Cache TTL must be between 60 and 86400 seconds.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(response_players) <> 'array'
    or pg_catalog.jsonb_array_length(response_players) = 0
    or pg_catalog.jsonb_array_length(response_players) > 10000 then
    raise exception 'Cached player payload must contain between 1 and 10000 players.'
      using errcode = '22023';
  end if;

  select * into state
  from public.xcpc_elo_cache_state
  where cache_key
  for update;

  if state.refresh_owner is distinct from requested_owner
    or state.refresh_lease_expires_at is null
    or state.refresh_lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'XCPC ELO refresh lease is no longer owned by this worker.'
      using errcode = '40001';
  end if;

  next_version := state.active_version + 1;

  insert into public.xcpc_elo_cache_players (
    version,
    player_id,
    normalized_name,
    display_name,
    organization,
    rating,
    max_rating,
    contests
  )
  select
    next_version,
    record.player_id,
    record.normalized_name,
    record.display_name,
    record.organization,
    record.rating,
    record.max_rating,
    record.contests
  from pg_catalog.jsonb_to_recordset(response_players) as record(
    player_id text,
    normalized_name text,
    display_name text,
    organization text,
    rating numeric,
    max_rating numeric,
    contests integer
  );

  get diagnostics inserted_count = row_count;
  if inserted_count <> pg_catalog.jsonb_array_length(response_players) then
    raise exception 'Cached player payload could not be stored completely.' using errcode = '22023';
  end if;

  update public.xcpc_elo_cache_state
  set
    active_version = next_version,
    etag = nullif(response_etag, ''),
    last_modified = nullif(response_last_modified, ''),
    source_generated_at = response_source_generated_at,
    validated_at = pg_catalog.clock_timestamp(),
    expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => cache_ttl_seconds),
    refresh_owner = null,
    refresh_lease_expires_at = null,
    refresh_retry_after = null,
    last_error_code = null,
    last_error_message = null,
    updated_at = pg_catalog.clock_timestamp()
  where cache_key;

  delete from public.xcpc_elo_cache_players where version <> next_version;
  return next_version;
end;
$$;

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
  affected_rows bigint;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;

  select * into account_row
  from public.platform_accounts
  where id = target_platform_account_id
  for update;

  if not found
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

revoke all on function public.commit_platform_sync_result(
  bigint, text, bigint, bigint, boolean, numeric, numeric, integer,
  public.stat_freshness_status, timestamptz, timestamptz, timestamptz, timestamptz,
  public.sync_error_code, text, text, timestamptz, integer, jsonb
) from public, anon, authenticated;

grant execute on function public.commit_platform_sync_result(
  bigint, text, bigint, bigint, boolean, numeric, numeric, integer,
  public.stat_freshness_status, timestamptz, timestamptz, timestamptz, timestamptz,
  public.sync_error_code, text, text, timestamptz, integer, jsonb
) to service_role;

comment on function public.commit_platform_sync_result(
  bigint, text, bigint, bigint, boolean, numeric, numeric, integer,
  public.stat_freshness_status, timestamptz, timestamptz, timestamptz, timestamptz,
  public.sync_error_code, text, text, timestamptz, integer, jsonb
) is 'Atomically validates and commits one non-Luogu synchronization result.';
