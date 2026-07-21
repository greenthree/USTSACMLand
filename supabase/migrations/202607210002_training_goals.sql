-- Private member training goals with immutable successful-sync baselines.

create type public.training_goal_metric as enum (
  'total_solved',
  'platform_solved',
  'platform_rating'
);

create type public.training_goal_status as enum (
  'active',
  'completed',
  'archived'
);

create table public.training_goals (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  metric public.training_goal_metric not null,
  platform public.platform_name,
  baseline_value integer not null,
  baseline_components jsonb not null,
  target_value integer not null,
  start_date date not null,
  end_date date not null,
  status public.training_goal_status not null default 'active',
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint training_goals_title_valid check (
    char_length(btrim(title)) between 1 and 80 and title = btrim(title)
  ),
  constraint training_goals_metric_platform_valid check (
    (metric = 'total_solved' and platform is null)
    or (
      metric = 'platform_solved'
      and platform in ('codeforces', 'nowcoder', 'atcoder', 'luogu', 'qoj')
    )
    or (
      metric = 'platform_rating'
      and platform in ('codeforces', 'nowcoder', 'atcoder', 'xcpc_elo')
    )
  ),
  constraint training_goals_values_valid check (
    baseline_value >= 0 and target_value > baseline_value
  ),
  constraint training_goals_baseline_components_valid check (
    pg_catalog.jsonb_typeof(baseline_components) = 'object'
      and baseline_components <> '{}'::jsonb
  ),
  constraint training_goals_period_valid check (
    end_date between start_date + 7 and start_date + 365
  ),
  constraint training_goals_status_metadata check (
    (status = 'active' and completed_at is null and archived_at is null)
    or (status = 'completed' and completed_at is not null and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  constraint training_goals_timestamps_valid check (updated_at >= created_at)
);

create index training_goals_profile_status_dates_idx
  on public.training_goals (profile_id, status, end_date, id desc);

alter table public.training_goals enable row level security;

create policy training_goals_select_self on public.training_goals
for select to authenticated
using (profile_id = (select auth.uid()));

revoke all on table public.training_goals
  from public, anon, authenticated, service_role;
revoke all on sequence public.training_goals_id_seq
  from public, anon, authenticated, service_role;
grant select on table public.training_goals to authenticated;

create or replace function public.set_training_goal_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.profile_id is distinct from old.profile_id
    or new.metric is distinct from old.metric
    or new.platform is distinct from old.platform
    or new.baseline_value is distinct from old.baseline_value
    or new.baseline_components is distinct from old.baseline_components
    or new.start_date is distinct from old.start_date
    or new.created_at is distinct from old.created_at then
    raise exception 'Training goal baseline fields are immutable.' using errcode = '22023';
  end if;

  new.updated_at := greatest(
    pg_catalog.clock_timestamp(),
    old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$$;

create trigger training_goals_set_updated_at
before update on public.training_goals
for each row execute function public.set_training_goal_updated_at();

revoke all on function public.set_training_goal_updated_at()
  from public, anon, authenticated, service_role;

create or replace function public.require_training_goal_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = actor_id
      and profile.review_status = 'approved'
  ) then
    raise exception 'Approved member access required.' using errcode = '42501';
  end if;

  return actor_id;
end;
$$;

revoke all on function public.require_training_goal_member()
  from public, anon, authenticated, service_role;

create or replace function public.compute_training_goal_progress(
  target_goal_id bigint,
  target_profile_id uuid
)
returns table (
  data_available boolean,
  current_value bigint,
  progress_value bigint,
  progress_percent numeric,
  regressed boolean,
  last_success_at timestamptz,
  data_message text
)
language sql
stable
security definer
set search_path = ''
as $$
  with target_goal as (
    select goal.*
    from public.training_goals as goal
    where goal.id = target_goal_id
      and goal.profile_id = target_profile_id
  ),
  components as (
    select
      goal.metric,
      goal.baseline_value,
      goal.target_value,
      component.key::public.platform_name as platform,
      component.value::integer as component_baseline
    from target_goal as goal
    cross join lateral pg_catalog.jsonb_each_text(goal.baseline_components) as component
  ),
  observed as (
    select
      component.metric,
      component.baseline_value,
      component.target_value,
      component.platform,
      component.component_baseline,
      latest.metric_value,
      latest.recorded_at
    from components as component
    left join lateral (
      select
        case
          when component.metric = 'platform_rating'
            then snapshot.current_rating::bigint
          else snapshot.solved_count::bigint
        end as metric_value,
        snapshot.recorded_at
      from public.stat_snapshots as snapshot
      join public.sync_runs as run
        on run.id = snapshot.sync_run_id
        and run.status = 'succeeded'
      join public.platform_accounts as account
        on account.profile_id = snapshot.profile_id
        and account.platform = snapshot.platform
        and account.status = 'verified'
      where snapshot.profile_id = target_profile_id
        and snapshot.platform = component.platform
        and (
          (component.metric = 'platform_rating' and snapshot.current_rating is not null)
          or (component.metric <> 'platform_rating' and snapshot.solved_count is not null)
        )
      order by snapshot.recorded_at desc, snapshot.id desc
      limit 1
    ) as latest on true
  ),
  summary as (
    select
      min(observed.metric::text)::public.training_goal_metric as metric,
      min(observed.baseline_value) as baseline_value,
      min(observed.target_value) as target_value,
      count(*) as expected_count,
      count(observed.metric_value) as available_count,
      sum(observed.metric_value) as current_value,
      max(observed.recorded_at) as last_success_at
    from observed
  ),
  calculated as (
    select
      summary.expected_count > 0
        and summary.available_count = summary.expected_count as data_available,
      summary.current_value,
      case
        when summary.expected_count > 0
          and summary.available_count = summary.expected_count
          then greatest(summary.current_value - summary.baseline_value, 0)
        else null
      end as progress_value,
      case
        when summary.expected_count > 0
          and summary.available_count = summary.expected_count
          then least(
            100::numeric,
            greatest(
              0::numeric,
              pg_catalog.round(
                (summary.current_value - summary.baseline_value)::numeric
                  * 100
                  / (summary.target_value - summary.baseline_value)::numeric,
                2
              )
            )
          )
        else null
      end as progress_percent,
      summary.metric in ('total_solved', 'platform_solved')
        and summary.expected_count > 0
        and summary.available_count = summary.expected_count
        and summary.current_value < summary.baseline_value as regressed,
      summary.last_success_at,
      summary.expected_count,
      summary.available_count,
      summary.metric,
      summary.baseline_value
    from summary
  )
  select
    calculated.data_available,
    case when calculated.data_available then calculated.current_value else null end,
    calculated.progress_value,
    calculated.progress_percent,
    coalesce(calculated.regressed, false),
    calculated.last_success_at,
    case
      when calculated.expected_count = 0 then '目标基线无效，请归档后重新创建。'
      when calculated.available_count <> calculated.expected_count
        then '已跟踪平台缺少可用的成功同步数据。'
      when calculated.regressed
        then '当前题数低于创建目标时的基线，请检查平台数据变更。'
      when calculated.metric = 'platform_rating'
        and calculated.current_value < calculated.baseline_value
        then '当前 Rating 低于创建目标时的基线。'
      else null
    end
  from calculated;
$$;

revoke all on function public.compute_training_goal_progress(bigint, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.list_own_training_goals()
returns table (
  goal_id bigint,
  title text,
  metric public.training_goal_metric,
  platform public.platform_name,
  baseline_value integer,
  target_value integer,
  start_date date,
  end_date date,
  lifecycle_status text,
  data_available boolean,
  current_value bigint,
  progress_value bigint,
  progress_percent numeric,
  regressed boolean,
  last_success_at timestamptz,
  data_message text,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.require_training_goal_member();
  beijing_date date := (
    pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai'
  )::date;
begin
  return query
  select
    goal.id,
    goal.title,
    goal.metric,
    goal.platform,
    goal.baseline_value,
    goal.target_value,
    goal.start_date,
    goal.end_date,
    case
      when goal.status = 'archived' then 'archived'
      when goal.status = 'completed' then 'completed'
      when goal.end_date < beijing_date then 'expired'
      else 'active'
    end,
    progress.data_available,
    progress.current_value,
    progress.progress_value,
    progress.progress_percent,
    progress.regressed,
    progress.last_success_at,
    progress.data_message,
    goal.completed_at,
    goal.archived_at,
    goal.created_at,
    goal.updated_at
  from public.training_goals as goal
  cross join lateral public.compute_training_goal_progress(goal.id, actor_id) as progress
  where goal.profile_id = actor_id
  order by
    case
      when goal.status = 'active' and goal.end_date >= beijing_date then 0
      when goal.status = 'active' then 1
      when goal.status = 'completed' then 2
      else 3
    end,
    goal.end_date,
    goal.id desc;
end;
$$;

create or replace function public.create_own_training_goal(
  requested_title text,
  requested_metric public.training_goal_metric,
  requested_platform public.platform_name,
  requested_target_value integer,
  requested_end_date date
)
returns table (
  goal_id bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.require_training_goal_member();
  beijing_date date := (
    pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai'
  )::date;
  normalized_title text := btrim(coalesce(requested_title, ''));
  saved_goal public.training_goals%rowtype;
  baseline_components jsonb;
  baseline_value bigint;
  saved_target_value bigint;
begin
  if char_length(normalized_title) not between 1 and 80 then
    raise exception 'Training goal title must contain 1 to 80 characters.'
      using errcode = '22001';
  end if;
  if requested_metric is null then
    raise exception 'Training goal metric is required.' using errcode = '22004';
  end if;
  if requested_end_date is null
    or requested_end_date not between beijing_date + 7 and beijing_date + 365 then
    raise exception 'Training goal end date must be 7 to 365 days after today.'
      using errcode = '22023';
  end if;
  if requested_metric = 'total_solved' and requested_platform is not null then
    raise exception 'Total solved goals cannot select a platform.' using errcode = '22023';
  end if;
  if requested_metric = 'platform_solved'
    and (
      requested_platform is null
      or requested_platform not in ('codeforces', 'nowcoder', 'atcoder', 'luogu', 'qoj')
    ) then
    raise exception 'Selected platform does not provide a solved-count goal.' using errcode = '22023';
  end if;
  if requested_metric = 'platform_rating'
    and (
      requested_platform is null
      or requested_platform not in ('codeforces', 'nowcoder', 'atcoder', 'xcpc_elo')
    ) then
    raise exception 'Selected platform does not provide a Rating goal.' using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.training_goals as goal
    where goal.profile_id = actor_id
      and goal.status = 'active'
  ) >= 20 then
    raise exception 'Archive an existing goal before creating another one.'
      using errcode = '54000';
  end if;

  if requested_metric = 'total_solved' then
    with latest_success as (
      select distinct on (snapshot.platform)
        snapshot.platform,
        snapshot.solved_count
      from public.stat_snapshots as snapshot
      join public.sync_runs as run
        on run.id = snapshot.sync_run_id
        and run.status = 'succeeded'
      join public.platform_accounts as account
        on account.profile_id = snapshot.profile_id
        and account.platform = snapshot.platform
        and account.status = 'verified'
      where snapshot.profile_id = actor_id
        and snapshot.platform in ('codeforces', 'nowcoder', 'atcoder', 'luogu', 'qoj')
        and snapshot.solved_count is not null
      order by snapshot.platform, snapshot.recorded_at desc, snapshot.id desc
    )
    select
      pg_catalog.jsonb_object_agg(latest.platform::text, latest.solved_count),
      sum(latest.solved_count)
    into baseline_components, baseline_value
    from latest_success as latest;
  else
    select
      pg_catalog.jsonb_build_object(
        requested_platform::text,
        case
          when requested_metric = 'platform_rating' then snapshot.current_rating
          else snapshot.solved_count
        end
      ),
      case
        when requested_metric = 'platform_rating' then snapshot.current_rating
        else snapshot.solved_count
      end
    into baseline_components, baseline_value
    from public.stat_snapshots as snapshot
    join public.sync_runs as run
      on run.id = snapshot.sync_run_id
      and run.status = 'succeeded'
    join public.platform_accounts as account
      on account.profile_id = snapshot.profile_id
      and account.platform = snapshot.platform
      and account.status = 'verified'
    where snapshot.profile_id = actor_id
      and snapshot.platform = requested_platform
      and (
        (requested_metric = 'platform_rating' and snapshot.current_rating is not null)
        or (requested_metric = 'platform_solved' and snapshot.solved_count is not null)
      )
    order by snapshot.recorded_at desc, snapshot.id desc
    limit 1;
  end if;

  if baseline_components is null or baseline_value is null then
    raise exception 'No successful synchronized data is available for this goal.'
      using errcode = 'P0002';
  end if;
  if baseline_value > 2147483647 then
    raise exception 'Training goal baseline exceeds the supported range.' using errcode = '22003';
  end if;
  if requested_metric = 'platform_rating' then
    if requested_target_value is null
      or requested_target_value <= baseline_value
      or requested_target_value > 10000 then
      raise exception 'Rating goal target must be above the baseline and at most 10000.'
        using errcode = '22023';
    end if;
    saved_target_value := requested_target_value;
  else
    if requested_target_value is null or requested_target_value not between 1 and 1000000 then
      raise exception 'Solved-count goal increase must be between 1 and 1000000.'
        using errcode = '22023';
    end if;
    saved_target_value := baseline_value + requested_target_value;
    if saved_target_value > 1000000 then
      raise exception 'Solved-count goal target cannot exceed 1000000.' using errcode = '22023';
    end if;
  end if;

  insert into public.training_goals (
    profile_id,
    title,
    metric,
    platform,
    baseline_value,
    baseline_components,
    target_value,
    start_date,
    end_date
  ) values (
    actor_id,
    normalized_title,
    requested_metric,
    requested_platform,
    baseline_value::integer,
    baseline_components,
    saved_target_value::integer,
    beijing_date,
    requested_end_date
  )
  returning * into saved_goal;

  return query select saved_goal.id, saved_goal.updated_at;
end;
$$;

create or replace function public.update_own_training_goal(
  target_goal_id bigint,
  requested_title text,
  requested_target_value integer,
  requested_end_date date,
  expected_updated_at timestamptz
)
returns table (
  goal_id bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.require_training_goal_member();
  normalized_title text := btrim(coalesce(requested_title, ''));
  target_goal public.training_goals%rowtype;
  saved_goal public.training_goals%rowtype;
begin
  if target_goal_id is null or target_goal_id < 1 then
    raise exception 'A positive training goal ID is required.' using errcode = '22023';
  end if;
  if expected_updated_at is null then
    raise exception 'Expected training goal version is required.' using errcode = '22004';
  end if;
  if char_length(normalized_title) not between 1 and 80 then
    raise exception 'Training goal title must contain 1 to 80 characters.'
      using errcode = '22001';
  end if;

  select goal.*
  into target_goal
  from public.training_goals as goal
  where goal.id = target_goal_id
    and goal.profile_id = actor_id
  for update;

  if not found then
    raise exception 'Training goal not found.' using errcode = 'P0002';
  end if;
  if target_goal.status <> 'active' then
    raise exception 'Only active training goals can be edited.' using errcode = '55000';
  end if;
  if target_goal.updated_at is distinct from expected_updated_at then
    raise exception 'Training goal changed after it was loaded. Refresh and try again.'
      using errcode = 'PT409';
  end if;
  if requested_end_date is null
    or requested_end_date not between target_goal.start_date + 7 and target_goal.start_date + 365 then
    raise exception 'Training goal end date must remain 7 to 365 days after its start date.'
      using errcode = '22023';
  end if;
  if requested_target_value is null or requested_target_value <= target_goal.baseline_value then
    raise exception 'Training goal target must be greater than its baseline.'
      using errcode = '22023';
  end if;
  if target_goal.metric = 'platform_rating' and requested_target_value > 10000 then
    raise exception 'Rating goal target cannot exceed 10000.' using errcode = '22023';
  end if;
  if target_goal.metric <> 'platform_rating' and requested_target_value > 1000000 then
    raise exception 'Solved-count goal target cannot exceed 1000000.' using errcode = '22023';
  end if;

  update public.training_goals as goal
  set
    title = normalized_title,
    target_value = requested_target_value,
    end_date = requested_end_date
  where goal.id = target_goal_id
    and goal.profile_id = actor_id
  returning goal.* into saved_goal;

  return query select saved_goal.id, saved_goal.updated_at;
end;
$$;

create or replace function public.complete_own_training_goal(
  target_goal_id bigint,
  expected_updated_at timestamptz
)
returns table (
  goal_id bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.require_training_goal_member();
  beijing_date date := (
    pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai'
  )::date;
  target_goal public.training_goals%rowtype;
  saved_goal public.training_goals%rowtype;
  progress record;
begin
  if target_goal_id is null or target_goal_id < 1 then
    raise exception 'A positive training goal ID is required.' using errcode = '22023';
  end if;
  if expected_updated_at is null then
    raise exception 'Expected training goal version is required.' using errcode = '22004';
  end if;

  select goal.*
  into target_goal
  from public.training_goals as goal
  where goal.id = target_goal_id
    and goal.profile_id = actor_id
  for update;

  if not found then
    raise exception 'Training goal not found.' using errcode = 'P0002';
  end if;
  if target_goal.status <> 'active' or target_goal.end_date < beijing_date then
    raise exception 'Only an active, unexpired goal can be completed.' using errcode = '55000';
  end if;
  if target_goal.updated_at is distinct from expected_updated_at then
    raise exception 'Training goal changed after it was loaded. Refresh and try again.'
      using errcode = 'PT409';
  end if;

  select * into progress
  from public.compute_training_goal_progress(target_goal.id, actor_id);

  if not coalesce(progress.data_available, false)
    or coalesce(progress.progress_percent, 0) < 100 then
    raise exception 'Training goal has not reached its target yet.' using errcode = '55000';
  end if;

  update public.training_goals as goal
  set
    status = 'completed',
    completed_at = pg_catalog.clock_timestamp()
  where goal.id = target_goal_id
    and goal.profile_id = actor_id
  returning goal.* into saved_goal;

  return query select saved_goal.id, saved_goal.updated_at;
end;
$$;

create or replace function public.archive_own_training_goal(
  target_goal_id bigint,
  expected_updated_at timestamptz
)
returns table (
  goal_id bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.require_training_goal_member();
  target_goal public.training_goals%rowtype;
  saved_goal public.training_goals%rowtype;
begin
  if target_goal_id is null or target_goal_id < 1 then
    raise exception 'A positive training goal ID is required.' using errcode = '22023';
  end if;
  if expected_updated_at is null then
    raise exception 'Expected training goal version is required.' using errcode = '22004';
  end if;

  select goal.*
  into target_goal
  from public.training_goals as goal
  where goal.id = target_goal_id
    and goal.profile_id = actor_id
  for update;

  if not found then
    raise exception 'Training goal not found.' using errcode = 'P0002';
  end if;
  if target_goal.updated_at is distinct from expected_updated_at then
    raise exception 'Training goal changed after it was loaded. Refresh and try again.'
      using errcode = 'PT409';
  end if;
  if target_goal.status = 'archived' then
    return query select target_goal.id, target_goal.updated_at;
    return;
  end if;

  update public.training_goals as goal
  set
    status = 'archived',
    archived_at = pg_catalog.clock_timestamp()
  where goal.id = target_goal_id
    and goal.profile_id = actor_id
  returning goal.* into saved_goal;

  return query select saved_goal.id, saved_goal.updated_at;
end;
$$;

create or replace function public.export_own_training_goals()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  exported_goals jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles as profile where profile.id = actor_id) then
    raise exception 'Member profile not found.' using errcode = '42501';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', goal.id,
        'title', goal.title,
        'metric', goal.metric,
        'platform', goal.platform,
        'baselineValue', goal.baseline_value,
        'baselineComponents', goal.baseline_components,
        'targetValue', goal.target_value,
        'startDate', goal.start_date,
        'endDate', goal.end_date,
        'status', goal.status,
        'completedAt', goal.completed_at,
        'archivedAt', goal.archived_at,
        'createdAt', goal.created_at,
        'updatedAt', goal.updated_at
      ) order by goal.created_at, goal.id
    ),
    '[]'::jsonb
  ) into exported_goals
  from public.training_goals as goal
  where goal.profile_id = actor_id;

  return exported_goals;
end;
$$;

revoke all on function public.list_own_training_goals()
  from public, anon, authenticated, service_role;
revoke all on function public.create_own_training_goal(text, public.training_goal_metric, public.platform_name, integer, date)
  from public, anon, authenticated, service_role;
revoke all on function public.update_own_training_goal(bigint, text, integer, date, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_own_training_goal(bigint, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.archive_own_training_goal(bigint, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.export_own_training_goals()
  from public, anon, authenticated, service_role;

grant execute on function public.list_own_training_goals() to authenticated;
grant execute on function public.create_own_training_goal(text, public.training_goal_metric, public.platform_name, integer, date)
  to authenticated;
grant execute on function public.update_own_training_goal(bigint, text, integer, date, timestamptz)
  to authenticated;
grant execute on function public.complete_own_training_goal(bigint, timestamptz)
  to authenticated;
grant execute on function public.archive_own_training_goal(bigint, timestamptz)
  to authenticated;
grant execute on function public.export_own_training_goals() to authenticated;

comment on table public.training_goals is
  'Private member-owned training goals with immutable successful-sync baselines.';
comment on function public.list_own_training_goals() is
  'Lists only the authenticated approved member own goals and computes progress from successful snapshots.';
comment on function public.export_own_training_goals() is
  'Returns only the authenticated caller own immutable training goal history for personal data export.';
