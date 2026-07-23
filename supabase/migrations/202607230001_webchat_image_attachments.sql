-- Private, normalized WebChat image attachments. Browser history stores only
-- stable URNs; object keys remain behind service-role-only RPCs.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'webchat-images',
  'webchat-images',
  false,
  4194304,
  array['image/webp']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- These limits are deliberately enforced in the locked per-user state row rather
-- than in application memory. They bound both retained Storage and normalization
-- work when the client is automated or several browser tabs upload at once.
-- 64 MiB retained, 200 live rows, and 30 reservations per rolling hour are the
-- v1 product limits; deleted rows no longer consume Storage quota.

create table private.webchat_image_upload_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  uploads_frozen boolean not null default false,
  frozen_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint webchat_image_upload_state_frozen_timestamp check (
    (uploads_frozen and frozen_at is not null)
    or (not uploads_frozen and frozen_at is null)
  )
);

create table private.webchat_image_attachments (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null,
  message_id text,
  status text not null default 'reserved',
  bucket_id text not null default 'webchat-images',
  object_key text not null unique,
  original_mime text not null,
  original_bytes bigint not null,
  normalized_mime text,
  object_bytes bigint,
  width integer,
  height integer,
  sha256 text,
  validation_owner_token uuid,
  validation_lease_expires_at timestamptz,
  failure_code text,
  reserved_at timestamptz not null default pg_catalog.clock_timestamp(),
  validation_started_at timestamptz,
  ready_at timestamptz,
  attached_at timestamptz,
  deletion_requested_at timestamptz,
  deleted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint webchat_image_attachments_message_id_format check (
    message_id is null or message_id ~ '^[A-Za-z0-9._:-]{1,128}$'
  ),
  constraint webchat_image_attachments_status_valid check (
    status in (
      'reserved',
      'validating',
      'ready',
      'attached',
      'deleting',
      'deleted',
      'failed'
    )
  ),
  constraint webchat_image_attachments_bucket_fixed check (
    bucket_id = 'webchat-images'
  ),
  constraint webchat_image_attachments_object_key_scoped check (
    object_key = 'user/' || user_id::text
      || '/conversation/' || conversation_id::text
      || '/attachment/' || id::text || '.webp'
  ),
  constraint webchat_image_attachments_original_mime_valid check (
    original_mime in ('image/jpeg', 'image/png', 'image/webp')
  ),
  constraint webchat_image_attachments_original_bytes_valid check (
    original_bytes between 1 and 4194304
  ),
  constraint webchat_image_attachments_normalized_mime_valid check (
    normalized_mime is null or normalized_mime = 'image/webp'
  ),
  constraint webchat_image_attachments_object_bytes_valid check (
    object_bytes is null or object_bytes between 1 and 4194304
  ),
  constraint webchat_image_attachments_dimensions_valid check (
    (width is null and height is null)
    or (
      width between 1 and 2048
      and height between 1 and 2048
      and width::bigint * height::bigint <= 4194304
    )
  ),
  constraint webchat_image_attachments_sha256_valid check (
    sha256 is null or sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint webchat_image_attachments_normalized_metadata_complete check (
    (normalized_mime is null and object_bytes is null and width is null and height is null and sha256 is null)
    or (normalized_mime is not null and object_bytes is not null and width is not null and height is not null and sha256 is not null)
  ),
  constraint webchat_image_attachments_validation_lease_complete check (
    (validation_owner_token is null and validation_lease_expires_at is null)
    or (validation_owner_token is not null and validation_lease_expires_at is not null)
  ),
  constraint webchat_image_attachments_failure_code_safe check (
    failure_code is null or failure_code ~ '^[a-z0-9_:-]{1,64}$'
  ),
  constraint webchat_image_attachments_retention_window check (
    expires_at > reserved_at
    and expires_at <= reserved_at + interval '30 minutes'
  ),
  constraint webchat_image_attachments_state_shape check (
    case status
      when 'reserved' then
        validation_owner_token is null
        and normalized_mime is null
        and message_id is null
        and failure_code is null
        and deleted_at is null
      when 'validating' then
        validation_owner_token is not null
        and validation_started_at is not null
        and normalized_mime is null
        and message_id is null
        and failure_code is null
        and deleted_at is null
      when 'ready' then
        validation_owner_token is null
        and normalized_mime = 'image/webp'
        and ready_at is not null
        and message_id is null
        and failure_code is null
        and deleted_at is null
      when 'attached' then
        validation_owner_token is null
        and normalized_mime = 'image/webp'
        and ready_at is not null
        and message_id is not null
        and attached_at is not null
        and failure_code is null
        and deleted_at is null
      when 'failed' then
        validation_owner_token is null
        and message_id is null
        and failure_code is not null
        and deleted_at is null
      when 'deleting' then
        deletion_requested_at is not null
        and deleted_at is null
      when 'deleted' then
        validation_owner_token is null
        and deletion_requested_at is not null
        and deleted_at is not null
      else false
    end
  )
);

create index webchat_image_attachments_user_status_idx
  on private.webchat_image_attachments (user_id, status, id);

create index webchat_image_attachments_user_reserved_at_idx
  on private.webchat_image_attachments (user_id, reserved_at desc);

create index webchat_image_attachments_conversation_pending_idx
  on private.webchat_image_attachments (conversation_id, status, id)
  where message_id is null and status <> 'deleted';

create index webchat_image_attachments_message_idx
  on private.webchat_image_attachments (conversation_id, message_id, id)
  where message_id is not null;

create index webchat_image_attachments_deleted_retention_idx
  on private.webchat_image_attachments (deleted_at, id)
  where status = 'deleted';

create table private.webchat_image_deletion_outbox (
  attachment_id uuid primary key
    references private.webchat_image_attachments(id) on delete cascade,
  bucket_id text not null,
  object_key text not null,
  reason text not null,
  available_at timestamptz not null default pg_catalog.clock_timestamp(),
  claimed_by uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  last_error_code text,
  dead_lettered_at timestamptz,
  requeue_reason text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  constraint webchat_image_deletion_outbox_bucket_fixed check (
    bucket_id = 'webchat-images'
  ),
  constraint webchat_image_deletion_outbox_reason_safe check (
    reason ~ '^[a-z0-9_:-]{1,64}$'
  ),
  constraint webchat_image_deletion_outbox_lease_complete check (
    (claimed_by is null and lease_expires_at is null)
    or (claimed_by is not null and lease_expires_at is not null)
    or (completed_at is not null and claimed_by is not null and lease_expires_at is null)
  ),
  constraint webchat_image_deletion_outbox_attempt_valid check (
    attempt_count between 0 and 25
  ),
  constraint webchat_image_deletion_outbox_error_safe check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_:-]{1,64}$'
  ),
  constraint webchat_image_deletion_outbox_requeue_reason_safe check (
    requeue_reason is null or requeue_reason ~ '^[a-z0-9_:-]{1,64}$'
  ),
  constraint webchat_image_deletion_outbox_terminal_exclusive check (
    completed_at is null or dead_lettered_at is null
  )
);

