-- Public Rating change summaries expose the latest successful observation and
-- the most recent earlier distinct Rating for each verified platform binding.

create index stat_snapshots_rating_change_idx
  on public.stat_snapshots (profile_id, platform, recorded_at desc, id desc)
  include (current_rating, sync_run_id)
  where current_rating is not null;

create function public.get_public_rating_changes()
returns table (
  profile_id uuid,
  platform public.platform_name,
  current_rating numeric(12, 2),
  previous_rating numeric(12, 2),
  current_recorded_at timestamptz,
  previous_recorded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with rating_platforms(platform) as (
    values
      ('codeforces'::public.platform_name),
      ('nowcoder'::public.platform_name),
      ('atcoder'::public.platform_name),
      ('xcpc_elo'::public.platform_name)
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
    current_snapshot.current_rating,
    previous_snapshot.current_rating,
    current_snapshot.recorded_at,
    previous_snapshot.recorded_at
  from visible_members as member
  cross join rating_platforms as target
  left join public.platform_accounts as account
    on account.profile_id = member.id
    and account.platform = target.platform
    and account.status = 'verified'
  left join lateral (
    select snapshot.id, snapshot.current_rating, snapshot.recorded_at
    from public.stat_snapshots as snapshot
    join public.sync_runs as run
      on run.id = snapshot.sync_run_id
      and run.status = 'succeeded'
    where account.id is not null
      and snapshot.profile_id = member.id
      and snapshot.platform = target.platform
      and snapshot.current_rating is not null
      and snapshot.recorded_at >= account.updated_at
    order by snapshot.recorded_at desc, snapshot.id desc
    limit 1
  ) as current_snapshot on true
  left join lateral (
    select snapshot.current_rating, snapshot.recorded_at
    from public.stat_snapshots as snapshot
    join public.sync_runs as run
      on run.id = snapshot.sync_run_id
      and run.status = 'succeeded'
    where current_snapshot.id is not null
      and snapshot.profile_id = member.id
      and snapshot.platform = target.platform
      and snapshot.current_rating is not null
      and snapshot.recorded_at >= account.updated_at
      and snapshot.current_rating <> current_snapshot.current_rating
      and (
        snapshot.recorded_at < current_snapshot.recorded_at
        or (
          snapshot.recorded_at = current_snapshot.recorded_at
          and snapshot.id < current_snapshot.id
        )
      )
    order by snapshot.recorded_at desc, snapshot.id desc
    limit 1
  ) as previous_snapshot on true
  order by member.id, target.platform;
$$;

revoke all on function public.get_public_rating_changes()
  from public, anon, authenticated;
grant execute on function public.get_public_rating_changes()
  to anon, authenticated;

comment on index public.stat_snapshots_rating_change_idx is
  'Supports bounded lookups of the latest and previous distinct Rating snapshots.';

comment on function public.get_public_rating_changes() is
  'Returns the latest and most recent earlier distinct Rating for public members; repeated values, failed runs, and snapshots from earlier bindings are excluded.';
