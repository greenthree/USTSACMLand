-- Allow each member to consume the automatic XCPC ELO registration synchronization only once.

create unique index sync_jobs_registration_xcpc_once_idx
on public.sync_jobs (profile_id)
where profile_id is not null
  and trigger_type = 'registration'::public.sync_trigger_type
  and platform = 'xcpc_elo'::public.platform_name;

comment on index public.sync_jobs_registration_xcpc_once_idx is
  'Prevents ordinary members from replaying the one-time XCPC ELO registration synchronization.';
