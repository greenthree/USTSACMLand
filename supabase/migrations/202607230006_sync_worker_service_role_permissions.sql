-- Grant the Edge synchronization worker only the direct table access used by
-- its orchestration path. Statistics remain writable only through the atomic
-- SECURITY DEFINER commit functions.

revoke insert, update, delete on table public.profiles from service_role;
grant select on table public.profiles to service_role;
revoke insert, delete on table public.platform_accounts from service_role;
grant select on table public.platform_accounts to service_role;
revoke update on table public.platform_accounts from service_role;
grant update (
  external_id,
  status,
  verification_error_code,
  verification_error_message
) on table public.platform_accounts to service_role;
grant select on table public.platform_stats to service_role;
grant select on table public.luogu_sync_states to service_role;

grant select, insert, update on table public.sync_jobs to service_role;
grant select, insert, update on table public.sync_runs to service_role;

grant usage, select on sequence public.sync_jobs_id_seq to service_role;
grant usage, select on sequence public.sync_runs_id_seq to service_role;

revoke insert, update, delete on table public.platform_stats from service_role;
revoke insert, update, delete on table public.stat_snapshots from service_role;
revoke insert, update, delete on table public.luogu_sync_states from service_role;
revoke delete on table public.sync_jobs from service_role;
revoke delete on table public.sync_runs from service_role;

comment on table public.sync_jobs is
  'Durable synchronization queue; service_role receives only the direct worker privileges required to claim and finish jobs.';
