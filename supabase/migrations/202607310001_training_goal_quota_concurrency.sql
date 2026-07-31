-- Close the active-training-goal quota race without changing the public RPC.
-- The transaction-scoped advisory lock serializes create operations per member.

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
  -- Serialize quota checks per member so concurrent creates cannot both observe
  -- the same pre-insert active-goal count.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'public.training_goals.active:' || actor_id::text,
      0
    )
  );

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
