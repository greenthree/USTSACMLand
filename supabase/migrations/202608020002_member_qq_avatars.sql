-- QQ avatars are fetched only by the Edge Function. Public consumers receive
-- an opaque member UUID path, never the private QQ number.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'member-avatars',
  'member-avatars',
  false,
  1048576,
  array['image/webp']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table private.member_avatar_cache (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  bucket_id text not null default 'member-avatars',
  object_key text not null unique,
  sha256 text not null,
  source_qq_sha256 text not null,
  synced_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint member_avatar_cache_bucket_fixed check (bucket_id = 'member-avatars'),
  constraint member_avatar_cache_object_key_scoped check (
    object_key like 'member/' || profile_id::text || '/%.webp'
    and object_key ~ '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
  ),
  constraint member_avatar_cache_sha256_valid check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint member_avatar_cache_source_qq_sha256_valid check (
    source_qq_sha256 ~ '^[a-f0-9]{64}$'
  )
);

create table private.member_avatar_sync_state (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  sync_owner_token uuid,
  sync_lease_expires_at timestamptz,
  uploads_frozen boolean not null default false,
  frozen_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint member_avatar_sync_state_lease_complete check (
    (sync_owner_token is null and sync_lease_expires_at is null)
    or (sync_owner_token is not null and sync_lease_expires_at is not null)
  ),
  constraint member_avatar_sync_state_frozen_timestamp check (
    (uploads_frozen and frozen_at is not null)
    or (not uploads_frozen and frozen_at is null)
  )
);

alter table private.member_avatar_cache enable row level security;
alter table private.member_avatar_sync_state enable row level security;

revoke all on table private.member_avatar_cache
from public, anon, authenticated, service_role;
revoke all on table private.member_avatar_sync_state
from public, anon, authenticated, service_role;

create function private.require_avatar_service_role()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Member avatar service role required.' using errcode = '42501';
  end if;
end;
$$;

create function public.begin_member_avatar_sync(
  requested_profile_id uuid,
  requested_owner_token uuid
)
returns table (
  profile_id uuid,
  qq text,
  object_key text,
  previous_object_key text,
  source_qq_sha256 text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  state private.member_avatar_sync_state%rowtype;
  profile_qq text;
  profile_qq_sha256 text;
  cached private.member_avatar_cache%rowtype;
begin
  perform private.require_avatar_service_role();
  if requested_profile_id is null or requested_owner_token is null then
    raise exception 'Avatar synchronization target and owner are required.' using errcode = '22023';
  end if;

  insert into private.member_avatar_sync_state (profile_id)
  values (requested_profile_id)
  on conflict on constraint member_avatar_sync_state_pkey do nothing;

  select candidate.* into state
  from private.member_avatar_sync_state as candidate
  where candidate.profile_id = requested_profile_id
  for update;

  if state.uploads_frozen then
    raise exception 'Avatar synchronization is frozen for account deletion.' using errcode = '55000';
  end if;
  if state.sync_owner_token is not null
    and state.sync_lease_expires_at > pg_catalog.clock_timestamp() then
    raise exception 'Avatar synchronization is already active.' using errcode = '55006';
  end if;

  select profile.qq into profile_qq
  from public.profiles as profile
  where profile.id = requested_profile_id
    and profile.review_status = 'approved'::public.profile_review_status
  for key share;
  if not found then
    raise exception 'Active member profile not found.' using errcode = 'P0002';
  end if;

  if profile_qq is not null then
    profile_qq_sha256 := pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(profile_qq, 'UTF8')),
      'hex'
    );
    select candidate.* into cached
    from private.member_avatar_cache as candidate
    where candidate.profile_id = requested_profile_id;
    if found
      and cached.source_qq_sha256 = profile_qq_sha256
      and cached.synced_at > pg_catalog.clock_timestamp() - interval '1 hour' then
      raise exception 'Avatar synchronization is cooling down.' using errcode = '55006';
    end if;
  else
    select candidate.* into cached
    from private.member_avatar_cache as candidate
    where candidate.profile_id = requested_profile_id;
  end if;

  update private.member_avatar_sync_state as target
  set
    sync_owner_token = requested_owner_token,
    sync_lease_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
    updated_at = pg_catalog.clock_timestamp()
  where target.profile_id = requested_profile_id;

  return query select
    requested_profile_id,
    profile_qq,
    'member/' || requested_profile_id::text || '/' || requested_owner_token::text || '.webp',
    cached.object_key,
    profile_qq_sha256;
