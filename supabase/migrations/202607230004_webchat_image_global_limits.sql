-- Site-wide WebChat image abuse controls. Reuse the established WebChat quota
-- singleton so every global/account mutation keeps one global-first lock order.
-- The image path installs paused and requires an explicit operational enable.

alter table private.webchat_global_quota_state
  add column image_uploads_paused boolean not null default true,
  add column image_hourly_attachment_limit integer not null default 120,
  add column image_hourly_original_bytes_limit bigint not null default 268435456,
  add column image_storage_capacity_bytes bigint not null default 536870912,
  add column image_storage_allocated_bytes bigint not null default 0,
  add column image_max_active_validations integer not null default 2;

alter table private.webchat_image_attachments
  add column storage_allocation_bytes bigint not null default 0;

-- A validating worker may create a maximum-size object. Existing rows are
-- conservatively backfilled before constraints and the global counter are set.
update private.webchat_image_attachments as attachment
set storage_allocation_bytes = case
  when attachment.status in ('ready', 'attached') then attachment.object_bytes
  when attachment.status in ('validating', 'failed', 'deleting')
    then coalesce(attachment.object_bytes, 4194304)
  else 0
end;

update private.webchat_global_quota_state as global_state
set
  image_storage_allocated_bytes = allocation.total_bytes,
  image_storage_capacity_bytes = greatest(
    global_state.image_storage_capacity_bytes,
    allocation.total_bytes
  ),
  updated_at = pg_catalog.clock_timestamp()
from (
  select coalesce(pg_catalog.sum(attachment.storage_allocation_bytes), 0)::bigint as total_bytes
  from private.webchat_image_attachments as attachment
) as allocation
where global_state.singleton;

alter table private.webchat_global_quota_state
  add constraint webchat_global_quota_image_hourly_attachment_valid check (
    image_hourly_attachment_limit between 1 and 10000
  ),
  add constraint webchat_global_quota_image_hourly_bytes_valid check (
    image_hourly_original_bytes_limit between 1 and 1099511627776
  ),
  add constraint webchat_global_quota_image_capacity_valid check (
    image_storage_capacity_bytes between 1 and 1099511627776
  ),
  add constraint webchat_global_quota_image_allocated_valid check (
    image_storage_allocated_bytes between 0 and image_storage_capacity_bytes
  ),
  add constraint webchat_global_quota_image_concurrency_valid check (
    image_max_active_validations between 1 and 100
  );

alter table private.webchat_image_attachments
  add constraint webchat_image_attachments_storage_allocation_valid check (
    storage_allocation_bytes between 0 and 4194304
  );

create index webchat_image_attachments_global_reserved_at_idx
  on private.webchat_image_attachments (reserved_at desc)
  include (original_bytes);

create index webchat_image_attachments_active_validation_idx
  on private.webchat_image_attachments (validation_lease_expires_at, id)
  where status = 'validating';

create index webchat_image_attachments_storage_allocation_idx
  on private.webchat_image_attachments (id)
  include (storage_allocation_bytes)
  where storage_allocation_bytes > 0;

-- Keep the proven account/conversation state machines behind global wrappers.
-- Each outer RPC holds the quota singleton lock for its complete inner call.
alter function public.reserve_webchat_image_attachment(uuid, uuid, uuid, text, bigint)
  rename to reserve_webchat_image_attachment_without_global_limits;
alter function public.reserve_webchat_image_attachment_without_global_limits(uuid, uuid, uuid, text, bigint)
  set schema private;

alter function public.start_webchat_image_validation(uuid, uuid, uuid, integer)
  rename to start_webchat_image_validation_without_global_limits;
alter function public.start_webchat_image_validation_without_global_limits(uuid, uuid, uuid, integer)
  set schema private;

alter function public.renew_webchat_image_validation(uuid, uuid, uuid, integer)
  rename to renew_webchat_image_validation_without_global_limits;
alter function public.renew_webchat_image_validation_without_global_limits(uuid, uuid, uuid, integer)
  set schema private;

alter function public.complete_webchat_image_validation(uuid, uuid, uuid, bigint, integer, integer, text)
  rename to complete_webchat_image_validation_without_global_limits;
alter function public.complete_webchat_image_validation_without_global_limits(uuid, uuid, uuid, bigint, integer, integer, text)
  set schema private;

alter function public.fail_webchat_image_validation(uuid, uuid, uuid, text)
  rename to fail_webchat_image_validation_without_global_limits;
