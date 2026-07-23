create or replace function private.require_live_auth_user_for_storage_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
  owner_id_is_uuid boolean := false;
begin
  if new.owner_id is not null then
    begin
      target_user_id := new.owner_id::uuid;
      owner_id_is_uuid := true;
    exception
      when invalid_text_representation then
        -- Storage also supports third-party JWT subjects, which are stored in
        -- owner_id without a UUID owner. They are outside the Auth-user fence.
        target_user_id := null;
    end;
  end if;

  if new.owner is not null then
    if new.owner_id is not null and not owner_id_is_uuid then
      raise exception 'Storage object ownership columns must reference the same Auth user.'
        using errcode = '23514';
    end if;
    if target_user_id is not null and target_user_id <> new.owner then
      raise exception 'Storage object ownership columns must reference the same Auth user.'
        using errcode = '23514';
    end if;
    target_user_id := new.owner;
  end if;

  if target_user_id is null then
    return new;
  end if;

  -- This key-share lock conflicts with Auth deletion. If an upload wins, the
  -- deleter waits and then observes the committed object; if deletion wins,
  -- the uploader waits and then finds no Auth user to own the object.
  perform 1
  from auth.users
  where id = target_user_id
  for key share;

  if not found then
    raise exception 'Storage object ownership requires a live Auth user.'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

revoke all on function private.require_live_auth_user_for_storage_ownership()
from public, anon, authenticated, service_role;

drop trigger if exists objects_require_live_auth_owner on storage.objects;
create trigger objects_require_live_auth_owner
before insert or update of owner, owner_id on storage.objects
for each row execute function private.require_live_auth_user_for_storage_ownership();

create or replace function private.require_empty_storage_before_auth_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from storage.objects as object
    where object.owner = old.id
      or object.owner_id = old.id::text
  ) then
    raise exception 'Auth user deletion is blocked while Storage objects remain.'
      using errcode = '55006';
  end if;

  return old;
end;
$$;

revoke all on function private.require_empty_storage_before_auth_user_deletion()
from public, anon, authenticated, service_role;

drop trigger if exists auth_users_5_require_empty_storage on auth.users;
create trigger auth_users_5_require_empty_storage
before delete on auth.users
for each row execute function private.require_empty_storage_before_auth_user_deletion();

comment on function private.require_empty_storage_before_auth_user_deletion() is
  'Prevents fenced Auth deletion from orphaning Storage objects recorded through either ownership column; Storage writes lock the same Auth row first.';
