-- Administrator member detail, platform binding management, and manual statistics entry.

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
  current_rating integer,
  max_rating integer,
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

create function public.admin_list_member_activity(
  target_profile_id uuid,
  row_limit integer default 20
)
returns table (
  event_id text,
  event_kind text,
  target_table text,
  action text,
  platform text,
  run_status text,
  detail text,
  source_version text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(row_limit, 20), 1), 50);
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if target_profile_id is null then
    raise exception 'Target profile is required.' using errcode = '22004';
  end if;

  return query
  with activity as (
    select
      'audit:' || log.id::text as event_id,
      'audit'::text as event_kind,
      log.target_table,
      log.action,
      coalesce(
        log.metadata ->> 'platform',
        log.after_data ->> 'platform',
        log.before_data ->> 'platform'
      ) as platform,
      null::text as run_status,
      case
        when log.action = 'manual_stats_updated' then log.metadata ->> 'note'
        else null
      end as detail,
      null::text as source_version,
      log.created_at
    from public.audit_logs as log
    where (
      log.target_table = 'profiles'
      and log.target_id = target_profile_id::text
    ) or coalesce(
      log.after_data ->> 'profile_id',
      log.before_data ->> 'profile_id',
      log.metadata ->> 'profile_id'
    ) = target_profile_id::text

    union all

    select
      'sync:' || run.id::text,
      'sync'::text,
      'sync_runs'::text,
      job.trigger_type::text,
      run.platform::text,
      run.status::text,
      run.error_message,
      run.source_version,
      run.started_at
    from public.sync_runs as run
    join public.sync_jobs as job on job.id = run.job_id
    where run.profile_id = target_profile_id
      and coalesce(run.source_version, '') <> 'admin-manual/v1'
  )
  select
    activity.event_id,
    activity.event_kind,
    activity.target_table,
    activity.action,
    activity.platform,
    activity.run_status,
    activity.detail,
    activity.source_version,
    activity.created_at
  from activity
  order by activity.created_at desc, activity.event_id desc
  limit safe_limit;
end;
$$;

