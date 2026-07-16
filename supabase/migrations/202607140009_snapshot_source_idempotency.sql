-- A source version observed more than once should create only one successful snapshot.

-- Failed runs did not observe a new upstream version. The retained source time
-- belongs to platform_stats, not to the failed run snapshot.
update public.stat_snapshots as snapshot
set source_observed_at = null
from public.sync_runs as run
where run.id = snapshot.sync_run_id
  and run.status = 'failed'
  and snapshot.source_observed_at is not null;

with ranked_snapshots as (
  select
    id,
    row_number() over (
      partition by profile_id, platform, source_observed_at
      order by recorded_at desc, id desc
    ) as duplicate_rank
  from public.stat_snapshots
  where source_observed_at is not null
)
delete from public.stat_snapshots as snapshot
using ranked_snapshots as ranked
where snapshot.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index stat_snapshots_success_source_unique_idx
  on public.stat_snapshots (profile_id, platform, source_observed_at);

comment on index public.stat_snapshots_success_source_unique_idx is
  'Prevents duplicate successful snapshots for the same upstream observation time.';