create index webchat_image_deletion_outbox_available_idx
  on private.webchat_image_deletion_outbox (available_at, created_at, attachment_id)
  where completed_at is null;

alter table private.webchat_image_upload_state enable row level security;
alter table private.webchat_image_attachments enable row level security;
alter table private.webchat_image_deletion_outbox enable row level security;

revoke all on table private.webchat_image_upload_state
from public, anon, authenticated, service_role;
revoke all on table private.webchat_image_attachments
from public, anon, authenticated, service_role;
revoke all on table private.webchat_image_deletion_outbox
from public, anon, authenticated, service_role;

create function private.webchat_image_ids_from_message(requested_content jsonb)
returns uuid[]
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  part jsonb;
  part_type text;
  part_url text;
  attachment_id uuid;
  attachment_ids uuid[] := '{}'::uuid[];
  top_level_without_parts jsonb;
begin
  if pg_catalog.jsonb_typeof(requested_content) <> 'object' then
    raise exception 'Stored WebChat message is invalid.' using errcode = '22023';
  end if;

  if not (requested_content ? 'parts') then
    return attachment_ids;
  end if;
  if pg_catalog.jsonb_typeof(requested_content -> 'parts') <> 'array' then
    raise exception 'Stored WebChat message parts are invalid.' using errcode = '22023';
  end if;

  for part in
    select element.value
    from pg_catalog.jsonb_array_elements(requested_content -> 'parts') as element(value)
  loop
    if pg_catalog.jsonb_typeof(part) <> 'object' then
      raise exception 'Stored WebChat message part is invalid.' using errcode = '22023';
    end if;

    part_type := part ->> 'type';
    if part_type = 'file' then
      part_url := part ->> 'url';
      if (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(part)
      ) <> 3
        or not (part ? 'type' and part ? 'mediaType' and part ? 'url')
        or part_url is null
        or part_url !~ '^urn:ustsacm:webchat-attachment:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or part ->> 'mediaType' is distinct from 'image/webp' then
        raise exception 'Stored WebChat images require the exact normalized file-part protocol.'
          using errcode = '22023';
      end if;

      attachment_id := pg_catalog.substring(
        part_url,
        '^urn:ustsacm:webchat-attachment:(.*)$'
      )::uuid;
      if attachment_id = any(attachment_ids) then
        raise exception 'Stored WebChat image attachment is duplicated.' using errcode = '22023';
      end if;
      attachment_ids := pg_catalog.array_append(attachment_ids, attachment_id);
    elsif part_type = 'image'
      or part ? 'url'
      or part::text ~* '(data:image/|;base64,|urn:ustsacm:webchat-attachment:|webchat-images|user/[0-9a-f-]+/conversation/[0-9a-f-]+/attachment/[0-9a-f-]+\.webp)' then
      raise exception 'Stored WebChat message contains an unsupported embedded image reference.'
        using errcode = '22023';
    end if;
  end loop;

  if pg_catalog.cardinality(attachment_ids) > 4 then
    raise exception 'A WebChat message may contain at most four images.' using errcode = '54000';
  end if;
  if pg_catalog.cardinality(attachment_ids) > 0
    and requested_content ->> 'role' is distinct from 'user' then
    raise exception 'Only user WebChat messages may contain image attachments.'
      using errcode = '22023';
  end if;

  top_level_without_parts := requested_content - 'parts';
  if top_level_without_parts::text ~* '(data:image/|;base64,|urn:ustsacm:webchat-attachment:|webchat-images|user/[0-9a-f-]+/conversation/[0-9a-f-]+/attachment/[0-9a-f-]+\.webp)' then
    raise exception 'Stored WebChat message contains an unsupported embedded image payload.'
      using errcode = '22023';
  end if;
  return attachment_ids;
end;
$$;

do $$
declare
  stored_message record;
begin
  for stored_message in
    select message.conversation_id, message.id, message.content
    from private.webchat_messages as message
    order by message.conversation_id, message.position
  loop
    perform private.webchat_image_ids_from_message(stored_message.content);
  end loop;
end;
$$;