create function public.admin_upsert_member_platform_account(
  target_profile_id uuid,
  target_platform public.platform_name,
  new_external_id text,
  expected_updated_at timestamptz default null
)
returns table (
  account_id bigint,
  account_status public.account_verification_status,
  account_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_external_id text := nullif(btrim(new_external_id), '');
  target_role public.app_role;
  target_status public.profile_review_status;
  current_account_id bigint;
  current_external_id text;
  current_updated_at timestamptz;
  account_exists boolean;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if target_profile_id is null or target_platform is null then
    raise exception 'Target member and platform are required.' using errcode = '22004';
  end if;

  if target_platform = 'xcpc_elo'::public.platform_name then
    raise exception 'XCPC ELO accounts are maintained by automatic name matching.'
      using errcode = '42501';
  end if;

  if normalized_external_id is null or char_length(normalized_external_id) > 128 then
    raise exception 'Platform account ID must contain between 1 and 128 characters.'
      using errcode = '22023';
  end if;

  select p.role, p.review_status
  into target_role, target_status
  from public.profiles as p
  where p.id = target_profile_id
  for update;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  if target_role <> 'member' or target_status not in ('approved', 'suspended') then
    raise exception 'Only active or suspended member profiles can be managed.'
      using errcode = '42501';
  end if;

  select a.id, a.external_id, a.updated_at
  into current_account_id, current_external_id, current_updated_at
  from public.platform_accounts as a
  where a.profile_id = target_profile_id
    and a.platform = target_platform
  for update;
  account_exists := found;

  if account_exists then
    if expected_updated_at is null
      or current_updated_at is distinct from expected_updated_at then
      raise exception 'Platform account changed after it was loaded. Refresh and try again.'
        using errcode = '40001';
    end if;

    if current_external_id is distinct from normalized_external_id then
      update public.platform_accounts
      set external_id = normalized_external_id
      where id = current_account_id
      returning id, status, updated_at
      into account_id, account_status, account_updated_at;
    else
      select a.id, a.status, a.updated_at
      into account_id, account_status, account_updated_at
      from public.platform_accounts as a
      where a.id = current_account_id;
    end if;
  else
    if expected_updated_at is not null then
      raise exception 'Platform account changed after it was loaded. Refresh and try again.'
        using errcode = '40001';
    end if;

    insert into public.platform_accounts (
      profile_id,
      platform,
      external_id,
      normalized_external_id,
      status
    ) values (
      target_profile_id,
      target_platform,
      normalized_external_id,
      lower(normalized_external_id),
      'pending'
    )
    returning id, status, updated_at
    into account_id, account_status, account_updated_at;
  end if;

  return next;
end;
$$;

create function public.admin_unbind_member_platform_account(
  target_profile_id uuid,
  target_platform public.platform_name,
  expected_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account_id bigint;
  current_updated_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if target_profile_id is null or target_platform is null then
    raise exception 'Target member and platform are required.' using errcode = '22004';
  end if;

  if expected_updated_at is null then
    raise exception 'Expected platform account update time is required.' using errcode = '22004';
  end if;

  if target_platform = 'xcpc_elo'::public.platform_name then
    raise exception 'XCPC ELO accounts are maintained by automatic name matching.'
      using errcode = '42501';
  end if;

  select a.id, a.updated_at
  into target_account_id, current_updated_at
  from public.platform_accounts as a
  join public.profiles as p on p.id = a.profile_id
  where a.profile_id = target_profile_id
    and a.platform = target_platform
    and p.role = 'member'
    and p.review_status in ('approved', 'suspended')
  for update of a;

  if not found then
    raise exception 'Platform account not found.' using errcode = 'P0002';
  end if;

  if current_updated_at is distinct from expected_updated_at then
    raise exception 'Platform account changed after it was loaded. Refresh and try again.'
      using errcode = '40001';
  end if;

  delete from public.platform_accounts
  where id = target_account_id;

  return true;
end;
$$;

create or replace function public.write_sync_job_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requested_by is not null
    and coalesce(new.payload ->> 'source', '') <> 'admin_manual' then
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

create function public.admin_set_manual_platform_stats(
  target_profile_id uuid,
  target_platform public.platform_name,
  manual_current_rating integer,
  manual_max_rating integer,
  manual_solved_count integer,
  manual_source_observed_at timestamptz,
  manual_note text,
  expected_stat_updated_at timestamptz default null
)
returns table (
  stat_updated_at timestamptz,
  sync_run_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_note text := nullif(btrim(manual_note), '');
  recorded_at timestamptz := statement_timestamp();
  observed_at timestamptz := coalesce(manual_source_observed_at, statement_timestamp());
  local_recorded_at timestamp;
  local_scheduled_at timestamp;
  next_stale_at timestamptz;
  days_until_tuesday integer;
  rating_supported boolean := target_platform in (
    'codeforces'::public.platform_name,
    'nowcoder'::public.platform_name,
    'atcoder'::public.platform_name,
    'xcpc_elo'::public.platform_name
  );
  solved_supported boolean := target_platform in (
    'codeforces'::public.platform_name,
    'nowcoder'::public.platform_name,
    'luogu'::public.platform_name,
    'qoj'::public.platform_name
  );
  target_account_id bigint;
  target_account_status public.account_verification_status;
  target_role public.app_role;
  target_profile_status public.profile_review_status;
  previous_stat jsonb;
  next_stat jsonb;
  current_stat_updated_at timestamptz;
  stat_exists boolean;
  manual_job_id bigint;
  manual_run_id bigint;
  next_updated_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if target_profile_id is null or target_platform is null then
    raise exception 'Target member and platform are required.' using errcode = '22004';
  end if;

  if normalized_note is null or char_length(normalized_note) > 500 then
    raise exception 'A manual entry reason between 1 and 500 characters is required.'
      using errcode = '22023';
  end if;

  if observed_at > recorded_at + interval '5 minutes' then
    raise exception 'Source observation time cannot be in the future.' using errcode = '22023';
  end if;

  if not rating_supported
    and (manual_current_rating is not null or manual_max_rating is not null) then
    raise exception 'Rating is not supported for platform %.', target_platform
      using errcode = '22023';
  end if;

  if rating_supported
    and ((manual_current_rating is null) <> (manual_max_rating is null)) then
    raise exception 'Current and maximum Rating must either both be set or both be empty.'
      using errcode = '22023';
  end if;

  if not solved_supported and manual_solved_count is not null then
    raise exception 'Solved count is not supported for platform %.', target_platform
      using errcode = '22023';
  end if;

  if manual_current_rating is null and manual_solved_count is null then
    raise exception 'At least one supported metric is required.' using errcode = '22023';
  end if;

  if manual_current_rating is not null
    and (manual_current_rating < 0 or manual_current_rating > 100000) then
    raise exception 'Current Rating is outside the supported range.' using errcode = '22023';
  end if;

  if manual_max_rating is not null
    and (
      manual_max_rating < 0
      or manual_max_rating > 100000
      or manual_max_rating < manual_current_rating
    ) then
    raise exception 'Maximum Rating must be at least the current Rating.' using errcode = '22023';
  end if;

  if manual_solved_count is not null
    and (manual_solved_count < 0 or manual_solved_count > 100000000) then
    raise exception 'Solved count is outside the supported range.' using errcode = '22023';
  end if;

  select a.id, a.status, p.role, p.review_status
  into target_account_id, target_account_status, target_role, target_profile_status
  from public.platform_accounts as a
  join public.profiles as p on p.id = a.profile_id
  where a.profile_id = target_profile_id
    and a.platform = target_platform
  for update of a, p;

  if not found then
    raise exception 'Platform account not found.' using errcode = 'P0002';
  end if;

  if target_role <> 'member' or target_profile_status not in ('approved', 'suspended') then
    raise exception 'Only active or suspended member profiles can be managed.'
      using errcode = '42501';
  end if;

  if target_account_status <> 'verified' then
    raise exception 'Manual statistics require a verified platform account.' using errcode = '22023';
  end if;

  select to_jsonb(s), s.updated_at
  into previous_stat, current_stat_updated_at
  from public.platform_stats as s
  where s.profile_id = target_profile_id
    and s.platform = target_platform
  for update;
  stat_exists := found;

  if stat_exists then
    if expected_stat_updated_at is null
      or current_stat_updated_at is distinct from expected_stat_updated_at then
      raise exception 'Platform statistics changed after they were loaded. Refresh and try again.'
        using errcode = '40001';
    end if;
  elsif expected_stat_updated_at is not null then
    raise exception 'Platform statistics changed after they were loaded. Refresh and try again.'
      using errcode = '40001';
  end if;

  local_recorded_at := recorded_at at time zone 'Asia/Shanghai';
  if target_platform in (
    'codeforces'::public.platform_name,
    'nowcoder'::public.platform_name,
    'luogu'::public.platform_name,
    'atcoder'::public.platform_name
  ) then
    if local_recorded_at::time < time '07:00' then
      local_scheduled_at := local_recorded_at::date + time '09:00';
    elsif local_recorded_at::time < time '19:00' then
      local_scheduled_at := local_recorded_at::date + time '21:00';
    else
      local_scheduled_at := local_recorded_at::date + 1 + time '09:00';
    end if;
  else
    days_until_tuesday := (2 - extract(dow from local_recorded_at)::integer + 7) % 7;
    local_scheduled_at := local_recorded_at::date
      + days_until_tuesday
      + time '08:00';
    if local_scheduled_at <= local_recorded_at then
      local_scheduled_at := local_scheduled_at + interval '7 days';
    end if;
    local_scheduled_at := local_scheduled_at + interval '1 day';
  end if;
  next_stale_at := local_scheduled_at at time zone 'Asia/Shanghai';

  insert into public.sync_jobs (
    scope,
    profile_id,
    platform,
    status,
    trigger_type,
    requested_by,
    priority,
    attempt_count,
    max_attempts,
    scheduled_for,
    started_at,
    finished_at,
    payload
  ) values (
    'account',
    target_profile_id,
    target_platform,
    'succeeded',
    'manual',
    (select auth.uid()),
    0,
    1,
    1,
    recorded_at,
    recorded_at,
    recorded_at,
    pg_catalog.jsonb_build_object(
      'source', 'admin_manual',
      'platforms', pg_catalog.jsonb_build_array(target_platform)
    )
  )
  returning id into manual_job_id;

  insert into public.sync_runs (
    job_id,
    profile_id,
    platform,
    platform_account_id,
    attempt,
    status,
    started_at,
    finished_at,
    duration_ms,
    source_version,
    metrics
  ) values (
    manual_job_id,
    target_profile_id,
    target_platform,
    target_account_id,
    1,
    'succeeded',
    recorded_at,
    recorded_at,
    0,
    'admin-manual/v1',
    pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'currentRating', manual_current_rating,
        'maxRating', manual_max_rating,
        'solvedCount', manual_solved_count
      )
    )
  )
  returning id into manual_run_id;

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
    target_profile_id,
    target_platform,
    manual_current_rating,
    manual_max_rating,
    manual_solved_count,
    'fresh',
    observed_at,
    recorded_at,
    recorded_at,
    next_stale_at,
    null,
    null,
    'admin-manual/v1',
    recorded_at
  )
  on conflict (profile_id, platform) do update
  set
    current_rating = excluded.current_rating,
    max_rating = excluded.max_rating,
    solved_count = excluded.solved_count,
    status = excluded.status,
    source_observed_at = excluded.source_observed_at,
    fetched_at = excluded.fetched_at,
    last_success_at = excluded.last_success_at,
    stale_after = excluded.stale_after,
    error_code = null,
    error_message = null,
    source_version = excluded.source_version,
    updated_at = excluded.updated_at
  returning updated_at into next_updated_at;

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
    target_profile_id,
    target_platform,
    manual_run_id,
    manual_current_rating,
    manual_max_rating,
    manual_solved_count,
    'fresh',
    observed_at,
    recorded_at
  );

  select to_jsonb(s)
  into next_stat
  from public.platform_stats as s
  where s.profile_id = target_profile_id
    and s.platform = target_platform;

  insert into public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    before_data,
    after_data,
    metadata
  ) values (
    (select auth.uid()),
    'manual_stats_updated',
    'platform_stats',
    target_profile_id::text || ':' || target_platform::text,
    previous_stat,
    next_stat,
    pg_catalog.jsonb_build_object(
      'profile_id', target_profile_id,
      'platform', target_platform,
      'note', normalized_note,
      'sync_run_id', manual_run_id
    )
  );

  stat_updated_at := next_updated_at;
  sync_run_id := manual_run_id;
  return next;
