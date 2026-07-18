-- Persist private WebChat conversations for refresh recovery and user-owned
-- history. Conversation content stays in the private schema: authenticated
-- callers can only use target-free RPCs bound to auth.uid(), and administrators
-- receive no cross-user transcript function.

create table private.webchat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  status text not null default 'regular',
  message_count integer not null default 0,
  content_bytes bigint not null default 0,
  next_position bigint not null default 1,
  version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_message_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint webchat_conversations_title_length check (
    title is null or pg_catalog.char_length(title) between 1 and 80
  ),
  constraint webchat_conversations_status_valid check (
    status in ('regular', 'archived')
  ),
  constraint webchat_conversations_message_count_valid check (
    message_count between 0 and 120
  ),
  constraint webchat_conversations_content_bytes_valid check (
    content_bytes between 0 and 1048576
  ),
  constraint webchat_conversations_next_position_valid check (next_position > 0),
  constraint webchat_conversations_version_valid check (version > 0)
);

create index webchat_conversations_user_activity_idx
  on private.webchat_conversations (user_id, status, last_message_at desc, id desc);

create table private.webchat_messages (
  conversation_id uuid not null
    references private.webchat_conversations(id) on delete cascade,
  id text not null,
  parent_id text,
  position bigint not null,
  format text not null,
  content jsonb not null,
  content_bytes integer not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (conversation_id, id),
  unique (conversation_id, position),
  constraint webchat_messages_id_format check (
    id ~ '^[A-Za-z0-9._:-]{1,128}$'
  ),
  constraint webchat_messages_parent_id_format check (
    parent_id is null or parent_id ~ '^[A-Za-z0-9._:-]{1,128}$'
  ),
  constraint webchat_messages_parent_not_self check (parent_id is distinct from id),
  constraint webchat_messages_position_valid check (position > 0),
  constraint webchat_messages_format_valid check (format = 'ai-sdk/v6'),
  constraint webchat_messages_content_object check (pg_catalog.jsonb_typeof(content) = 'object'),
  constraint webchat_messages_content_bytes_valid check (
    content_bytes between 2 and 65536
  )
);

create index webchat_messages_conversation_position_idx
  on private.webchat_messages (conversation_id, position);

alter table private.webchat_conversations enable row level security;
alter table private.webchat_messages enable row level security;

revoke all on table private.webchat_conversations
from public, anon, authenticated, service_role;
revoke all on table private.webchat_messages
from public, anon, authenticated, service_role;

create function private.current_webchat_history_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = actor_id) then
    raise exception 'Member profile not found.' using errcode = '42501';
  end if;

  return actor_id;
end;
$$;

revoke all on function private.current_webchat_history_user()
from public, anon, authenticated, service_role;