create function private.enqueue_webchat_image_deletion(
  requested_attachment_id uuid,
  requested_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  attachment private.webchat_image_attachments%rowtype;
  normalized_reason text := pg_catalog.lower(pg_catalog.btrim(requested_reason));
  checked_at timestamptz := pg_catalog.clock_timestamp();
  safe_available_at timestamptz;
begin
  if requested_attachment_id is null
    or normalized_reason !~ '^[a-z0-9_:-]{1,64}$' then
    raise exception 'WebChat image deletion request is invalid.' using errcode = '22023';
  end if;

  select candidate.* into attachment
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
  for update;
  if not found or attachment.status = 'deleted' then
    return false;
  end if;

  -- Storage writes are client-aborted after 120 seconds. Keep an equal grace
  -- period after the validation lease so cleanup cannot overtake a late write.
  safe_available_at := greatest(
    checked_at,
    coalesce(
      attachment.validation_lease_expires_at + interval '2 minutes',
      checked_at
    )
  );

  insert into private.webchat_image_deletion_outbox (
    attachment_id,
    bucket_id,
    object_key,
    reason,
    available_at,
    created_at,
    updated_at
  ) values (
    attachment.id,
    attachment.bucket_id,
    attachment.object_key,
    normalized_reason,
    safe_available_at,
    checked_at,
    checked_at
  )
  on conflict (attachment_id) do update
  set
    available_at = greatest(
      private.webchat_image_deletion_outbox.available_at,
      excluded.available_at
    ),
    updated_at = excluded.updated_at
  where private.webchat_image_deletion_outbox.completed_at is null
    and private.webchat_image_deletion_outbox.dead_lettered_at is null;

  if attachment.status <> 'failed' then
    update private.webchat_image_attachments as target
    set
      status = 'deleting',
      deletion_requested_at = coalesce(target.deletion_requested_at, checked_at),
      updated_at = checked_at
    where target.id = attachment.id;
  end if;
  return true;
end;
$$;

create function private.bind_webchat_image_attachments_internal(
  requested_user_id uuid,
  requested_conversation_id uuid,
  requested_message_id text,
  requested_attachment_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  requested_count integer := coalesce(pg_catalog.cardinality(requested_attachment_ids), 0);
  matched_count integer;
begin
  if requested_user_id is null
    or requested_conversation_id is null
    or requested_message_id !~ '^[A-Za-z0-9._:-]{1,128}$'
    or requested_count > 4
    or requested_count <> (
      select pg_catalog.count(distinct attachment_id)::integer
      from pg_catalog.unnest(coalesce(requested_attachment_ids, '{}'::uuid[]))
        as requested(attachment_id)
    ) then
    raise exception 'WebChat image binding request is invalid.' using errcode = '22023';
  end if;

  if requested_count = 0 then
    return 0;
  end if;

  perform 1
  from private.webchat_image_attachments as attachment
  where attachment.id = any(requested_attachment_ids)
  order by attachment.id
  for update;

  select pg_catalog.count(*)::integer into matched_count
  from private.webchat_image_attachments as attachment
  where attachment.id = any(requested_attachment_ids)
    and attachment.user_id = requested_user_id
    and attachment.conversation_id = requested_conversation_id
    and (
      (
        attachment.status = 'ready'
        and attachment.expires_at > checked_at
      )
      or (
        attachment.status = 'attached'
        and attachment.message_id = requested_message_id
      )
    );

  if matched_count <> requested_count then
    raise exception 'WebChat image attachment is unavailable or belongs to another target.'
      using errcode = '42501';
  end if;

  update private.webchat_image_attachments as attachment
  set
    status = 'attached',
    message_id = requested_message_id,
    attached_at = coalesce(attachment.attached_at, checked_at),
    updated_at = checked_at
  where attachment.id = any(requested_attachment_ids)
    and attachment.status = 'ready';

  return requested_count;
end;
$$;

create function private.bind_webchat_image_message_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_user_id uuid;
  previous_ids uuid[] := '{}'::uuid[];
  next_ids uuid[] := private.webchat_image_ids_from_message(new.content);
  removed_id uuid;
begin
  if tg_op = 'UPDATE'
    and (new.conversation_id, new.id) is distinct from (old.conversation_id, old.id) then
    raise exception 'Stored WebChat message identity cannot change.' using errcode = '22023';
  end if;

  select conversation.user_id into conversation_user_id
  from private.webchat_conversations as conversation
  where conversation.id = new.conversation_id;
  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  if tg_op = 'UPDATE' then
    previous_ids := private.webchat_image_ids_from_message(old.content);
  end if;

  perform private.bind_webchat_image_attachments_internal(
    conversation_user_id,
    new.conversation_id,
    new.id,
    next_ids
  );

  for removed_id in
    select previous.attachment_id
    from pg_catalog.unnest(previous_ids) as previous(attachment_id)
    where not (previous.attachment_id = any(next_ids))
    order by previous.attachment_id
  loop
    if not exists (
      select 1
      from private.webchat_image_attachments as attachment
      where attachment.id = removed_id
        and attachment.user_id = conversation_user_id
        and attachment.conversation_id = new.conversation_id
        and attachment.message_id = new.id
    ) then
      raise exception 'Stored WebChat attachment target is inconsistent.'
        using errcode = '23503';
    end if;
    perform private.enqueue_webchat_image_deletion(removed_id, 'message_attachment_removed');
  end loop;
  return new;
end;
$$;

create function private.queue_webchat_image_message_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attachment_id uuid;
  conversation_user_id uuid;
begin
  if not exists (
    select 1
    from private.webchat_image_attachments as attachment
    where attachment.conversation_id = old.conversation_id
      and attachment.message_id = old.id
      and attachment.status <> 'deleted'
  ) then
    return old;
  end if;

  select conversation.user_id into conversation_user_id
  from private.webchat_conversations as conversation
  where conversation.id = old.conversation_id;
  if not found then
    if exists (
      select 1
      from private.webchat_image_attachments as attachment
      where attachment.conversation_id = old.conversation_id
        and attachment.message_id = old.id
        and attachment.status not in ('deleting', 'deleted')
    ) then
      raise exception 'Stored WebChat attachment target is inconsistent.'
        using errcode = '23503';
    end if;
    return old;
  end if;

  if exists (
    select 1
    from private.webchat_image_attachments as attachment
    where attachment.conversation_id = old.conversation_id
      and attachment.message_id = old.id
      and attachment.user_id is distinct from conversation_user_id
  ) then
    raise exception 'Stored WebChat attachment target is inconsistent.'
      using errcode = '23503';
  end if;

  for attachment_id in
    select attachment.id
    from private.webchat_image_attachments as attachment
    where attachment.conversation_id = old.conversation_id
      and attachment.message_id = old.id
      and attachment.user_id = conversation_user_id
      and attachment.status <> 'deleted'
    order by attachment.id
    for update
  loop
    perform private.enqueue_webchat_image_deletion(attachment_id, 'message_deleted');
  end loop;
  return old;
end;
$$;

create function private.queue_webchat_image_conversation_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attachment_id uuid;
begin
  if exists (
    select 1
    from private.webchat_image_attachments as attachment
    where attachment.conversation_id = old.id
      and attachment.user_id is distinct from old.user_id
  ) then
    raise exception 'Stored WebChat attachment owner is inconsistent.'
      using errcode = '23503';
  end if;

  for attachment_id in
    select attachment.id
    from private.webchat_image_attachments as attachment
    where attachment.conversation_id = old.id
      and attachment.user_id = old.user_id
      and attachment.status <> 'deleted'
    order by attachment.id
    for update
  loop
    perform private.enqueue_webchat_image_deletion(attachment_id, 'conversation_deleted');
  end loop;
  return old;
end;
$$;

create trigger webchat_messages_20_bind_image_attachments
before insert or update of content on private.webchat_messages
for each row execute function private.bind_webchat_image_message_trigger();

create trigger webchat_messages_20_queue_image_deletion
before delete on private.webchat_messages
for each row execute function private.queue_webchat_image_message_deletion();

create trigger webchat_conversations_20_queue_image_deletion
before delete on private.webchat_conversations
for each row execute function private.queue_webchat_image_conversation_deletion();

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
  normalized_mime text := pg_catalog.lower(pg_catalog.btrim(requested_original_mime));
  checked_at timestamptz := pg_catalog.clock_timestamp();
  frozen boolean;
  upload_state private.webchat_image_upload_state%rowtype;
  existing private.webchat_image_attachments%rowtype;
  recent_reservation_count integer;
  pending_count integer;
  pending_original_bytes bigint;
  pending_object_bytes bigint;
  retained_count integer;
  retained_bytes bigint;
  next_object_key text;
begin
  if requested_user_id is null
    or requested_conversation_id is null
    or requested_attachment_id is null
    or normalized_mime not in ('image/jpeg', 'image/png', 'image/webp')
    or requested_original_bytes not between 1 and 4194304 then
    raise exception 'WebChat image reservation is invalid.' using errcode = '22023';
  end if;

  perform 1
  from public.profiles as profile
  where profile.id = requested_user_id
  for share;
  if not found then
    raise exception 'Member profile not found.' using errcode = '42501';
  end if;

  insert into private.webchat_image_upload_state (user_id)
  values (requested_user_id)
  on conflict (user_id) do nothing;

  select state.* into upload_state
  from private.webchat_image_upload_state as state
  where state.user_id = requested_user_id
  for update;
  frozen := upload_state.uploads_frozen;
  if coalesce(frozen, true) then
    raise exception 'WebChat image uploads are frozen for account deletion.'
      using errcode = '55000';
  end if;

  perform 1
  from private.webchat_conversations as conversation
  where conversation.id = requested_conversation_id
    and conversation.user_id = requested_user_id
  for update;
  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  select candidate.* into existing
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
  for update;
  if found then
    if existing.user_id is distinct from requested_user_id
      or existing.conversation_id is distinct from requested_conversation_id
      or existing.original_mime is distinct from normalized_mime
      or existing.original_bytes is distinct from requested_original_bytes
      or existing.status = 'deleted' then
      raise exception 'WebChat image reservation identity conflicts with an existing attachment.'
        using errcode = '23505';
    end if;
    return query
    select existing.id, existing.status, existing.bucket_id, existing.object_key, existing.expires_at;
    return;
  end if;

  select pg_catalog.count(*)::integer into recent_reservation_count
  from private.webchat_image_attachments as attachment
  where attachment.user_id = requested_user_id
    and attachment.reserved_at > checked_at - interval '1 hour';

  if recent_reservation_count >= 30 then
    raise exception 'WebChat member image upload rate limit reached.' using errcode = '54000';
  end if;

  select
    pg_catalog.count(*)::integer,
    coalesce(pg_catalog.sum(coalesce(attachment.object_bytes, attachment.original_bytes)), 0)::bigint
  into retained_count, retained_bytes
  from private.webchat_image_attachments as attachment
  where attachment.user_id = requested_user_id
    and attachment.status <> 'deleted';

  if retained_count >= 200 then
    raise exception 'WebChat member retained image count limit reached.' using errcode = '54000';
  end if;
  if retained_bytes + requested_original_bytes > 67108864 then
    raise exception 'WebChat member retained images exceed 64 MiB.' using errcode = '54000';
  end if;

  select
    pg_catalog.count(*)::integer,
    coalesce(pg_catalog.sum(attachment.original_bytes), 0)::bigint,
    coalesce(pg_catalog.sum(attachment.object_bytes), 0)::bigint
  into pending_count, pending_original_bytes, pending_object_bytes
  from private.webchat_image_attachments as attachment
  where attachment.conversation_id = requested_conversation_id
    and attachment.message_id is null
    and attachment.status <> 'deleted';

  if pending_count >= 8 then
    raise exception 'WebChat conversation has eight pending images.' using errcode = '54000';
  end if;
  if pending_original_bytes + requested_original_bytes > 16777216
    or pending_object_bytes > 16777216 then
    raise exception 'WebChat conversation pending images exceed 16 MiB.' using errcode = '54000';
  end if;

  next_object_key := 'user/' || requested_user_id::text
    || '/conversation/' || requested_conversation_id::text
    || '/attachment/' || requested_attachment_id::text || '.webp';

  return query
  insert into private.webchat_image_attachments (
    id,
    user_id,
    conversation_id,
    status,
    bucket_id,
    object_key,
    original_mime,
    original_bytes,
    reserved_at,
    expires_at,
    created_at,
    updated_at
  ) values (
    requested_attachment_id,
    requested_user_id,
    requested_conversation_id,
    'reserved',
    'webchat-images',
    next_object_key,
    normalized_mime,
    requested_original_bytes,
    checked_at,
    checked_at + interval '30 minutes',
    checked_at,
    checked_at
  )
  returning
    webchat_image_attachments.id,
    webchat_image_attachments.status,
    webchat_image_attachments.bucket_id,
    webchat_image_attachments.object_key,
    webchat_image_attachments.expires_at;

  update private.webchat_image_upload_state as state
  set
    updated_at = checked_at
  where state.user_id = requested_user_id;
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
  attachment private.webchat_image_attachments%rowtype;
  checked_at timestamptz := pg_catalog.clock_timestamp();
begin
  if requested_user_id is null
    or requested_attachment_id is null
    or requested_owner_token is null
    or requested_lease_seconds not between 30 and 600 then
    raise exception 'WebChat image validation lease is invalid.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from private.webchat_image_upload_state as state
    where state.user_id = requested_user_id
      and state.uploads_frozen
  ) then
    raise exception 'WebChat image uploads are frozen for account deletion.'
      using errcode = '55000';
  end if;

  select candidate.* into attachment
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
    and candidate.user_id = requested_user_id
  for update;
  if not found then
    raise exception 'WebChat image attachment not found.' using errcode = 'P0002';
  end if;

  if attachment.status in ('ready', 'attached') then
    return query
    select attachment.status, attachment.bucket_id, attachment.object_key, attachment.expires_at;
    return;
  end if;
  if attachment.status not in ('reserved', 'validating')
    or attachment.expires_at <= checked_at
    or (
      attachment.status = 'validating'
      and attachment.validation_owner_token is distinct from requested_owner_token
      and attachment.validation_lease_expires_at > checked_at
    ) then
    raise exception 'WebChat image attachment is unavailable for validation.'
      using errcode = '55000';
  end if;

  update private.webchat_image_attachments as target
  set
    status = 'validating',
    validation_owner_token = requested_owner_token,
    validation_lease_expires_at = checked_at + pg_catalog.make_interval(secs => requested_lease_seconds),
    validation_started_at = coalesce(target.validation_started_at, checked_at),
    updated_at = checked_at
  where target.id = attachment.id
  returning target.* into attachment;

  return query
  select attachment.status, attachment.bucket_id, attachment.object_key, attachment.expires_at;
end;
$$;

-- A validator renews immediately before the external Storage write. Cleanup may
-- only claim rows after this lease expires, so a late worker cannot recreate a
-- fixed object key after the row has been tombstoned.
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
  attachment private.webchat_image_attachments%rowtype;
  checked_at timestamptz := pg_catalog.clock_timestamp();
begin
  if requested_user_id is null
    or requested_attachment_id is null
    or requested_owner_token is null
    or requested_lease_seconds not between 30 and 900 then
    raise exception 'WebChat image validation lease is invalid.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from private.webchat_image_upload_state as state
    where state.user_id = requested_user_id
      and state.uploads_frozen
  ) then
    raise exception 'WebChat image uploads are frozen for account deletion.'
      using errcode = '55000';
  end if;

  select candidate.* into attachment
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
    and candidate.user_id = requested_user_id
  for update;
  if not found
    or attachment.status <> 'validating'
    or attachment.validation_owner_token is distinct from requested_owner_token
    or attachment.expires_at <= checked_at then
    raise exception 'WebChat image validation lease is unavailable.' using errcode = '55000';
  end if;

  update private.webchat_image_attachments as target
  set
    validation_lease_expires_at = checked_at + pg_catalog.make_interval(secs => requested_lease_seconds),
    updated_at = checked_at
  where target.id = attachment.id
  returning target.* into attachment;

  return query
  select attachment.status, attachment.bucket_id, attachment.object_key, attachment.expires_at;
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
  attachment private.webchat_image_attachments%rowtype;
  checked_at timestamptz := pg_catalog.clock_timestamp();
  pending_original_bytes bigint;
  pending_object_bytes bigint;
  retained_bytes bigint;
  upload_state private.webchat_image_upload_state%rowtype;
  normalized_sha256 text := pg_catalog.lower(pg_catalog.btrim(requested_sha256));