end;
$$;

revoke all on function public.admin_get_member_detail(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_list_member_activity(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.admin_upsert_member_platform_account(
  uuid,
  public.platform_name,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_unbind_member_platform_account(
  uuid,
  public.platform_name,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_set_manual_platform_stats(
  uuid,
  public.platform_name,
  integer,
  integer,
  integer,
  timestamptz,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.admin_get_member_detail(uuid) to authenticated;
grant execute on function public.admin_list_member_activity(uuid, integer) to authenticated;
grant execute on function public.admin_upsert_member_platform_account(
  uuid,
  public.platform_name,
  text,
  timestamptz
) to authenticated;
grant execute on function public.admin_unbind_member_platform_account(
  uuid,
  public.platform_name,
  timestamptz
) to authenticated;
grant execute on function public.admin_set_manual_platform_stats(
  uuid,
  public.platform_name,
  integer,
  integer,
  integer,
  timestamptz,
  text,
  timestamptz
) to authenticated;

comment on function public.admin_get_member_detail(uuid) is
  'Returns a private member profile with all platform accounts and current statistics.';
comment on function public.admin_list_member_activity(uuid, integer) is
  'Returns recent sanitized audit and synchronization activity for one member.';
comment on function public.admin_upsert_member_platform_account(
  uuid,
  public.platform_name,
  text,
  timestamptz
) is 'Creates or updates a non-XCPC platform account with optimistic locking.';
comment on function public.admin_unbind_member_platform_account(
  uuid,
  public.platform_name,
  timestamptz
) is 'Deletes a non-XCPC platform account and its dependent statistics and snapshots.';
comment on function public.admin_set_manual_platform_stats(
  uuid,
  public.platform_name,
  integer,
  integer,
  integer,
  timestamptz,
  text,
  timestamptz
) is 'Atomically records administrator-supplied statistics, snapshot, run, and audit data.';
