-- Public practice-increment rankings derive interval gains from successful
-- cumulative-count snapshots. Calendar boundaries are always interpreted in
-- Asia/Shanghai, matching the synchronization schedule shown by the product.

create index stat_snapshots_solved_range_idx
  on public.stat_snapshots (profile_id, platform, recorded_at desc)
  include (solved_count, sync_run_id)
  where solved_count is not null;

create function public.get_public_practice_increments(
  range_start_date date,
  range_end_date date
)
returns table (
  profile_id uuid,
  platform public.platform_name,
  solved_delta integer,
  baseline_solved_count integer,
  end_solved_count integer,
  baseline_recorded_at timestamptz,
  end_recorded_at timestamptz,
  coverage_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  range_start_at timestamptz;
  range_end_exclusive_at timestamptz;
  beijing_today date := (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  if range_start_date is null or range_end_date is null then
    raise exception 'Practice ranking start and end dates are required.' using errcode = '22004';
  end if;

  if not pg_catalog.isfinite(range_start_date) or not pg_catalog.isfinite(range_end_date) then
    raise exception 'Practice ranking dates must be finite.' using errcode = '22023';
  end if;

  if range_start_date > range_end_date then
    raise exception 'Practice ranking start date must not be after the end date.'
      using errcode = '22023';
  end if;

  if range_end_date - range_start_date > 365 then
    raise exception 'Practice ranking ranges may include at most 366 days.'
      using errcode = '22023';
  end if;

  if range_end_date > beijing_today then
    raise exception 'Practice ranking end date must not be in the future.'
      using errcode = '22023';
  end if;

  range_start_at := range_start_date::timestamp at time zone 'Asia/Shanghai';
  range_end_exclusive_at := (range_end_date + 1)::timestamp at time zone 'Asia/Shanghai';

  return query
  with target_platforms(platform) as (
    values
      ('codeforces'::public.platform_name),
      ('nowcoder'::public.platform_name),
      ('atcoder'::public.platform_name),
      ('luogu'::public.platform_name),
      ('qoj'::public.platform_name)
  ),
  visible_members as (
    select profile.id
    from public.profiles as profile
    where profile.review_status = 'approved'
      and profile.is_public
      and profile.full_name is not null
      and profile.major is not null
      and profile.grade is not null
  )
  select
    member.id,
    target.platform,
    case
      when account.id is null
        or baseline.solved_count is null
        or interval_end.solved_count is null then null
      when interval_end.solved_count < baseline.solved_count then 0
      else interval_end.solved_count - baseline.solved_count
    end as solved_delta,
    baseline.solved_count,
    interval_end.solved_count,
    baseline.recorded_at,
    interval_end.recorded_at,
    case
      when account.id is null then 'unbound'
      when baseline.solved_count is null then 'missing_baseline'
      when interval_end.solved_count is null then 'missing_end'
      when interval_end.solved_count < baseline.solved_count then 'count_decreased'
      else 'complete'
    end as coverage_status
  from visible_members as member
  cross join target_platforms as target
  left join public.platform_accounts as account
    on account.profile_id = member.id
    and account.platform = target.platform
    and account.status = 'verified'
  left join lateral (
    select snapshot.solved_count, snapshot.recorded_at
    from public.stat_snapshots as snapshot
    join public.sync_runs as run
      on run.id = snapshot.sync_run_id
      and run.status = 'succeeded'
    where account.id is not null
      and snapshot.profile_id = member.id
      and snapshot.platform = target.platform
      and snapshot.solved_count is not null
      and snapshot.recorded_at >= account.updated_at
      and snapshot.recorded_at < range_start_at
    order by snapshot.recorded_at desc, snapshot.id desc
    limit 1
  ) as baseline on true
  left join lateral (
    select snapshot.solved_count, snapshot.recorded_at
    from public.stat_snapshots as snapshot
    join public.sync_runs as run
      on run.id = snapshot.sync_run_id
      and run.status = 'succeeded'
    where account.id is not null
      and snapshot.profile_id = member.id
      and snapshot.platform = target.platform
      and snapshot.solved_count is not null
      and snapshot.recorded_at >= greatest(range_start_at, account.updated_at)
      and snapshot.recorded_at < range_end_exclusive_at
    order by snapshot.recorded_at desc, snapshot.id desc
    limit 1
  ) as interval_end on true
  order by member.id, target.platform;
end;
$$;

revoke all on function public.get_public_practice_increments(date, date)
  from public, anon, authenticated;
grant execute on function public.get_public_practice_increments(date, date)
  to anon, authenticated;

comment on index public.stat_snapshots_solved_range_idx is
  'Supports bounded public solved-count baseline and interval-end lookups.';

comment on function public.get_public_practice_increments(date, date) is
  'Returns sanitized Beijing-calendar solved-count deltas for approved public members; failed runs and snapshots from earlier account bindings are excluded.';