begin
  if requested_user_id is null
    or requested_attachment_id is null
    or requested_owner_token is null
    or requested_object_bytes not between 1 and 4194304
    or requested_width not between 1 and 2048
    or requested_height not between 1 and 2048
    or requested_width::bigint * requested_height::bigint > 4194304
    or normalized_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Normalized WebChat image metadata is invalid.' using errcode = '22023';
  end if;

  perform 1
  from public.profiles as profile
  where profile.id = requested_user_id
  for share;
  select state.* into upload_state
  from private.webchat_image_upload_state as state
  where state.user_id = requested_user_id
  for update;
  if not found or upload_state.uploads_frozen then
    raise exception 'WebChat image uploads are frozen or unavailable.' using errcode = '55000';
  end if;

  select candidate.* into attachment
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
    and candidate.user_id = requested_user_id;
  if not found then
    raise exception 'WebChat image attachment not found.' using errcode = 'P0002';
  end if;

  perform 1
  from private.webchat_conversations as conversation
  where conversation.id = attachment.conversation_id
    and conversation.user_id = requested_user_id
  for update;
  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  select candidate.* into attachment
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
  for update;

  if attachment.status in ('ready', 'attached') then
    if attachment.object_bytes is distinct from requested_object_bytes
      or attachment.width is distinct from requested_width
      or attachment.height is distinct from requested_height
      or attachment.sha256 is distinct from normalized_sha256 then
      raise exception 'Normalized WebChat image completion conflicts with existing metadata.'
        using errcode = '23505';
    end if;
    return query
    select attachment.id, attachment.status, attachment.normalized_mime,
      attachment.object_bytes, attachment.width, attachment.height, attachment.sha256;
    return;
  end if;

  if attachment.status <> 'validating'
    or attachment.validation_owner_token is distinct from requested_owner_token
    or attachment.validation_lease_expires_at <= checked_at
    or attachment.expires_at <= checked_at then
    raise exception 'WebChat image validation lease is unavailable.' using errcode = '55000';
  end if;

  select
    coalesce(pg_catalog.sum(candidate.original_bytes), 0)::bigint,
    coalesce(pg_catalog.sum(candidate.object_bytes), 0)::bigint
  into pending_original_bytes, pending_object_bytes
  from private.webchat_image_attachments as candidate
  where candidate.conversation_id = attachment.conversation_id
    and candidate.id <> attachment.id
    and candidate.message_id is null
    and candidate.status <> 'deleted';
  if pending_original_bytes + attachment.original_bytes > 16777216
    or pending_object_bytes + requested_object_bytes > 16777216 then
    raise exception 'WebChat conversation pending images exceed 16 MiB.' using errcode = '54000';
  end if;

  select coalesce(pg_catalog.sum(coalesce(candidate.object_bytes, candidate.original_bytes)), 0)::bigint
  into retained_bytes
  from private.webchat_image_attachments as candidate
  where candidate.user_id = requested_user_id
    and candidate.id <> attachment.id
    and candidate.status <> 'deleted';
  if retained_bytes + requested_object_bytes > 67108864 then
    raise exception 'WebChat member retained images exceed 64 MiB.' using errcode = '54000';
  end if;

  update private.webchat_image_attachments as target
  set
    status = 'ready',
    normalized_mime = 'image/webp',
    object_bytes = requested_object_bytes,
    width = requested_width,
    height = requested_height,
    sha256 = normalized_sha256,
    validation_owner_token = null,
    validation_lease_expires_at = null,
    ready_at = checked_at,
    updated_at = checked_at
  where target.id = attachment.id
  returning target.* into attachment;

  return query
  select attachment.id, attachment.status, attachment.normalized_mime,
    attachment.object_bytes, attachment.width, attachment.height, attachment.sha256;
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
  attachment private.webchat_image_attachments%rowtype;
  normalized_error text := pg_catalog.lower(pg_catalog.btrim(requested_error_code));
  checked_at timestamptz := pg_catalog.clock_timestamp();
