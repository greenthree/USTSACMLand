-- Make member account deletion deterministic and remove personal data from the
-- append-only audit trail while preserving an anonymous operational event.

alter table public.stat_snapshots
drop constraint stat_snapshots_sync_run_id_fkey;

alter table public.stat_snapshots
add constraint stat_snapshots_sync_run_id_fkey
foreign key (sync_run_id) references public.sync_runs (id) on delete cascade;

create or replace function public.anonymize_deleted_profile_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.audit_logs as log
  set
    actor_id = null,
    target_id = null,
    before_data = null,
    after_data = null,
    metadata = pg_catalog.jsonb_build_object('anonymized', 'account_deletion')
  where log.actor_id = old.id
    or log.target_id = old.id::text
    or coalesce(log.before_data, '{}'::jsonb)
      @> pg_catalog.jsonb_build_object('profile_id', old.id)
    or coalesce(log.after_data, '{}'::jsonb)
      @> pg_catalog.jsonb_build_object('profile_id', old.id)
    or coalesce(log.metadata, '{}'::jsonb)
      @> pg_catalog.jsonb_build_object('profile_id', old.id);

  return old;
end;
$$;

create or replace function public.anonymize_cascaded_platform_account_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles as profile where profile.id = old.profile_id
  ) then
    update public.audit_logs as log
    set
      actor_id = null,
      target_id = null,
      before_data = null,
      after_data = null,
      metadata = pg_catalog.jsonb_build_object('anonymized', 'account_deletion')
    where log.target_table = 'platform_accounts'
      and log.target_id = old.id::text;
  end if;

  return old;
end;
$$;

drop trigger if exists profiles_z_anonymize_deleted_audit on public.profiles;
create trigger profiles_z_anonymize_deleted_audit
after delete on public.profiles
for each row execute function public.anonymize_deleted_profile_audit();

drop trigger if exists platform_accounts_z_anonymize_cascade_audit
  on public.platform_accounts;
create trigger platform_accounts_z_anonymize_cascade_audit
after delete on public.platform_accounts
for each row execute function public.anonymize_cascaded_platform_account_audit();

revoke all on function public.anonymize_deleted_profile_audit() from public;
revoke all on function public.anonymize_cascaded_platform_account_audit() from public;

comment on function public.anonymize_deleted_profile_audit() is
  'Removes profile IDs and personal fields from audit rows during hard account deletion.';
comment on function public.anonymize_cascaded_platform_account_audit() is
  'Anonymizes platform-account audit rows created by profile deletion cascades.';