create function public.create_own_webchat_conversation()
returns table (
  id uuid,
  title text,
  status text,
  message_count integer,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz,
  last_message_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.current_webchat_history_user();
  conversation_count integer;
begin
  -- Serialize creation with account deletion and parallel browser tabs.
  perform 1 from public.profiles where public.profiles.id = actor_id for update;

  delete from private.webchat_conversations as expired
  where expired.user_id = actor_id
    and expired.last_message_at < pg_catalog.clock_timestamp() - interval '180 days';

  select pg_catalog.count(*)::integer into conversation_count
  from private.webchat_conversations as conversation
  where conversation.user_id = actor_id;

  if conversation_count >= 100 then
    raise exception 'Conversation history limit reached. Delete an older conversation first.'
      using errcode = '54000';
  end if;

  return query
  insert into private.webchat_conversations (user_id)
  values (actor_id)
  returning
    webchat_conversations.id,
    webchat_conversations.title,
    webchat_conversations.status,
    webchat_conversations.message_count,
    webchat_conversations.version,
    webchat_conversations.created_at,
    webchat_conversations.updated_at,
    webchat_conversations.last_message_at;
end;
$$;

create function public.list_own_webchat_conversations(
  requested_limit integer default 31,
  cursor_last_message_at timestamptz default null,
  cursor_id uuid default null
)
returns table (
  id uuid,
  title text,
  status text,
  message_count integer,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz,
  last_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.current_webchat_history_user();
begin
  if requested_limit < 1 or requested_limit > 51 then
    raise exception 'Conversation page limit must be between 1 and 51.' using errcode = '22023';
  end if;
  if (cursor_last_message_at is null) <> (cursor_id is null) then
    raise exception 'Conversation cursor is incomplete.' using errcode = '22023';
  end if;

  return query
  select
    conversation.id,
    conversation.title,
    conversation.status,
    conversation.message_count,
    conversation.version,
    conversation.created_at,
    conversation.updated_at,
    conversation.last_message_at
  from private.webchat_conversations as conversation
  where conversation.user_id = actor_id
    and conversation.last_message_at >= pg_catalog.statement_timestamp() - interval '180 days'
    and (
      cursor_last_message_at is null
      or (conversation.last_message_at, conversation.id) < (cursor_last_message_at, cursor_id)
    )
  order by conversation.last_message_at desc, conversation.id desc
  limit requested_limit;
end;
$$;

create function public.get_own_webchat_conversation(requested_conversation_id uuid)
returns table (
  id uuid,
  title text,
  status text,
  message_count integer,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz,
  last_message_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.current_webchat_history_user();
begin
  if requested_conversation_id is null then
    raise exception 'Conversation ID is required.' using errcode = '22023';
  end if;

  return query
  select
    conversation.id,
    conversation.title,
    conversation.status,
    conversation.message_count,
    conversation.version,
    conversation.created_at,
    conversation.updated_at,
    conversation.last_message_at
  from private.webchat_conversations as conversation
  where conversation.id = requested_conversation_id
    and conversation.user_id = actor_id
    and conversation.last_message_at >= pg_catalog.statement_timestamp() - interval '180 days';
end;
$$;

create function public.rename_own_webchat_conversation(
  requested_conversation_id uuid,
  requested_title text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.current_webchat_history_user();
  normalized_title text := pg_catalog.btrim(requested_title);
begin
  if requested_conversation_id is null
    or normalized_title is null
    or pg_catalog.char_length(normalized_title) not between 1 and 80 then
    raise exception 'Conversation title must contain between 1 and 80 characters.'
      using errcode = '22023';
  end if;

  update private.webchat_conversations as conversation
  set
    title = normalized_title,
    updated_at = pg_catalog.clock_timestamp(),
    version = conversation.version + 1
  where conversation.id = requested_conversation_id
    and conversation.user_id = actor_id;

  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
end;
$$;

create function public.set_own_webchat_conversation_archived(
  requested_conversation_id uuid,
  requested_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.current_webchat_history_user();
begin
  if requested_conversation_id is null or requested_archived is null then
    raise exception 'Conversation and archive state are required.' using errcode = '22023';
  end if;

  update private.webchat_conversations as conversation
  set
    status = case when requested_archived then 'archived' else 'regular' end,
    updated_at = pg_catalog.clock_timestamp(),
    version = conversation.version + 1
  where conversation.id = requested_conversation_id
    and conversation.user_id = actor_id;

  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
end;
$$;

create function public.delete_own_webchat_conversation(requested_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.current_webchat_history_user();
begin
  if requested_conversation_id is null then
    raise exception 'Conversation ID is required.' using errcode = '22023';
  end if;

  delete from private.webchat_conversations as conversation
  where conversation.id = requested_conversation_id
    and conversation.user_id = actor_id;

  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
end;
$$;

create function public.load_own_webchat_messages(requested_conversation_id uuid)
returns table (
  id text,
  parent_id text,
  format text,
  content jsonb,
  position bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.current_webchat_history_user();
begin
  if requested_conversation_id is null then
    raise exception 'Conversation ID is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from private.webchat_conversations as conversation
    where conversation.id = requested_conversation_id
      and conversation.user_id = actor_id
      and conversation.last_message_at >= pg_catalog.statement_timestamp() - interval '180 days'
  ) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  return query
  select message.id, message.parent_id, message.format, message.content, message.position
  from private.webchat_messages as message
  where message.conversation_id = requested_conversation_id
  order by message.position;
end;
$$;

create function public.upsert_own_webchat_message(
  requested_conversation_id uuid,
  requested_message_id text,
  requested_parent_id text,
  requested_format text,
  requested_content jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.current_webchat_history_user();
  checked_at timestamptz := pg_catalog.clock_timestamp();
  conversation private.webchat_conversations%rowtype;
  existing private.webchat_messages%rowtype;
  next_content_bytes integer;
  total_content_bytes bigint;
  inserted_position bigint;
begin
  if requested_conversation_id is null
    or requested_message_id is null
    or requested_message_id !~ '^[A-Za-z0-9._:-]{1,128}$'
    or (requested_parent_id is not null and requested_parent_id !~ '^[A-Za-z0-9._:-]{1,128}$')
    or requested_parent_id is not distinct from requested_message_id
    or requested_format <> 'ai-sdk/v6'
    or pg_catalog.jsonb_typeof(requested_content) <> 'object' then
    raise exception 'Stored WebChat message is invalid.' using errcode = '22023';
  end if;

  next_content_bytes := pg_catalog.octet_length(requested_content::text);
  if next_content_bytes > 65536 then
    raise exception 'Stored WebChat message exceeds 64 KiB.' using errcode = '54000';
  end if;

  select candidate.* into conversation
  from private.webchat_conversations as candidate
  where candidate.id = requested_conversation_id
    and candidate.user_id = actor_id
  for update;

  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  if requested_parent_id is not null and not exists (
    select 1 from private.webchat_messages as parent
    where parent.conversation_id = requested_conversation_id
      and parent.id = requested_parent_id
  ) then
    raise exception 'Stored WebChat parent message was not found.' using errcode = '23503';
  end if;

  select candidate.* into existing
  from private.webchat_messages as candidate
  where candidate.conversation_id = requested_conversation_id
    and candidate.id = requested_message_id;

  if found then
    if existing.parent_id is distinct from requested_parent_id
      or existing.format is distinct from requested_format then
      raise exception 'Stored WebChat message identity conflicts with existing history.'
        using errcode = '23505';
    end if;
    total_content_bytes := conversation.content_bytes - existing.content_bytes + next_content_bytes;
    inserted_position := existing.position;
  else
    if conversation.message_count >= 120 then
      raise exception 'Conversation message limit reached.' using errcode = '54000';
    end if;
    total_content_bytes := conversation.content_bytes + next_content_bytes;
    inserted_position := conversation.next_position;
  end if;

  if total_content_bytes > 1048576 then
    raise exception 'Conversation storage limit reached.' using errcode = '54000';
  end if;

  insert into private.webchat_messages (
    conversation_id,
    id,
    parent_id,
    position,
    format,
    content,
    content_bytes,
    created_at,
    updated_at
  ) values (
    requested_conversation_id,
    requested_message_id,
    requested_parent_id,
    inserted_position,
    requested_format,
    requested_content,
    next_content_bytes,
    checked_at,
    checked_at
  )
  on conflict (conversation_id, id) do update
  set
    content = excluded.content,
    content_bytes = excluded.content_bytes,
    updated_at = excluded.updated_at;

  update private.webchat_conversations as target
  set
    message_count = target.message_count + case when existing.id is null then 1 else 0 end,
    content_bytes = total_content_bytes,
    next_position = target.next_position + case when existing.id is null then 1 else 0 end,
    status = 'regular',
    last_message_at = checked_at,
    updated_at = checked_at,
    version = target.version + 1
  where target.id = requested_conversation_id;

  return inserted_position;
end;
$$;

create function public.delete_own_webchat_messages(
  requested_conversation_id uuid,
  requested_message_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.current_webchat_history_user();
  deleted_count integer := 0;
  deleted_bytes bigint := 0;
begin
  if requested_conversation_id is null
    or requested_message_ids is null
    or pg_catalog.cardinality(requested_message_ids) not between 1 and 120
    or exists (
      select 1 from pg_catalog.unnest(requested_message_ids) as candidate(id)
      where candidate.id !~ '^[A-Za-z0-9._:-]{1,128}$'
    ) then
    raise exception 'Message deletion request is invalid.' using errcode = '22023';
  end if;

  perform 1
  from private.webchat_conversations as conversation
  where conversation.id = requested_conversation_id
    and conversation.user_id = actor_id
  for update;

  if not found then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  with recursive descendants as (
    select message.id
    from private.webchat_messages as message
    where message.conversation_id = requested_conversation_id
      and message.id = any(requested_message_ids)
    union
    select child.id
    from private.webchat_messages as child
    join descendants as parent on child.parent_id = parent.id
    where child.conversation_id = requested_conversation_id
  ), deleted as (
    delete from private.webchat_messages as message
    where message.conversation_id = requested_conversation_id
      and message.id in (select descendants.id from descendants)
    returning message.content_bytes
  )
  select pg_catalog.count(*)::integer, coalesce(pg_catalog.sum(content_bytes), 0)::bigint
  into deleted_count, deleted_bytes
  from deleted;

  if deleted_count > 0 then
    update private.webchat_conversations as conversation
    set
      message_count = greatest(conversation.message_count - deleted_count, 0),
      content_bytes = greatest(conversation.content_bytes - deleted_bytes, 0),
      title = case when conversation.message_count = deleted_count then null else conversation.title end,
      updated_at = pg_catalog.clock_timestamp(),
      last_message_at = pg_catalog.clock_timestamp(),
      version = conversation.version + 1
    where conversation.id = requested_conversation_id;
  end if;

  return deleted_count;
end;
$$;

create function public.purge_expired_webchat_conversations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged_count integer;
begin
  delete from private.webchat_conversations as conversation
  where conversation.last_message_at < pg_catalog.clock_timestamp() - interval '180 days';
  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

revoke all on function public.create_own_webchat_conversation()
from public, anon, authenticated, service_role;
revoke all on function public.list_own_webchat_conversations(integer, timestamptz, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.get_own_webchat_conversation(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.rename_own_webchat_conversation(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.set_own_webchat_conversation_archived(uuid, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.delete_own_webchat_conversation(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.load_own_webchat_messages(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.upsert_own_webchat_message(uuid, text, text, text, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.delete_own_webchat_messages(uuid, text[])
from public, anon, authenticated, service_role;
revoke all on function public.purge_expired_webchat_conversations()
from public, anon, authenticated, service_role;

grant execute on function public.create_own_webchat_conversation() to authenticated;
grant execute on function public.list_own_webchat_conversations(integer, timestamptz, uuid)
to authenticated;
grant execute on function public.get_own_webchat_conversation(uuid) to authenticated;
grant execute on function public.rename_own_webchat_conversation(uuid, text) to authenticated;
grant execute on function public.set_own_webchat_conversation_archived(uuid, boolean)
to authenticated;
grant execute on function public.delete_own_webchat_conversation(uuid) to authenticated;
grant execute on function public.load_own_webchat_messages(uuid) to authenticated;
grant execute on function public.upsert_own_webchat_message(uuid, text, text, text, jsonb)
to authenticated;
grant execute on function public.delete_own_webchat_messages(uuid, text[]) to authenticated;
grant execute on function public.purge_expired_webchat_conversations() to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'webchat-history-retention';

select cron.schedule(
  'webchat-history-retention',
  '30 19 * * *',
  $command$select public.purge_expired_webchat_conversations();$command$
);

comment on table private.webchat_conversations is
  'Private user-owned WebChat thread metadata retained for at most 180 days.';
comment on table private.webchat_messages is
  'Private WebChat message payloads. No administrator transcript reader is exposed.';
comment on function public.list_own_webchat_conversations(integer, timestamptz, uuid) is
  'Lists only the authenticated caller own private WebChat conversations using a cursor.';
comment on function public.load_own_webchat_messages(uuid) is
  'Loads only the authenticated caller own private WebChat transcript.';
comment on function public.purge_expired_webchat_conversations() is
  'Deletes private WebChat conversations whose last activity is older than 180 days.';