begin
  if requested_user_id is null
    or requested_attachment_id is null
    or requested_owner_token is null
    or normalized_error !~ '^[a-z0-9_:-]{1,64}$' then
    raise exception 'WebChat image validation failure is invalid.' using errcode = '22023';
  end if;

  select candidate.* into attachment
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
    and candidate.user_id = requested_user_id
  for update;
  if not found then
    raise exception 'WebChat image attachment not found.' using errcode = 'P0002';
  end if;
  if attachment.status in ('failed', 'deleting', 'deleted') then
    return true;
  end if;
  if attachment.status <> 'validating'
    or attachment.validation_owner_token is distinct from requested_owner_token then
    raise exception 'WebChat image validation lease is unavailable.' using errcode = '55000';
  end if;

  -- Queue the object while the validation lease is still present. The outbox
  -- then retains the lease plus the Storage-write grace period, covering an
  -- upload that finishes after the client-side request has already failed.
  perform private.enqueue_webchat_image_deletion(attachment.id, 'validation_failed');

  update private.webchat_image_attachments as target
  set
    status = 'failed',
    validation_owner_token = null,
    validation_lease_expires_at = null,
    failure_code = normalized_error,
    updated_at = checked_at
  where target.id = attachment.id;

  return true;
end;
$$;

create function public.bind_webchat_image_attachments(
  requested_user_id uuid,
  requested_conversation_id uuid,
  requested_message_id text,
  requested_attachment_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_ids uuid[];
begin
  select private.webchat_image_ids_from_message(message.content) into stored_ids
  from private.webchat_messages as message
  join private.webchat_conversations as conversation
    on conversation.id = message.conversation_id
  where message.conversation_id = requested_conversation_id
    and message.id = requested_message_id
    and conversation.user_id = requested_user_id
  for update of message;
  if not found then
    raise exception 'Stored WebChat message was not found.' using errcode = 'P0002';
  end if;
  if stored_ids is distinct from coalesce(requested_attachment_ids, '{}'::uuid[]) then
    raise exception 'WebChat image binding does not match stored history.' using errcode = '22023';
  end if;
  return private.bind_webchat_image_attachments_internal(
    requested_user_id,
    requested_conversation_id,
    requested_message_id,
    stored_ids
  );
end;
$$;

create function public.read_webchat_image_attachment_for_preview(
  requested_user_id uuid,
  requested_attachment_id uuid
)
returns table (
  id uuid,
  status text,
  bucket_id text,
  object_key text,
  media_type text,
  object_bytes bigint,
  width integer,
  height integer,
  sha256 text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    attachment.id,
    attachment.status,
    attachment.bucket_id,
    attachment.object_key,
    attachment.normalized_mime,
    attachment.object_bytes,
    attachment.width,
    attachment.height,
    attachment.sha256
  from private.webchat_image_attachments as attachment
  where attachment.id = requested_attachment_id
    and attachment.user_id = requested_user_id
    and attachment.status in ('ready', 'attached');
$$;

create function public.read_webchat_image_attachment_for_model(
  requested_user_id uuid,
  requested_conversation_id uuid,
  requested_message_id text,
  requested_attachment_id uuid
)
returns table (
  bucket_id text,
  object_key text,
  media_type text,
  object_bytes bigint,
  width integer,
  height integer,
  sha256 text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    attachment.bucket_id,
    attachment.object_key,
    attachment.normalized_mime,
    attachment.object_bytes,
    attachment.width,
    attachment.height,
    attachment.sha256
  from private.webchat_image_attachments as attachment
  where attachment.id = requested_attachment_id
    and attachment.user_id = requested_user_id
    and attachment.conversation_id = requested_conversation_id
    and attachment.message_id = requested_message_id
    and attachment.status = 'attached';
$$;

create function public.read_own_webchat_image_attachment_preview(
  requested_conversation_id uuid,
  requested_message_id text,
  requested_attachment_id uuid
)
returns table (
  id uuid,
  urn text,
  media_type text,
  object_bytes bigint,
  width integer,
  height integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null
    or requested_conversation_id is null
    or requested_message_id !~ '^[A-Za-z0-9._:-]{1,128}$'
    or requested_attachment_id is null then
    raise exception 'Authenticated attachment target is required.' using errcode = '42501';
  end if;

  return query
  select
    attachment.id,
    'urn:ustsacm:webchat-attachment:' || attachment.id::text,
    attachment.normalized_mime,
    attachment.object_bytes,
    attachment.width,
    attachment.height
  from private.webchat_image_attachments as attachment
  where attachment.id = requested_attachment_id
    and attachment.user_id = actor_id
    and attachment.conversation_id = requested_conversation_id
    and attachment.message_id = requested_message_id
    and attachment.status = 'attached';
end;
$$;

create function public.queue_webchat_image_attachment_deletion(
  requested_user_id uuid,
  requested_attachment_id uuid,
  requested_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  attachment private.webchat_image_attachments%rowtype;
begin
  select candidate.* into attachment
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
    and candidate.user_id = requested_user_id
  for update;

  if not found or attachment.status = 'deleted' then
    return false;
  end if;
  if attachment.status = 'deleting' then
    return true;
  end if;
  if attachment.message_id is not null
    or attachment.status not in ('reserved', 'validating', 'ready', 'failed') then
    raise exception 'WebChat image attachment is not an unbound draft.' using errcode = '55000';
  end if;
  return private.enqueue_webchat_image_deletion(requested_attachment_id, requested_reason);
end;
$$;

create function public.enqueue_expired_webchat_image_attachments(
  requested_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 100), 1), 500);
  attachment_id uuid;
  queued_count integer := 0;
begin
  for attachment_id in
    select attachment.id
    from private.webchat_image_attachments as attachment
    where attachment.status in ('reserved', 'validating', 'ready')
      and attachment.expires_at <= pg_catalog.clock_timestamp()
    order by attachment.expires_at, attachment.id
    for update of attachment skip locked
    limit safe_limit
  loop
    if private.enqueue_webchat_image_deletion(attachment_id, 'reservation_expired') then
      queued_count := queued_count + 1;
    end if;
  end loop;
  return queued_count;
end;
$$;

create function public.claim_webchat_image_deletion_queue(
  requested_owner_token uuid,
  requested_limit integer default 20,
  requested_lease_seconds integer default 300
)
returns table (
  attachment_id uuid,
  user_id uuid,
  bucket_id text,
  object_key text,
  attempt integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 20), 1), 100);
  checked_at timestamptz := pg_catalog.clock_timestamp();
begin
  if requested_owner_token is null
    or requested_lease_seconds not between 30 and 900 then
    raise exception 'WebChat image deletion lease is invalid.' using errcode = '22023';
  end if;

  update private.webchat_image_deletion_outbox as queue
  set
    claimed_by = null,
    lease_expires_at = null,
    dead_lettered_at = coalesce(queue.dead_lettered_at, checked_at),
    updated_at = checked_at
  where queue.completed_at is null
    and queue.dead_lettered_at is null
    and queue.attempt_count >= 25
    and (queue.claimed_by is null or queue.lease_expires_at <= checked_at);

  return query
  with candidates as materialized (
    select queue.attachment_id
    from private.webchat_image_deletion_outbox as queue
    join private.webchat_image_attachments as attachment
      on attachment.id = queue.attachment_id
    where queue.completed_at is null
      and queue.dead_lettered_at is null
      and queue.available_at <= checked_at
      and queue.attempt_count < 25
      and attachment.status <> 'deleted'
      and (
        attachment.validation_lease_expires_at is null
        or attachment.validation_lease_expires_at <= checked_at
      )
      and (
        queue.claimed_by is null
        or queue.lease_expires_at <= checked_at
      )
    order by queue.available_at, queue.created_at, queue.attachment_id
    for update of attachment skip locked
    limit safe_limit
  ), claimed as (
    update private.webchat_image_deletion_outbox as queue
    set
      claimed_by = requested_owner_token,
      lease_expires_at = checked_at + pg_catalog.make_interval(secs => requested_lease_seconds),
      attempt_count = queue.attempt_count + 1,
      updated_at = checked_at
    from candidates
    where queue.attachment_id = candidates.attachment_id
    returning queue.*
  ), transitioned as (
    update private.webchat_image_attachments as attachment
    set
      status = 'deleting',
      validation_owner_token = null,
      validation_lease_expires_at = null,
      deletion_requested_at = coalesce(attachment.deletion_requested_at, checked_at),
      updated_at = checked_at
    from claimed
    where attachment.id = claimed.attachment_id
      and attachment.status <> 'deleted'
    returning attachment.id
  )
  select
    claimed.attachment_id,
    attachment.user_id,
    claimed.bucket_id,
    claimed.object_key,
    claimed.attempt_count
  from claimed
  join private.webchat_image_attachments as attachment
    on attachment.id = claimed.attachment_id
  join transitioned on transitioned.id = claimed.attachment_id;
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
  queue private.webchat_image_deletion_outbox%rowtype;
  attachment private.webchat_image_attachments%rowtype;
  checked_at timestamptz := pg_catalog.clock_timestamp();
begin
  if requested_attachment_id is null or requested_owner_token is null then
    raise exception 'WebChat image deletion completion is invalid.' using errcode = '22023';
  end if;

  select candidate.* into attachment
  from private.webchat_image_attachments as candidate
  where candidate.id = requested_attachment_id
  for update;
  if not found then
    return false;
  end if;

  select candidate.* into queue
  from private.webchat_image_deletion_outbox as candidate
  where candidate.attachment_id = requested_attachment_id
  for update;
  if not found or queue.claimed_by is distinct from requested_owner_token then
    return false;
  end if;
  if queue.completed_at is not null and attachment.status = 'deleted' then
    return true;
  end if;

  update private.webchat_image_attachments as target
  set
    status = 'deleted',
    validation_owner_token = null,
    validation_lease_expires_at = null,
    deletion_requested_at = coalesce(target.deletion_requested_at, checked_at),
    deleted_at = coalesce(target.deleted_at, checked_at),
    updated_at = checked_at
  where target.id = requested_attachment_id;

  update private.webchat_image_deletion_outbox as target
  set
    lease_expires_at = null,
    completed_at = coalesce(target.completed_at, checked_at),
    updated_at = checked_at
  where target.attachment_id = requested_attachment_id;
  return true;
end;
$$;

create function public.retry_webchat_image_deletion(
  requested_attachment_id uuid,
  requested_owner_token uuid,
  requested_error_code text,
  requested_retry_after_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_error text := pg_catalog.lower(pg_catalog.btrim(requested_error_code));
  checked_at timestamptz := pg_catalog.clock_timestamp();
begin
  if requested_attachment_id is null
    or requested_owner_token is null
    or normalized_error !~ '^[a-z0-9_:-]{1,64}$'
    or requested_retry_after_seconds not between 1 and 3600 then
    raise exception 'WebChat image deletion retry is invalid.' using errcode = '22023';
  end if;

  update private.webchat_image_deletion_outbox as queue
  set
    available_at = case
      when queue.attempt_count >= 25 then queue.available_at
      else checked_at + pg_catalog.make_interval(secs => requested_retry_after_seconds)
    end,
    claimed_by = null,
    lease_expires_at = null,
    last_error_code = normalized_error,
    dead_lettered_at = case
      when queue.attempt_count >= 25 then coalesce(queue.dead_lettered_at, checked_at)
      else queue.dead_lettered_at
    end,
    updated_at = checked_at
  where queue.attachment_id = requested_attachment_id
    and queue.completed_at is null
    and queue.dead_lettered_at is null
    and queue.claimed_by = requested_owner_token;
  return found;
end;
$$;

create function public.list_webchat_image_deletion_dead_letters(
  requested_limit integer default 100
)
returns table (
  attachment_id uuid,
  user_id uuid,
  bucket_id text,
  object_key text,
  attempt_count integer,
  last_error_code text,
  dead_lettered_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 100), 1), 500);