end;
$$;

create function public.renew_member_avatar_sync(
  requested_profile_id uuid,
  requested_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  renewed_count integer;
begin
  perform private.require_avatar_service_role();
  update private.member_avatar_sync_state as state
  set
    sync_lease_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
    updated_at = pg_catalog.clock_timestamp()
  where state.profile_id = requested_profile_id
    and state.sync_owner_token = requested_owner_token
    and state.sync_lease_expires_at > pg_catalog.clock_timestamp()
    and not state.uploads_frozen;
  get diagnostics renewed_count = row_count;
  return renewed_count = 1;
end;
$$;

create function private.guard_member_avatar_object_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_profile_id uuid;
  key_owner_token uuid;
begin
  if new.bucket_id <> 'member-avatars' then
    return new;
  end if;

  if new.name !~ '^member/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$' then
    raise exception 'Member avatar object key is invalid.' using errcode = '23514';
  end if;

  key_profile_id := pg_catalog.split_part(new.name, '/', 2)::uuid;
  key_owner_token := pg_catalog.split_part(
    pg_catalog.split_part(new.name, '/', 3),
    '.',
    1
  )::uuid;

  -- This lock serializes Storage writes with the Auth deletion trigger. The
  -- upload either commits first and is observed by deletion, or waits until
  -- the member row has been deleted and is rejected.
  perform 1
  from public.profiles as profile
  where profile.id = key_profile_id
    and profile.review_status = 'approved'::public.profile_review_status
  for key share;
  if not found then
    raise exception 'Member avatar upload requires an active profile.' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from private.member_avatar_sync_state as state
    where state.profile_id = key_profile_id
      and state.sync_owner_token = key_owner_token
      and state.sync_lease_expires_at > pg_catalog.clock_timestamp()
      and not state.uploads_frozen
  ) then
    raise exception 'Member avatar upload lease is unavailable.' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_member_avatar_object_write()
from public, anon, authenticated, service_role;

drop trigger if exists objects_require_live_member_avatar_lease on storage.objects;
create trigger objects_require_live_member_avatar_lease
before insert or update on storage.objects
for each row execute function private.guard_member_avatar_object_write();

