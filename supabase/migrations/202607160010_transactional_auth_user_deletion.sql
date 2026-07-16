-- Fence the irreversible Auth deletion with a target-bound recovery-floor
-- lease row lock. The lock remains held until the Auth cascade commits or
-- rolls back, so Edge runtime timer suspension cannot allow another deletion
-- to take over midway.

alter table private.account_deletion_recovery_lease
  add column if not exists target_user_id uuid;

-- Legacy leases do not identify a deletion target and therefore cannot be
-- safely upgraded. Consume them before making the target binding mandatory.
-- A caller using the old RPC signatures will fail closed and must restart the
-- recovery-floor flow after the new Edge Function is deployed.
delete from private.account_deletion_recovery_lease
where target_user_id is null;

alter table private.account_deletion_recovery_lease
  alter column target_user_id set not null;

drop function if exists public.acquire_account_deletion_recovery_lease(uuid);
drop function if exists public.renew_account_deletion_recovery_lease(uuid);
drop function if exists public.release_account_deletion_recovery_lease(uuid);

create or replace function public.acquire_account_deletion_recovery_lease(
  p_owner_token uuid,
  p_target_user_id uuid
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
  if p_owner_token is null or p_target_user_id is null then
    raise exception 'Recovery lease owner and target user are required.' using errcode = '22023';
  end if;

  insert into private.account_deletion_recovery_lease (
    singleton,
    owner_token,
    target_user_id,
    acquired_at,
    expires_at
  ) values (
    true,
    p_owner_token,
    p_target_user_id,
    acquired_at,
    acquired_at + interval '5 minutes'
  )
  on conflict (singleton) do update
  set
    owner_token = excluded.owner_token,
    target_user_id = excluded.target_user_id,
    acquired_at = excluded.acquired_at,
    expires_at = excluded.expires_at
  where private.account_deletion_recovery_lease.expires_at <= pg_catalog.clock_timestamp()
    or (
      private.account_deletion_recovery_lease.owner_token = excluded.owner_token
      and private.account_deletion_recovery_lease.target_user_id = excluded.target_user_id
    )
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

create or replace function public.renew_account_deletion_recovery_lease(
  p_owner_token uuid,
  p_target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  renewed boolean;
begin
  if p_owner_token is null or p_target_user_id is null then
    return false;
  end if;

  update private.account_deletion_recovery_lease
  set expires_at = pg_catalog.clock_timestamp() + interval '5 minutes'
  where owner_token = p_owner_token
    and target_user_id = p_target_user_id
    and expires_at > pg_catalog.clock_timestamp()
  returning true into renewed;

  return coalesce(renewed, false);
end;
$$;

create or replace function public.release_account_deletion_recovery_lease(
  p_owner_token uuid,
  p_target_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released boolean;
begin
  if p_owner_token is null or p_target_user_id is null then
    return false;
  end if;

  delete from private.account_deletion_recovery_lease
  where owner_token = p_owner_token
    and target_user_id = p_target_user_id
  returning true into released;

  return coalesce(released, false);
end;
$$;

revoke all on function public.acquire_account_deletion_recovery_lease(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.renew_account_deletion_recovery_lease(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.release_account_deletion_recovery_lease(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.acquire_account_deletion_recovery_lease(uuid, uuid)
to service_role;
grant execute on function public.renew_account_deletion_recovery_lease(uuid, uuid)
to service_role;
grant execute on function public.release_account_deletion_recovery_lease(uuid, uuid)
to service_role;

-- Reject Auth deletion paths that do not originate inside the fenced RPC.
-- This is also the deployment cutover barrier: an invocation of the previous
-- Edge Function that already renewed a legacy lease can still reach GoTrue
-- after this migration commits, but its database delete has no transaction-
-- local owner/target markers and therefore fails before any cleanup trigger.
create or replace function private.require_fenced_auth_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fence_owner text := pg_catalog.current_setting(
    'app.account_deletion_owner_token',
    true
  );
  fence_target text := pg_catalog.current_setting(
    'app.account_deletion_target_user_id',
    true
  );
begin
  if fence_owner is null
    or fence_target is distinct from old.id::text
    or not exists (
      select 1
      from private.account_deletion_recovery_lease as lease
      where lease.singleton
        and lease.owner_token::text = fence_owner
        and lease.target_user_id = old.id
        and lease.expires_at > pg_catalog.clock_timestamp()
    ) then
    raise exception 'Auth user deletion requires a fenced recovery lease.'
      using errcode = '42501';
  end if;

  return old;
end;
$$;

revoke all on function private.require_fenced_auth_user_deletion()
from public, anon, authenticated;

drop trigger if exists auth_users_0_require_fenced_deletion on auth.users;
create trigger auth_users_0_require_fenced_deletion
before delete on auth.users
for each row execute function private.require_fenced_auth_user_deletion();

create or replace function public.delete_auth_user_with_recovery_lease(
  p_owner_token uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease private.account_deletion_recovery_lease%rowtype;
  profile_role public.app_role;
  deleted_count integer := 0;
begin
  if p_owner_token is null or p_user_id is null then
    raise exception 'Recovery lease owner and Auth user are required.' using errcode = '22023';
  end if;

  select * into lease
  from private.account_deletion_recovery_lease
  where singleton
  for update;

  if not found
    or lease.owner_token is distinct from p_owner_token
    or lease.target_user_id is distinct from p_user_id
    or lease.expires_at <= pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object(
      'leaseOwned', false,
      'deleted', false
    );
  end if;

  select role into profile_role
  from public.profiles
  where id = p_user_id
  for update;

  if not found
    or profile_role = 'admin'::public.app_role
    or exists (
      select 1
      from public.sync_jobs
      where profile_id = p_user_id
        and status in ('queued', 'running')
    ) then
    return pg_catalog.jsonb_build_object(
      'leaseOwned', true,
      'deleted', false
    );
  end if;

  begin
    perform pg_catalog.set_config(
      'app.account_deletion_owner_token',
      p_owner_token::text,
      true
    );
    perform pg_catalog.set_config(
      'app.account_deletion_target_user_id',
      p_user_id::text,
      true
    );
    delete from auth.users where id = p_user_id;
    get diagnostics deleted_count = row_count;
  exception
    when foreign_key_violation or restrict_violation or insufficient_privilege or object_in_use then
      return pg_catalog.jsonb_build_object(
        'leaseOwned', true,
        'deleted', false
      );
  end;

  if deleted_count = 1 then
    delete from private.account_deletion_recovery_lease
    where singleton
      and owner_token = p_owner_token
      and target_user_id = p_user_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'leaseOwned', true,
    'deleted', deleted_count = 1
  );
end;
$$;

revoke all on function public.delete_auth_user_with_recovery_lease(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.delete_auth_user_with_recovery_lease(uuid, uuid)
to service_role;

comment on function public.delete_auth_user_with_recovery_lease(uuid, uuid) is
  'Locks the target profile and recovery lease, marks the transaction as fenced, then atomically deletes one non-admin Auth user with no active synchronization.';