begin
  return query
  select
    queue.attachment_id,
    attachment.user_id,
    queue.bucket_id,
    queue.object_key,
    queue.attempt_count,
    queue.last_error_code,
    queue.dead_lettered_at
  from private.webchat_image_deletion_outbox as queue
  join private.webchat_image_attachments as attachment
    on attachment.id = queue.attachment_id
  where queue.completed_at is null
    and queue.dead_lettered_at is not null
  order by queue.dead_lettered_at, queue.attachment_id
  limit safe_limit;
end;
$$;

create function public.requeue_webchat_image_deletion_dead_letter(
  requested_attachment_id uuid,
  requested_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_reason text := pg_catalog.lower(pg_catalog.btrim(requested_reason));
  checked_at timestamptz := pg_catalog.clock_timestamp();
begin
  if requested_attachment_id is null
    or normalized_reason !~ '^[a-z0-9_:-]{1,64}$' then
    raise exception 'WebChat image dead-letter recovery is invalid.' using errcode = '22023';
  end if;

  update private.webchat_image_deletion_outbox as queue
  set
    available_at = greatest(
      checked_at,
      coalesce(attachment.validation_lease_expires_at, checked_at)
    ),
    claimed_by = null,
    lease_expires_at = null,
    attempt_count = 0,
    last_error_code = null,
    dead_lettered_at = null,
    requeue_reason = normalized_reason,
    updated_at = checked_at
  from private.webchat_image_attachments as attachment
  where queue.attachment_id = requested_attachment_id
    and attachment.id = queue.attachment_id
    and queue.completed_at is null
    and queue.dead_lettered_at is not null
    and attachment.status <> 'deleted';
  return found;
end;
$$;

create function public.purge_deleted_webchat_image_attachments(
  requested_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 500), 1), 2000);
  purged_count integer;