create function public.complete_member_avatar_sync(
  requested_profile_id uuid,
  requested_owner_token uuid,
  requested_object_key text,
  requested_sha256 text,
  requested_source_qq_sha256 text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  state private.member_avatar_sync_state%rowtype;
  completed_at timestamptz := pg_catalog.clock_timestamp();
  current_qq text;
  current_qq_sha256 text;
begin
  perform private.require_avatar_service_role();
  if requested_object_key is distinct from
      'member/' || requested_profile_id::text || '/' || requested_owner_token::text || '.webp'
    or requested_sha256 !~ '^[a-f0-9]{64}$'
    or requested_source_qq_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Avatar synchronization result is invalid.' using errcode = '22023';
  end if;

  select candidate.* into state
  from private.member_avatar_sync_state as candidate
  where candidate.profile_id = requested_profile_id
  for update;
  if not found
    or state.uploads_frozen
    or state.sync_owner_token is distinct from requested_owner_token
    or state.sync_lease_expires_at <= completed_at then
    raise exception 'Avatar synchronization lease is unavailable.' using errcode = '55000';
  end if;

  select profile.qq into current_qq
  from public.profiles as profile
  where profile.id = requested_profile_id
    and profile.review_status = 'approved'::public.profile_review_status
  for key share;
  if not found or current_qq is null then
    raise exception 'Avatar synchronization source changed.' using errcode = '55000';
  end if;
  current_qq_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(current_qq, 'UTF8')),
    'hex'
  );
  if current_qq_sha256 is distinct from requested_source_qq_sha256 then
    raise exception 'Avatar synchronization source changed.' using errcode = '55000';
  end if;

  update storage.objects as object
  set
    owner = requested_profile_id,
    owner_id = requested_profile_id::text,
    updated_at = completed_at
  where object.bucket_id = 'member-avatars'
    and object.name = requested_object_key
    and coalesce(object.metadata ->> 'mimetype', '') = 'image/webp';
  if not found then
    raise exception 'Normalized avatar object was not found.' using errcode = 'P0002';
  end if;

  insert into private.member_avatar_cache (
    profile_id,
    object_key,
    sha256,
    source_qq_sha256,
    synced_at,
    updated_at
  ) values (
    requested_profile_id,
    requested_object_key,
    requested_sha256,
    requested_source_qq_sha256,
    completed_at,
    completed_at
  )
  on conflict (profile_id) do update
  set
    object_key = excluded.object_key,
    sha256 = excluded.sha256,
    source_qq_sha256 = excluded.source_qq_sha256,
    synced_at = excluded.synced_at,
    updated_at = excluded.updated_at;

  update private.member_avatar_sync_state as target
  set
    sync_owner_token = null,
    sync_lease_expires_at = null,
    updated_at = completed_at
  where target.profile_id = requested_profile_id;
  return completed_at;
end;
$$;

