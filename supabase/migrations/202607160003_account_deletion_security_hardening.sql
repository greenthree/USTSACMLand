-- Close account-deletion races and make audit anonymization complete for
-- former administrators whose Auth foreign keys are cleared during deletion.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.account_deletion_recovery_lease (
  singleton boolean primary key default true check (singleton),
  owner_token uuid not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  constraint account_deletion_recovery_lease_window check (expires_at > acquired_at)
);

revoke all on table private.account_deletion_recovery_lease from public, anon, authenticated;

create or replace function public.acquire_account_deletion_recovery_lease(
  p_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  acquired boolean;
  acquired_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_owner_token is null then
    raise exception 'Recovery lease owner token is required.' using errcode = '22023';
  end if;

  insert into private.account_deletion_recovery_lease (
    singleton,
    owner_token,
    acquired_at,
    expires_at
  ) values (
    true,
    p_owner_token,
    acquired_at,
    acquired_at + interval '5 minutes'
  )
  on conflict (singleton) do update
  set
    owner_token = excluded.owner_token,
    acquired_at = excluded.acquired_at,
    expires_at = excluded.expires_at
  where private.account_deletion_recovery_lease.expires_at <= pg_catalog.clock_timestamp()
    or private.account_deletion_recovery_lease.owner_token = excluded.owner_token
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

create or replace function public.release_account_deletion_recovery_lease(
  p_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released boolean;
begin
  if p_owner_token is null then
    return false;
  end if;

  delete from private.account_deletion_recovery_lease
  where owner_token = p_owner_token
  returning true into released;

  return coalesce(released, false);
end;
$$;

revoke all on function public.acquire_account_deletion_recovery_lease(uuid) from public;
revoke all on function public.release_account_deletion_recovery_lease(uuid) from public;
grant execute on function public.acquire_account_deletion_recovery_lease(uuid) to service_role;
grant execute on function public.release_account_deletion_recovery_lease(uuid) to service_role;

comment on function public.acquire_account_deletion_recovery_lease(uuid) is
  'Serializes the external recovery-floor write used by account deletion.';
comment on function public.release_account_deletion_recovery_lease(uuid) is
  'Releases the account-deletion recovery-floor lease held by the supplied token.';

create or replace function public.audit_json_contains_identifier(
  value jsonb,
  identifier text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_path_exists(
      value,
      '$.** ? (@ == $identifier)'::pg_catalog.jsonpath,
      pg_catalog.jsonb_build_object('identifier', identifier),
      true
    ),
    false
  )
$$;

revoke all on function public.audit_json_contains_identifier(jsonb, text) from public;

create or replace function public.scrub_account_deletion_audit(
  deleted_user_id uuid
)
returns void
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
  where log.actor_id = deleted_user_id
    or log.target_id = deleted_user_id::text
    or public.audit_json_contains_identifier(log.before_data, deleted_user_id::text)
    or public.audit_json_contains_identifier(log.after_data, deleted_user_id::text)
    or public.audit_json_contains_identifier(log.metadata, deleted_user_id::text);
end;
$$;

revoke all on function public.scrub_account_deletion_audit(uuid) from public;

create or replace function public.prepare_auth_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Clear Auth foreign keys before PostgreSQL's ON DELETE actions run. The
  -- generated profile/announcement audit rows are then included in the scrub
  -- below, regardless of constraint-trigger execution order.
  update public.announcements
  set
    created_by = case when created_by = old.id then null else created_by end,
    updated_by = case when updated_by = old.id then null else updated_by end
  where created_by = old.id or updated_by = old.id;

  update public.profiles
  set approved_by = null
  where approved_by = old.id;

  update public.sync_jobs
  set requested_by = null
  where requested_by = old.id;

  perform public.scrub_account_deletion_audit(old.id);
  return old;
end;
$$;

drop trigger if exists auth_users_a_prepare_account_deletion on auth.users;
create trigger auth_users_a_prepare_account_deletion
before delete on auth.users
for each row execute function public.prepare_auth_user_deletion();

revoke all on function public.prepare_auth_user_deletion() from public;

comment on function public.prepare_auth_user_deletion() is
  'Clears cross-account Auth references and removes deleted-user identifiers from all audit JSON.';

create or replace function public.anonymize_deleted_profile_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.scrub_account_deletion_audit(old.id);
  return old;
end;
$$;

create or replace function public.prevent_profile_delete_with_active_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.sync_jobs as job
    where job.profile_id = old.id
      and job.status in ('queued', 'running')
  ) then
    raise exception 'Account synchronization is active.' using errcode = '55006';
  end if;

  return old;
end;
$$;

drop trigger if exists profiles_a_prevent_delete_with_active_sync on public.profiles;
create trigger profiles_a_prevent_delete_with_active_sync
before delete on public.profiles
for each row execute function public.prevent_profile_delete_with_active_sync();

revoke all on function public.prevent_profile_delete_with_active_sync() from public;

comment on function public.prevent_profile_delete_with_active_sync() is
  'Provides the final database-level guard against deleting a profile while synchronization is queued or running.';