begin
  with candidates as materialized (
    select attachment.id
    from private.webchat_image_attachments as attachment
    where attachment.status = 'deleted'
      and attachment.deleted_at <= pg_catalog.clock_timestamp() - interval '7 days'
    order by attachment.deleted_at, attachment.id
    for update skip locked
    limit safe_limit
  ), deleted as (
    delete from private.webchat_image_attachments as attachment
    using candidates
    where attachment.id = candidates.id
    returning attachment.id
  )
  select pg_catalog.count(*)::integer into purged_count from deleted;
  return purged_count;
end;
$$;

-- Keep the existing export implementation intact and wrap it with an additive,
-- safe attachment projection. Object keys, hashes, validation leases, deletion
-- attempts, and cross-user identifiers never cross the browser boundary.
alter function public.export_own_data() rename to export_own_data_without_webchat_images;
alter function public.export_own_data_without_webchat_images() set schema private;

revoke all on function private.export_own_data_without_webchat_images()
from public, anon, authenticated, service_role;

create function public.export_own_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  actor_id uuid := auth.uid();
  exported_data jsonb;
  attachment_data jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  exported_data := private.export_own_data_without_webchat_images();
  select pg_catalog.jsonb_build_object(
    'count', pg_catalog.count(*) filter (
      where attachment.normalized_mime = 'image/webp'
        and attachment.object_bytes is not null
        and attachment.width is not null
        and attachment.height is not null
    ),
    'items', coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'mediaType', attachment.normalized_mime,
          'bytes', attachment.object_bytes,
          'width', attachment.width,
          'height', attachment.height,
          'createdAt', attachment.created_at,
          'readyAt', attachment.ready_at,
          'attachedAt', attachment.attached_at,
          'deletedAt', attachment.deleted_at
        )) order by attachment.created_at, attachment.id
      ) filter (
        where attachment.normalized_mime = 'image/webp'
          and attachment.object_bytes is not null
          and attachment.width is not null
          and attachment.height is not null
      ),
      '[]'::jsonb
    )
  ) into attachment_data
  from private.webchat_image_attachments as attachment
  where attachment.user_id = actor_id;

  return pg_catalog.jsonb_set(
    exported_data,
    '{webchat,imageAttachments}',
    attachment_data,
    true
  );