create function public.complete_member_avatar_removal(
  requested_profile_id uuid,
  requested_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  state private.member_avatar_sync_state%rowtype;
begin
  perform private.require_avatar_service_role();
  select candidate.* into state
  from private.member_avatar_sync_state as candidate
  where candidate.profile_id = requested_profile_id
  for update;
  if not found
    or state.uploads_frozen
    or state.sync_owner_token is distinct from requested_owner_token
    or state.sync_lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'Avatar synchronization lease is unavailable.' using errcode = '55000';
  end if;

  perform 1
  from public.profiles as profile
  where profile.id = requested_profile_id
    and profile.review_status = 'approved'::public.profile_review_status
    and profile.qq is null
  for key share;
  if not found then
    raise exception 'Avatar synchronization source changed.' using errcode = '55000';
  end if;

  delete from private.member_avatar_cache as cache
  where cache.profile_id = requested_profile_id;
  update private.member_avatar_sync_state as target
  set
    sync_owner_token = null,
    sync_lease_expires_at = null,
    updated_at = pg_catalog.clock_timestamp()
  where target.profile_id = requested_profile_id;
  return true;
end;
$$;

create function public.fail_member_avatar_sync(
  requested_profile_id uuid,
  requested_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_count integer;
begin
  perform private.require_avatar_service_role();
  update private.member_avatar_sync_state as state
  set
    sync_owner_token = null,
    sync_lease_expires_at = null,
    updated_at = pg_catalog.clock_timestamp()
  where state.profile_id = requested_profile_id
    and state.sync_owner_token = requested_owner_token;
  get diagnostics released_count = row_count;
  return released_count = 1;
end;
$$;

create function public.prepare_member_avatar_account_deletion(
  requested_profile_id uuid
)
returns table (
  ready boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  state private.member_avatar_sync_state%rowtype;
begin
  perform private.require_avatar_service_role();
  if requested_profile_id is null then
    raise exception 'Avatar deletion target is required.' using errcode = '22023';
  end if;

  insert into private.member_avatar_sync_state (profile_id)
  values (requested_profile_id)
  on conflict on constraint member_avatar_sync_state_pkey do nothing;
  select candidate.* into state
  from private.member_avatar_sync_state as candidate
  where candidate.profile_id = requested_profile_id
  for update;

  if exists (
    select 1
    from private.webchat_image_attachments as attachment
    where attachment.user_id = requested_profile_id
      and attachment.status <> 'deleted'
  ) or (
    state.sync_owner_token is not null
    and state.sync_lease_expires_at > pg_catalog.clock_timestamp()
  ) then
    return query select false;
    return;
  end if;

  update private.member_avatar_sync_state as target
  set
    uploads_frozen = true,
    frozen_at = coalesce(target.frozen_at, pg_catalog.clock_timestamp()),
    sync_owner_token = null,
    sync_lease_expires_at = null,
    updated_at = pg_catalog.clock_timestamp()
  where target.profile_id = requested_profile_id;

  return query select true;
end;
$$;

create function public.cancel_member_avatar_account_deletion(
  requested_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  thawed_count integer;
begin
  perform private.require_avatar_service_role();
  update private.member_avatar_sync_state as state
  set
    uploads_frozen = false,
    frozen_at = null,
    updated_at = pg_catalog.clock_timestamp()
  where state.profile_id = requested_profile_id
    and state.uploads_frozen;
  get diagnostics thawed_count = row_count;
  return thawed_count = 1;
end;
$$;

revoke all on function private.require_avatar_service_role()
from public, anon, authenticated, service_role;
revoke all on function public.begin_member_avatar_sync(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.renew_member_avatar_sync(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.complete_member_avatar_sync(uuid, uuid, text, text, text)
from public, anon, authenticated;
revoke all on function public.complete_member_avatar_removal(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.fail_member_avatar_sync(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.prepare_member_avatar_account_deletion(uuid)
from public, anon, authenticated;
revoke all on function public.cancel_member_avatar_account_deletion(uuid)
from public, anon, authenticated;

grant execute on function public.begin_member_avatar_sync(uuid, uuid) to service_role;
grant execute on function public.renew_member_avatar_sync(uuid, uuid) to service_role;
grant execute on function public.complete_member_avatar_sync(uuid, uuid, text, text, text)
to service_role;
grant execute on function public.complete_member_avatar_removal(uuid, uuid) to service_role;
grant execute on function public.fail_member_avatar_sync(uuid, uuid) to service_role;
grant execute on function public.prepare_member_avatar_account_deletion(uuid) to service_role;
grant execute on function public.cancel_member_avatar_account_deletion(uuid) to service_role;

create or replace function private.require_empty_storage_before_auth_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialize Auth deletion with member-avatar writes. The Storage trigger
  -- takes a key-share lock on the same row before accepting an upload.
  perform 1
  from public.profiles as profile
  where profile.id = old.id
  for update;

  if exists (
    select 1
    from storage.objects as object
    where object.owner = old.id
      or object.owner_id = old.id::text
      or (
        object.bucket_id = 'member-avatars'
        and object.name like 'member/' || old.id::text || '/%'
      )
  ) then
    raise exception 'Auth user deletion is blocked while Storage objects remain.'
      using errcode = '55006';
  end if;

  return old;
end;
$$;

revoke all on function private.require_empty_storage_before_auth_user_deletion()
from public, anon, authenticated, service_role;

create or replace view public.public_members
with (security_barrier = true)
as
select
  profile.id,
  profile.full_name,
  profile.major,
  profile.created_at,
  profile.updated_at,
  profile.grade,
  avatar.object_key as avatar_path,
  avatar.updated_at as avatar_updated_at
from public.profiles as profile
left join private.member_avatar_cache as avatar on avatar.profile_id = profile.id
where profile.review_status = 'approved'
  and profile.is_public
  and profile.full_name is not null
  and profile.major is not null
  and profile.grade is not null;

grant select on public.public_members to anon, authenticated;

comment on table private.member_avatar_cache is
  'Private QQ-avatar cache metadata. Public consumers receive only an opaque versioned object path.';
comment on table private.member_avatar_sync_state is
  'Serializes avatar writes and freezes them before account deletion.';
comment on view public.public_members is
  'Public fields for active members, plus an opaque cached-avatar path; excludes QQ and internal state.';