alter function public.fail_webchat_image_validation_without_global_limits(uuid, uuid, uuid, text)
  set schema private;

alter function public.complete_webchat_image_deletion(uuid, uuid)
  rename to complete_webchat_image_deletion_without_global_limits;
alter function public.complete_webchat_image_deletion_without_global_limits(uuid, uuid)
  set schema private;

create function public.reserve_webchat_image_attachment(
  requested_user_id uuid,
  requested_conversation_id uuid,
  requested_attachment_id uuid,
  requested_original_mime text,
  requested_original_bytes bigint
)
returns table (
  id uuid,
  status text,
  bucket_id text,
  object_key text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  global_state private.webchat_global_quota_state%rowtype;
  checked_at timestamptz;
  recent_attachment_count integer;
  recent_original_bytes bigint;
begin
  if requested_user_id is null
    or requested_conversation_id is null
    or requested_attachment_id is null
    or pg_catalog.lower(pg_catalog.btrim(requested_original_mime))
      not in ('image/jpeg', 'image/png', 'image/webp')
    or requested_original_bytes not between 1 and 4194304 then
    raise exception 'WebChat image reservation is invalid.' using errcode = '22023';
  end if;

  select state.* into global_state
  from private.webchat_global_quota_state as state
  where state.singleton
  for update;
  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;
  checked_at := pg_catalog.clock_timestamp();

  -- An exact retry creates no new work and remains safe while uploads are paused.
  perform 1
  from private.webchat_image_attachments as attachment
  where attachment.id = requested_attachment_id;
  if found then
    return query
    select result.id, result.status, result.bucket_id, result.object_key, result.expires_at
    from private.reserve_webchat_image_attachment_without_global_limits(
      requested_user_id,
      requested_conversation_id,
      requested_attachment_id,
      requested_original_mime,
      requested_original_bytes
    ) as result;
    return;
  end if;

  if global_state.image_uploads_paused then
    raise exception 'WebChat image uploads are globally paused.' using errcode = '55000';
  end if;

  select
    pg_catalog.count(*)::integer,
    coalesce(pg_catalog.sum(attachment.original_bytes), 0)::bigint
  into recent_attachment_count, recent_original_bytes
  from private.webchat_image_attachments as attachment
  where attachment.reserved_at > checked_at - interval '1 hour';

  if recent_attachment_count >= global_state.image_hourly_attachment_limit then
    raise exception 'WebChat global image upload rate limit reached.' using errcode = '54000';
  end if;
  if recent_original_bytes + requested_original_bytes
    > global_state.image_hourly_original_bytes_limit then
    raise exception 'WebChat global image upload byte budget reached.' using errcode = '54000';
  end if;

  return query
  select result.id, result.status, result.bucket_id, result.object_key, result.expires_at
  from private.reserve_webchat_image_attachment_without_global_limits(
    requested_user_id,
    requested_conversation_id,
    requested_attachment_id,
    requested_original_mime,
    requested_original_bytes
  ) as result;
end;
$$;

create function public.start_webchat_image_validation(
  requested_user_id uuid,
  requested_attachment_id uuid,
  requested_owner_token uuid,
  requested_lease_seconds integer default 300
)
returns table (
  status text,
  bucket_id text,
  object_key text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  global_state private.webchat_global_quota_state%rowtype;
  attachment private.webchat_image_attachments%rowtype;
  checked_at timestamptz;
  active_validation_count integer;
  allocation_delta bigint := 0;
  result_status text;
  result_bucket_id text;
  result_object_key text;
  result_expires_at timestamptz;
begin
  select state.* into global_state
  from private.webchat_global_quota_state as state
  where state.singleton
  for update;
  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;
  checked_at := pg_catalog.clock_timestamp();

  select candidate.* into attachment
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
    and candidate.user_id = requested_user_id;

  if found and attachment.status not in ('ready', 'attached') then
    if global_state.image_uploads_paused then
      raise exception 'WebChat image uploads are globally paused.' using errcode = '55000';
    end if;

    if attachment.status in ('reserved', 'validating') then
      select pg_catalog.count(*)::integer into active_validation_count
      from private.webchat_image_attachments as candidate
      where candidate.status = 'validating'
        and candidate.validation_lease_expires_at > checked_at
        and candidate.id <> requested_attachment_id;

      if active_validation_count >= global_state.image_max_active_validations then
        raise exception 'WebChat global image validation concurrency limit reached.'
          using errcode = '54000';
      end if;

      allocation_delta := greatest(4194304 - attachment.storage_allocation_bytes, 0);
      if global_state.image_storage_allocated_bytes + allocation_delta
        > global_state.image_storage_capacity_bytes then
        raise exception 'WebChat global image Storage capacity reached.' using errcode = '54000';
      end if;
    end if;
  end if;

  select result.status, result.bucket_id, result.object_key, result.expires_at
  into result_status, result_bucket_id, result_object_key, result_expires_at
  from private.start_webchat_image_validation_without_global_limits(
    requested_user_id,
    requested_attachment_id,
    requested_owner_token,
    requested_lease_seconds
  ) as result;

  if result_status = 'validating' and allocation_delta > 0 then
    update private.webchat_image_attachments as target
    set
      storage_allocation_bytes = target.storage_allocation_bytes + allocation_delta,
      updated_at = checked_at
    where target.id = requested_attachment_id;

    update private.webchat_global_quota_state as state
    set
      image_storage_allocated_bytes = state.image_storage_allocated_bytes + allocation_delta,
      updated_at = checked_at
    where state.singleton;
  end if;

  return query
  select result_status, result_bucket_id, result_object_key, result_expires_at;
end;
$$;

create function public.renew_webchat_image_validation(
  requested_user_id uuid,
  requested_attachment_id uuid,
  requested_owner_token uuid,
  requested_lease_seconds integer default 600
)
returns table (
  status text,
  bucket_id text,
  object_key text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  global_state private.webchat_global_quota_state%rowtype;
  attachment private.webchat_image_attachments%rowtype;
  checked_at timestamptz;
begin
  select state.* into global_state
  from private.webchat_global_quota_state as state
  where state.singleton
  for update;
  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;
  checked_at := pg_catalog.clock_timestamp();

  if global_state.image_uploads_paused then
    raise exception 'WebChat image uploads are globally paused.' using errcode = '55000';
  end if;

  select candidate.* into attachment
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
    and candidate.user_id = requested_user_id
  for update;
  if not found
    or attachment.status <> 'validating'
    or attachment.validation_owner_token is distinct from requested_owner_token
    or attachment.validation_lease_expires_at <= checked_at
    or attachment.expires_at <= checked_at then
    raise exception 'WebChat image validation lease is unavailable.' using errcode = '55000';
  end if;

  return query
  select result.status, result.bucket_id, result.object_key, result.expires_at
  from private.renew_webchat_image_validation_without_global_limits(
    requested_user_id,
    requested_attachment_id,
    requested_owner_token,
    requested_lease_seconds
  ) as result;
end;
$$;

create function public.complete_webchat_image_validation(
  requested_user_id uuid,
  requested_attachment_id uuid,
  requested_owner_token uuid,
  requested_object_bytes bigint,
  requested_width integer,
  requested_height integer,
  requested_sha256 text
)
returns table (
  id uuid,
  status text,
  media_type text,
  object_bytes bigint,
  width integer,
  height integer,
  sha256 text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  global_state private.webchat_global_quota_state%rowtype;
  attachment private.webchat_image_attachments%rowtype;
  previous_allocation bigint := 0;
  next_allocation bigint;
  result_id uuid;
  result_status text;
  result_media_type text;
  result_object_bytes bigint;
  result_width integer;
  result_height integer;
  result_sha256 text;
  checked_at timestamptz;
begin
  select state.* into global_state
  from private.webchat_global_quota_state as state
  where state.singleton
  for update;
  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;
  checked_at := pg_catalog.clock_timestamp();

  select candidate.* into attachment
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
    and candidate.user_id = requested_user_id;
  if found then
    previous_allocation := attachment.storage_allocation_bytes;
  end if;

  if requested_object_bytes between 1 and 4194304 then
    next_allocation := requested_object_bytes;
    if global_state.image_storage_allocated_bytes < previous_allocation then
      raise exception 'WebChat image Storage accounting is inconsistent.' using errcode = '55000';
    end if;
    if global_state.image_storage_allocated_bytes - previous_allocation + next_allocation
      > global_state.image_storage_capacity_bytes then
      raise exception 'WebChat global image Storage capacity reached.' using errcode = '54000';
    end if;
  end if;

  select
    result.id,
    result.status,
    result.media_type,
    result.object_bytes,
    result.width,
    result.height,
    result.sha256
  into
    result_id,
    result_status,
    result_media_type,
    result_object_bytes,
    result_width,
    result_height,
    result_sha256
  from private.complete_webchat_image_validation_without_global_limits(
    requested_user_id,
    requested_attachment_id,
    requested_owner_token,
    requested_object_bytes,
    requested_width,
    requested_height,
    requested_sha256
  ) as result;

  next_allocation := result_object_bytes;
  if previous_allocation is distinct from next_allocation then
    update private.webchat_image_attachments as target
    set
      storage_allocation_bytes = next_allocation,
      updated_at = checked_at
    where target.id = requested_attachment_id;

    update private.webchat_global_quota_state as state
    set
      image_storage_allocated_bytes =
        state.image_storage_allocated_bytes - previous_allocation + next_allocation,
      updated_at = checked_at
    where state.singleton;
  end if;

  return query
  select
    result_id,
    result_status,
    result_media_type,
    result_object_bytes,
    result_width,
    result_height,
    result_sha256;
end;
$$;

create function public.fail_webchat_image_validation(
  requested_user_id uuid,
  requested_attachment_id uuid,
  requested_owner_token uuid,
  requested_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  transitioned boolean;
begin
  perform 1
  from private.webchat_global_quota_state as state
  where state.singleton
  for update;
  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;

  transitioned := private.fail_webchat_image_validation_without_global_limits(
    requested_user_id,
    requested_attachment_id,
    requested_owner_token,
    requested_error_code
  );

  update private.webchat_global_quota_state as state
  set updated_at = pg_catalog.clock_timestamp()
  where state.singleton;
  return transitioned;
end;
$$;

create function public.complete_webchat_image_deletion(
  requested_attachment_id uuid,
  requested_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  global_state private.webchat_global_quota_state%rowtype;
  previous_allocation bigint := 0;
  completed boolean;
  accounting_drift boolean := false;
  checked_at timestamptz;
begin
  select state.* into global_state
  from private.webchat_global_quota_state as state
  where state.singleton
  for update;
  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;
  checked_at := pg_catalog.clock_timestamp();

  select attachment.storage_allocation_bytes into previous_allocation
  from private.webchat_image_attachments as attachment
  where attachment.id = requested_attachment_id;
  previous_allocation := coalesce(previous_allocation, 0);

  completed := private.complete_webchat_image_deletion_without_global_limits(
    requested_attachment_id,
    requested_owner_token
  );
  if not completed then
    return false;
  end if;

  update private.webchat_image_attachments as attachment
  set
    storage_allocation_bytes = 0,
    updated_at = checked_at
  where attachment.id = requested_attachment_id
    and attachment.status = 'deleted';

  accounting_drift := global_state.image_storage_allocated_bytes < previous_allocation;
  update private.webchat_global_quota_state as state
  set
    image_storage_allocated_bytes = greatest(
      state.image_storage_allocated_bytes - previous_allocation,
      0
    ),
    image_uploads_paused = state.image_uploads_paused or accounting_drift,
    updated_at = checked_at
  where state.singleton;
  return true;
end;
$$;

create function public.reconcile_webchat_image_storage_accounting()
returns table (
  recorded_allocation_bytes bigint,
  attachment_allocation_bytes bigint,
  stored_object_bytes bigint,
  orphan_object_count integer,
  missing_ready_object_count integer,
  accounting_consistent boolean,
  uploads_paused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  global_state private.webchat_global_quota_state%rowtype;
  expected_bytes bigint;
  actual_bytes bigint;
  orphan_count integer;
  missing_count integer;
  metadata_invalid_count integer;
  consistent boolean;
begin
  select state.* into global_state
  from private.webchat_global_quota_state as state
  where state.singleton
  for update;
  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;

  select coalesce(pg_catalog.sum(attachment.storage_allocation_bytes), 0)::bigint
  into expected_bytes
  from private.webchat_image_attachments as attachment;

  select
    coalesce(pg_catalog.sum(
      case
        when coalesce(object.metadata ->> 'size', '') ~ '^[0-9]+$'
          then (object.metadata ->> 'size')::bigint
        else 0
      end
    ), 0)::bigint,
    pg_catalog.count(*) filter (
      where coalesce(object.metadata ->> 'size', '') !~ '^[0-9]+$'
    )::integer,
    pg_catalog.count(*) filter (
      where attachment.id is null or attachment.status = 'deleted'
    )::integer
  into actual_bytes, metadata_invalid_count, orphan_count
  from storage.objects as object
  left join private.webchat_image_attachments as attachment
    on attachment.bucket_id = object.bucket_id
    and attachment.object_key = object.name
  where object.bucket_id = 'webchat-images';

  select pg_catalog.count(*)::integer into missing_count
  from private.webchat_image_attachments as attachment
  where attachment.status in ('ready', 'attached')
    and not exists (
      select 1
      from storage.objects as object
      where object.bucket_id = attachment.bucket_id
        and object.name = attachment.object_key
    );

  consistent := global_state.image_storage_allocated_bytes = expected_bytes
    and actual_bytes <= expected_bytes
    and metadata_invalid_count = 0
    and orphan_count = 0
    and missing_count = 0;

  if not consistent then
    update private.webchat_global_quota_state as state
    set
      image_uploads_paused = true,
      updated_at = pg_catalog.clock_timestamp()
    where state.singleton
    returning state.image_uploads_paused into global_state.image_uploads_paused;
  end if;

  return query
  select
    global_state.image_storage_allocated_bytes,
    expected_bytes,
    actual_bytes,
    orphan_count,
    missing_count,
    consistent,
    global_state.image_uploads_paused;
end;
$$;

revoke all on function private.reserve_webchat_image_attachment_without_global_limits(uuid, uuid, uuid, text, bigint)
from public, anon, authenticated, service_role;
revoke all on function private.start_webchat_image_validation_without_global_limits(uuid, uuid, uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function private.renew_webchat_image_validation_without_global_limits(uuid, uuid, uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function private.complete_webchat_image_validation_without_global_limits(uuid, uuid, uuid, bigint, integer, integer, text)
from public, anon, authenticated, service_role;
revoke all on function private.fail_webchat_image_validation_without_global_limits(uuid, uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.complete_webchat_image_deletion_without_global_limits(uuid, uuid)
from public, anon, authenticated, service_role;

revoke all on function public.reserve_webchat_image_attachment(uuid, uuid, uuid, text, bigint)
from public, anon, authenticated, service_role;
revoke all on function public.start_webchat_image_validation(uuid, uuid, uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function public.renew_webchat_image_validation(uuid, uuid, uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function public.complete_webchat_image_validation(uuid, uuid, uuid, bigint, integer, integer, text)
from public, anon, authenticated, service_role;
revoke all on function public.fail_webchat_image_validation(uuid, uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.complete_webchat_image_deletion(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.reconcile_webchat_image_storage_accounting()
from public, anon, authenticated, service_role;

grant execute on function public.reserve_webchat_image_attachment(uuid, uuid, uuid, text, bigint)
to service_role;
grant execute on function public.start_webchat_image_validation(uuid, uuid, uuid, integer)
to service_role;
grant execute on function public.renew_webchat_image_validation(uuid, uuid, uuid, integer)
to service_role;
grant execute on function public.complete_webchat_image_validation(uuid, uuid, uuid, bigint, integer, integer, text)
to service_role;
grant execute on function public.fail_webchat_image_validation(uuid, uuid, uuid, text)
to service_role;
grant execute on function public.complete_webchat_image_deletion(uuid, uuid)
to service_role;
grant execute on function public.reconcile_webchat_image_storage_accounting()
to service_role;

comment on function public.reserve_webchat_image_attachment(uuid, uuid, uuid, text, bigint) is
  'Service-role image reservation serialized by the WebChat global quota lock with site-wide rolling and member quotas.';
comment on function public.start_webchat_image_validation(uuid, uuid, uuid, integer) is
  'Starts image validation only after reserving worst-case Storage capacity and a leased global processing slot.';
comment on function public.renew_webchat_image_validation(uuid, uuid, uuid, integer) is
  'Renews only a still-live owner-fenced image lease while global image processing remains enabled.';
comment on function public.complete_webchat_image_validation(uuid, uuid, uuid, bigint, integer, integer, text) is
  'Completes image validation and atomically replaces worst-case Storage allocation with actual normalized bytes.';
comment on function public.complete_webchat_image_deletion(uuid, uuid) is
  'Releases image Storage allocation only after the deletion worker confirms the object removal.';
comment on function public.reconcile_webchat_image_storage_accounting() is
  'Compares attachment allocations with global and Storage metadata, pausing image uploads on drift or orphaned objects.';