end;
$$;

-- Freeze uploads before final account removal. Any object whose deletion is not
-- confirmed keeps Auth/Profile deletion closed until the Edge cleanup worker
-- completes the outbox item and the caller retries the fenced deletion RPC.
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
  attachment_id uuid;
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
      'deleted', false,
      'attachmentCleanupPending', false
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
      'deleted', false,
      'attachmentCleanupPending', false
    );
  end if;

  insert into private.webchat_image_upload_state (
    user_id,
    uploads_frozen,
    frozen_at,
    updated_at
  ) values (
    p_user_id,
    true,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  )
  on conflict (user_id) do update
  set
    uploads_frozen = true,
    frozen_at = coalesce(
      private.webchat_image_upload_state.frozen_at,
      excluded.frozen_at
    ),
    updated_at = excluded.updated_at;

  for attachment_id in
    select attachment.id
    from private.webchat_image_attachments as attachment
    where attachment.user_id = p_user_id
      and attachment.status <> 'deleted'
    order by attachment.id
    for update
  loop
    perform private.enqueue_webchat_image_deletion(attachment_id, 'account_deletion');
  end loop;

  if exists (
    select 1
    from private.webchat_image_attachments as attachment
    where attachment.user_id = p_user_id
      and attachment.status <> 'deleted'
  ) or exists (
    select 1
    from private.webchat_image_deletion_outbox as queue
    join private.webchat_image_attachments as attachment
      on attachment.id = queue.attachment_id
    where attachment.user_id = p_user_id
      and queue.completed_at is null
  ) then
    return pg_catalog.jsonb_build_object(
      'leaseOwned', true,
      'deleted', false,
      'attachmentCleanupPending', true
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
        'deleted', false,
        'attachmentCleanupPending', false
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
    'deleted', deleted_count = 1,
    'attachmentCleanupPending', false
  );
end;
$$;

revoke all on function private.webchat_image_ids_from_message(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.enqueue_webchat_image_deletion(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.bind_webchat_image_attachments_internal(uuid, uuid, text, uuid[])
from public, anon, authenticated, service_role;
revoke all on function private.bind_webchat_image_message_trigger()
from public, anon, authenticated, service_role;
revoke all on function private.queue_webchat_image_message_deletion()
from public, anon, authenticated, service_role;
revoke all on function private.queue_webchat_image_conversation_deletion()
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
revoke all on function public.bind_webchat_image_attachments(uuid, uuid, text, uuid[])
from public, anon, authenticated, service_role;
revoke all on function public.read_webchat_image_attachment_for_preview(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.read_webchat_image_attachment_for_model(uuid, uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.read_own_webchat_image_attachment_preview(uuid, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.queue_webchat_image_attachment_deletion(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.enqueue_expired_webchat_image_attachments(integer)
from public, anon, authenticated, service_role;
revoke all on function public.claim_webchat_image_deletion_queue(uuid, integer, integer)
from public, anon, authenticated, service_role;
revoke all on function public.complete_webchat_image_deletion(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.retry_webchat_image_deletion(uuid, uuid, text, integer)
from public, anon, authenticated, service_role;
revoke all on function public.list_webchat_image_deletion_dead_letters(integer)
from public, anon, authenticated, service_role;
revoke all on function public.requeue_webchat_image_deletion_dead_letter(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.purge_deleted_webchat_image_attachments(integer)
from public, anon, authenticated, service_role;
revoke all on function public.export_own_data()
from public, anon, authenticated, service_role;
revoke all on function public.delete_auth_user_with_recovery_lease(uuid, uuid)
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
grant execute on function public.bind_webchat_image_attachments(uuid, uuid, text, uuid[])
to service_role;
grant execute on function public.read_webchat_image_attachment_for_preview(uuid, uuid)
to service_role;
grant execute on function public.read_webchat_image_attachment_for_model(uuid, uuid, text, uuid)
to service_role;
grant execute on function public.queue_webchat_image_attachment_deletion(uuid, uuid, text)
to service_role;
grant execute on function public.enqueue_expired_webchat_image_attachments(integer)
to service_role;
grant execute on function public.claim_webchat_image_deletion_queue(uuid, integer, integer)
to service_role;
grant execute on function public.complete_webchat_image_deletion(uuid, uuid)
to service_role;
grant execute on function public.retry_webchat_image_deletion(uuid, uuid, text, integer)
to service_role;
grant execute on function public.list_webchat_image_deletion_dead_letters(integer)
to service_role;
grant execute on function public.requeue_webchat_image_deletion_dead_letter(uuid, text)
to service_role;
grant execute on function public.purge_deleted_webchat_image_attachments(integer)
to service_role;
grant execute on function public.read_own_webchat_image_attachment_preview(uuid, text, uuid)
to authenticated;
grant execute on function public.export_own_data() to authenticated;
grant execute on function public.delete_auth_user_with_recovery_lease(uuid, uuid)
to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'webchat-image-reservation-retention';

select cron.schedule(
  'webchat-image-reservation-retention',
  '*/5 * * * *',
  $command$select public.enqueue_expired_webchat_image_attachments(500);$command$
);

select cron.unschedule(jobid)
from cron.job
where jobname = 'webchat-image-tombstone-retention';

select cron.schedule(
  'webchat-image-tombstone-retention',
  '17 20 * * *',
  $command$select public.purge_deleted_webchat_image_attachments(2000);$command$
);

comment on table private.webchat_image_attachments is
  'Private normalized WebChat image metadata; browser history refers to rows only through stable attachment URNs.';
comment on table private.webchat_image_deletion_outbox is
  'Idempotent Storage deletion outbox with lease fencing, explicit dead letters, and service-role recovery.';
comment on function public.reserve_webchat_image_attachment(uuid, uuid, uuid, text, bigint) is
  'Service-role reservation enforcing per-conversation pending limits, per-user retained Storage/rate limits, and a 30-minute binding window.';
comment on function public.renew_webchat_image_validation(uuid, uuid, uuid, integer) is
  'Renews the owner-fenced validation lease immediately before a bounded external Storage write.';
comment on function public.read_own_webchat_image_attachment_preview(uuid, text, uuid) is
  'Returns safe metadata only when auth.uid() owns the exact attached conversation/message target.';
comment on function public.read_webchat_image_attachment_for_model(uuid, uuid, text, uuid) is
  'Returns an attachment object locator only when user, conversation, message, and attached image identity all match.';
comment on function public.export_own_data() is
  'Returns the existing versioned own-data export with safe WebChat image metadata and without Storage object identifiers.';
comment on function public.delete_auth_user_with_recovery_lease(uuid, uuid) is
  'Freezes WebChat image uploads and fails closed until all attachment objects are confirmed deleted before final Auth/Profile removal.';
