begin;

create extension if not exists pgtap with schema extensions;

select plan(114);

select ok(
  exists (
    select 1
    from storage.buckets as bucket
    where bucket.id = 'webchat-images'
      and bucket.name = 'webchat-images'
      and not bucket.public
      and bucket.file_size_limit = 4194304
      and bucket.allowed_mime_types = array['image/webp']::text[]
  ),
  'the private bucket accepts only normalized WebP objects up to four MiB'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and (
        coalesce(policy.qual, '') like '%webchat-images%'
        or coalesce(policy.with_check, '') like '%webchat-images%'
      )
  ),
  'the migration creates no browser Storage policy for the image bucket'
);

create function pg_temp.webchat_table_has_no_direct_acl(requested_table text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select pg_catalog.bool_and(
    not pg_catalog.has_table_privilege(role_name, requested_table, privilege_name)
  )
  from pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) as role_name
  cross join pg_catalog.unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege_name;
$$;

create function pg_temp.webchat_function_acl_is(
  requested_signature text,
  requested_role text default null
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select pg_catalog.bool_and(
    case
      when role_name = requested_role then
        pg_catalog.has_function_privilege(role_name, requested_signature, 'EXECUTE')
      else
        not pg_catalog.has_function_privilege(role_name, requested_signature, 'EXECUTE')
    end
  )
  from pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) as role_name;
$$;

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'private.webchat_image_upload_state'::regclass)
    and pg_temp.webchat_table_has_no_direct_acl('private.webchat_image_upload_state'),
  'upload freeze state denies anon, authenticated, and service-role CRUD access'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'private.webchat_image_attachments'::regclass)
    and pg_temp.webchat_table_has_no_direct_acl('private.webchat_image_attachments')
    and not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = 'private.webchat_image_attachments'::regclass
        and attribute.attname = 'original_filename'
        and not attribute.attisdropped
    ),
  'attachment metadata denies direct CRUD access and stores no original filename'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'private.webchat_image_deletion_outbox'::regclass)
    and pg_temp.webchat_table_has_no_direct_acl('private.webchat_image_deletion_outbox'),
  'deletion outbox denies anon, authenticated, and service-role CRUD access'
);

select ok(pg_temp.webchat_function_acl_is(
  'public.reserve_webchat_image_attachment(uuid,uuid,uuid,text,bigint)', 'service_role'
), 'reservation RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.start_webchat_image_validation(uuid,uuid,uuid,integer)', 'service_role'
), 'validation-start RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.renew_webchat_image_validation(uuid,uuid,uuid,integer)', 'service_role'
), 'validation-renewal RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.complete_webchat_image_validation(uuid,uuid,uuid,bigint,integer,integer,text)', 'service_role'
), 'validation-completion RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.fail_webchat_image_validation(uuid,uuid,uuid,text)', 'service_role'
), 'validation-failure RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.bind_webchat_image_attachments(uuid,uuid,text,uuid[])', 'service_role'
), 'explicit binding RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.read_webchat_image_attachment_for_preview(uuid,uuid)', 'service_role'
), 'object-locator preview RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.read_webchat_image_attachment_for_model(uuid,uuid,text,uuid)', 'service_role'
), 'target-bound model attachment RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.queue_webchat_image_attachment_deletion(uuid,uuid,text)', 'service_role'
), 'deletion-enqueue RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.enqueue_expired_webchat_image_attachments(integer)', 'service_role'
), 'expiry retention RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.claim_webchat_image_deletion_queue(uuid,integer,integer)', 'service_role'
), 'deletion claim RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.complete_webchat_image_deletion(uuid,uuid)', 'service_role'
), 'deletion completion RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.retry_webchat_image_deletion(uuid,uuid,text,integer)', 'service_role'
), 'deletion retry RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.list_webchat_image_deletion_dead_letters(integer)', 'service_role'
), 'dead-letter listing RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.requeue_webchat_image_deletion_dead_letter(uuid,text)', 'service_role'
), 'dead-letter requeue RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.purge_deleted_webchat_image_attachments(integer)', 'service_role'
), 'tombstone purge RPC is service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.delete_auth_user_with_recovery_lease(uuid,uuid)', 'service_role'
), 'fenced Auth deletion RPC remains service-role-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.read_own_webchat_image_attachment_preview(uuid,text,uuid)', 'authenticated'
), 'safe target-bound preview RPC is authenticated-only');
select ok(pg_temp.webchat_function_acl_is(
  'public.export_own_data()', 'authenticated'
), 'personal export RPC is authenticated-only');

select ok(pg_temp.webchat_function_acl_is(
  'private.webchat_image_ids_from_message(jsonb)'
), 'message image parser has no client or service-role execute grant');
select ok(pg_temp.webchat_function_acl_is(
  'private.enqueue_webchat_image_deletion(uuid,text)'
), 'private deletion enqueue has no client or service-role execute grant');
select ok(pg_temp.webchat_function_acl_is(
  'private.bind_webchat_image_attachments_internal(uuid,uuid,text,uuid[])'
), 'private attachment binder has no client or service-role execute grant');
select ok(pg_temp.webchat_function_acl_is(
  'private.bind_webchat_image_message_trigger()'
), 'message binding trigger has no client or service-role execute grant');
select ok(pg_temp.webchat_function_acl_is(
  'private.queue_webchat_image_message_deletion()'
), 'message deletion trigger has no client or service-role execute grant');
select ok(pg_temp.webchat_function_acl_is(
  'private.queue_webchat_image_conversation_deletion()'
), 'conversation deletion trigger has no client or service-role execute grant');
select ok(pg_temp.webchat_function_acl_is(
  'private.export_own_data_without_webchat_images()'
), 'wrapped legacy export has no client or service-role execute grant');

-- The global migration is deliberately fail-closed. This test exercises the
-- attachment state machine after an explicit local-only enable inside rollback.
update private.webchat_global_quota_state
set
  image_uploads_paused = false,
  image_hourly_attachment_limit = 10000,
  image_hourly_original_bytes_limit = 1099511627776,
  image_storage_capacity_bytes = 1099511627776,
  image_max_active_validations = 100,
  updated_at = pg_catalog.clock_timestamp()
where singleton;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004201',
    'authenticated', 'authenticated', 'image-member-a@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Image Member A"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004202',
    'authenticated', 'authenticated', 'image-member-b@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Image Member B"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004203',
    'authenticated', 'authenticated', 'image-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Image Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004205',
    'authenticated', 'authenticated', 'image-count-limit@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Image Count Limit"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004206',
    'authenticated', 'authenticated', 'image-byte-limit@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Image Byte Limit"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004207',
    'authenticated', 'authenticated', 'image-rate-limit@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Image Rate Limit"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  review_status = 'approved',
  role = case
    when id = '00000000-0000-4000-8000-000000004203'
      then 'admin'::public.app_role
    else 'member'::public.app_role
  end
where id in (
  '00000000-0000-4000-8000-000000004201',
  '00000000-0000-4000-8000-000000004202',
  '00000000-0000-4000-8000-000000004203',
  '00000000-0000-4000-8000-000000004205',
  '00000000-0000-4000-8000-000000004206',
  '00000000-0000-4000-8000-000000004207'
);

insert into private.webchat_conversations (id, user_id, title)
values
  (
    '42010000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000004201',
    'Member A image conversation'
  ),
  (
    '42010000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000004201',
    'Member A byte quota conversation'
  ),
  (
    '42010000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000004201',
    'Member A cross-user isolation conversation'
  ),
  (
    '42010000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000004201',
    'Member A normalized-byte quota conversation'
  ),
  (
    '42010000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000004201',
    'Member A late-write fence conversation'
  ),
  (
    '42010000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000004201',
    'Member A cascade deletion conversation'
  ),
  (
    '42020000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000004202',
    'Member B image conversation'
  ),
  (
    '42050000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000004205',
    'Retained object count limit'
  ),
  (
    '42060000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000004206',
    'Retained object byte limit'
  ),
  (
    '42070000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000004207',
    'Rolling upload rate limit'
  );

set local role service_role;
create temporary table image_reserved_a1 as
select *
from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000001',
  '42110000-0000-4000-8000-000000000001',
  'IMAGE/PNG',
  1048576
);
reset role;

select ok(
  exists (
    select 1
    from image_reserved_a1
    where status = 'reserved'
      and bucket_id = 'webchat-images'
      and object_key = 'user/00000000-0000-4000-8000-000000004201/conversation/42010000-0000-4000-8000-000000000001/attachment/42110000-0000-4000-8000-000000000001.webp'
      and expires_at > pg_catalog.statement_timestamp()
      and expires_at <= pg_catalog.statement_timestamp() + interval '30 minutes 1 second'
  ),
  'reservation returns a private scoped object key and thirty-minute expiry'
);

set local role service_role;
create temporary table image_reserved_a1_retry as
select *
from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000001',
  '42110000-0000-4000-8000-000000000001',
  'image/png',
  1048576
);
reset role;

select ok(
  (select pg_catalog.count(*) = 1 from image_reserved_a1_retry)
    and (
      select pg_catalog.count(*) = 1
      from private.webchat_image_attachments
      where id = '42110000-0000-4000-8000-000000000001'
    ),
  'repeating an identical reservation is idempotent and consumes one slot'
);

set local role service_role;
select throws_ok(
  $$
    select *
    from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004201',
      '42010000-0000-4000-8000-000000000001',
      '42110000-0000-4000-8000-000000000001',
      'image/png',
      1048577
    )
  $$,
  '23505',
  'WebChat image reservation identity conflicts with an existing attachment.',
  'an idempotency key cannot be reused for different bytes'
);
reset role;

set local role service_role;
create temporary table image_validation_a1 as
select *
from public.start_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42110000-0000-4000-8000-000000000001',
  '42110000-0000-4000-8000-000000000101',
  300
);
reset role;

select is(
  (select status from image_validation_a1),
  'validating',
  'the validation lease moves a reservation to validating'
);

set local role service_role;
create temporary table image_validation_renewed_a1 as
select *
from public.renew_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42110000-0000-4000-8000-000000000001',
  '42110000-0000-4000-8000-000000000101',
  600
);
reset role;

select ok(
  (select status = 'validating' from image_validation_renewed_a1)
    and exists (
      select 1
      from private.webchat_image_attachments
      where id = '42110000-0000-4000-8000-000000000001'
        and validation_owner_token = '42110000-0000-4000-8000-000000000101'
        and validation_lease_expires_at >= pg_catalog.statement_timestamp() + interval '9 minutes'
    ),
  'the current validator renews its lease before the bounded Storage write'
);

set local role service_role;
select throws_ok(
  $$
    select *
    from public.renew_webchat_image_validation(
      '00000000-0000-4000-8000-000000004201',
      '42110000-0000-4000-8000-000000000001',
      '42110000-0000-4000-8000-000000000102',
      600
    )
  $$,
  '55000',
  'WebChat image validation lease is unavailable.',
  'another validator cannot renew an owned lease'
);
reset role;

set local role service_role;
select throws_ok(
  $$
    select *
    from public.start_webchat_image_validation(
      '00000000-0000-4000-8000-000000004201',
      '42110000-0000-4000-8000-000000000001',
      '42110000-0000-4000-8000-000000000102',
      300
    )
  $$,
  '55000',
  'WebChat image attachment is unavailable for validation.',
  'another validator cannot steal a live lease'
);
reset role;

set local role service_role;
select throws_ok(
  $$
    select *
    from public.complete_webchat_image_validation(
      '00000000-0000-4000-8000-000000004201',
      '42110000-0000-4000-8000-000000000001',
      '42110000-0000-4000-8000-000000000101',
      900000,
      2049,
      2048,
      repeat('a', 64)
    )
  $$,
  '22023',
  'Normalized WebChat image metadata is invalid.',
  'decoded dimensions must also respect the 2048-by-2048 ceiling'
);
reset role;

set local role service_role;
create temporary table image_ready_a1 as
select *
from public.complete_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42110000-0000-4000-8000-000000000001',
  '42110000-0000-4000-8000-000000000101',
  900000,
  1600,
  900,
  repeat('a', 64)
);
reset role;

select ok(
  exists (
    select 1 from image_ready_a1
    where status = 'ready'
      and media_type = 'image/webp'
      and object_bytes = 900000
      and width = 1600
      and height = 900
  ),
  'successful validation records only normalized WebP metadata'
);

set local role service_role;
create temporary table image_ready_a1_retry as
select *
from public.complete_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42110000-0000-4000-8000-000000000001',
  '42110000-0000-4000-8000-000000000101',
  900000,
  1600,
  900,
  repeat('a', 64)
);
reset role;

select is(
  (select status from image_ready_a1_retry),
  'ready',
  'a lost validation-completion response can be replayed idempotently'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004201', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004201","role":"authenticated"}',
  true
);
set local role authenticated;
select public.upsert_own_webchat_message(
  '42010000-0000-4000-8000-000000000001',
  'image-message-a1',
  null,
  'ai-sdk/v6',
  '{"role":"user","parts":[{"type":"text","text":"Explain this image"},{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42110000-0000-4000-8000-000000000001"}]}'::jsonb
);
reset role;

select ok(
  exists (
    select 1
    from private.webchat_image_attachments
    where id = '42110000-0000-4000-8000-000000000001'
      and status = 'attached'
      and message_id = 'image-message-a1'
      and attached_at is not null
  ),
  'history persistence atomically binds a ready URN to its exact message'
);

set local role service_role;
select throws_ok(
  $$
    select public.queue_webchat_image_attachment_deletion(
      '00000000-0000-4000-8000-000000004201',
      '42110000-0000-4000-8000-000000000001',
      'manual_cleanup'
    )
  $$,
  '55000',
  'WebChat image attachment is not an unbound draft.',
  'direct removal cannot delete an attachment still referenced by message history'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004201', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004201","role":"authenticated"}',
  true
);
set local role authenticated;
select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'external-image-message',
      'image-message-a1',
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"file","mediaType":"image/png","url":"https://example.test/private.png"}]}'::jsonb
    )
  $$,
  '22023',
  'Stored WebChat images require the exact normalized file-part protocol.',
  'history rejects a file part outside the normalized attachment protocol'
);
reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from private.webchat_messages
    where conversation_id = '42010000-0000-4000-8000-000000000001'
      and id = 'external-image-message'
  ),
  0,
  'a rejected image message leaves no partial history row'
);

set local role authenticated;
select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'image-alias-message',
      null,
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"image","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42110000-0000-4000-8000-000000000001"}]}'::jsonb
    )
  $$,
  '22023',
  'Stored WebChat message contains an unsupported embedded image reference.',
  'history rejects the image part alias'
);

select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'assistant-image-message',
      null,
      'ai-sdk/v6',
      '{"role":"assistant","parts":[{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42110000-0000-4000-8000-000000000001"}]}'::jsonb
    )
  $$,
  '22023',
  'Only user WebChat messages may contain image attachments.',
  'assistant history cannot contain attachment URNs'
);

select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'system-image-message',
      null,
      'ai-sdk/v6',
      '{"role":"system","parts":[{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42110000-0000-4000-8000-000000000001"}]}'::jsonb
    )
  $$,
  '22023',
  'Only user WebChat messages may contain image attachments.',
  'system history cannot contain attachment URNs'
);

select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'extra-image-field-message',
      null,
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42110000-0000-4000-8000-000000000001","name":"secret.png"}]}'::jsonb
    )
  $$,
  '22023',
  'Stored WebChat images require the exact normalized file-part protocol.',
  'file parts reject original filenames and every fourth field'
);

select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'data-url-image-message',
      null,
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"file","mediaType":"image/webp","url":"data:image/webp;base64,UklGRg=="}]}'::jsonb
    )
  $$,
  '22023',
  'Stored WebChat images require the exact normalized file-part protocol.',
  'history rejects data URLs in file parts'
);

select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'base64-text-message',
      null,
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"text","text":"payload;BASE64,UklGRg=="}]}'::jsonb
    )
  $$,
  '22023',
  'Stored WebChat message contains an unsupported embedded image reference.',
  'history rejects Base64 image payload markers in non-file parts'
);

select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'object-key-text-message',
      null,
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"text","text":"user/00000000-0000-4000-8000-000000004201/conversation/42010000-0000-4000-8000-000000000001/attachment/42110000-0000-4000-8000-000000000001.webp"}]}'::jsonb
    )
  $$,
  '22023',
  'Stored WebChat message contains an unsupported embedded image reference.',
  'history rejects private Storage object keys in non-file parts'
);

select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'bucket-name-text-message',
      null,
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"text","text":"webchat-images"}]}'::jsonb
    )
  $$,
  '22023',
  'Stored WebChat message contains an unsupported embedded image reference.',
  'history rejects the private bucket identifier in non-file parts'
);

select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'non-file-url-message',
      null,
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"text","text":"link","url":"https://example.test/image.webp"}]}'::jsonb
    )
  $$,
  '22023',
  'Stored WebChat message contains an unsupported embedded image reference.',
  'history rejects URL fields on non-file parts'
);

select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'duplicate-image-urn-message',
      null,
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42110000-0000-4000-8000-000000000001"},{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42110000-0000-4000-8000-000000000001"}]}'::jsonb
    )
  $$,
  '22023',
  'Stored WebChat image attachment is duplicated.',
  'one stored message cannot repeat an attachment URN'
);

select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42010000-0000-4000-8000-000000000001',
      'five-image-urn-message',
      null,
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42150000-0000-4000-8000-000000000001"},{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42150000-0000-4000-8000-000000000002"},{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42150000-0000-4000-8000-000000000003"},{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42150000-0000-4000-8000-000000000004"},{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42150000-0000-4000-8000-000000000005"}]}'::jsonb
    )
  $$,
  '54000',
  'A WebChat message may contain at most four images.',
  'one stored message cannot reference more than four attachments'
);
reset role;

select ok(
  private.webchat_image_ids_from_message(
    '{"role":"user","parts":[{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:0190f000-0000-7000-8000-000000000001"}]}'::jsonb
  ) = array['0190f000-0000-7000-8000-000000000001'::uuid],
  'the canonical attachment protocol accepts UUIDv7 identities used by reservation'
);

set local role service_role;
select *
from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000003',
  '42110000-0000-4000-8000-000000000002',
  'image/jpeg',
  500000
);
select *
from public.start_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42110000-0000-4000-8000-000000000002',
  '42110000-0000-4000-8000-000000000103',
  300
);
select *
from public.complete_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42110000-0000-4000-8000-000000000002',
  '42110000-0000-4000-8000-000000000103',
  400000,
  800,
  600,
  repeat('b', 64)
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004202', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004202","role":"authenticated"}',
  true
);
set local role authenticated;
select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      '42020000-0000-4000-8000-000000000001',
      'cross-member-image-message',
      null,
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42110000-0000-4000-8000-000000000002"}]}'::jsonb
    )
  $$,
  '42501',
  'WebChat image attachment is unavailable or belongs to another target.',
  'a member cannot bind another member attachment into own history'
);
reset role;

select is(
  (
    select status
    from private.webchat_image_attachments
    where id = '42110000-0000-4000-8000-000000000002'
  ),
  'ready',
  'a rejected cross-member write rolls back the attempted attachment transition'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004201', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004201","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table own_image_preview as
select *
from public.read_own_webchat_image_attachment_preview(
  '42010000-0000-4000-8000-000000000001',
  'image-message-a1',
  '42110000-0000-4000-8000-000000000001'
);
reset role;

select ok(
  exists (
    select 1 from own_image_preview
    where urn = 'urn:ustsacm:webchat-attachment:42110000-0000-4000-8000-000000000001'
      and media_type = 'image/webp'
      and object_bytes = 900000
  ),
  'the owner receives safe metadata for the exact attached target'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004202', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004202","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table cross_member_preview as
select *
from public.read_own_webchat_image_attachment_preview(
  '42010000-0000-4000-8000-000000000001',
  'image-message-a1',
  '42110000-0000-4000-8000-000000000001'
);
reset role;

select is(
  (select pg_catalog.count(*)::integer from cross_member_preview),
  0,
  'another member receives no preview metadata for a foreign target'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004203', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004203","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table admin_cross_member_preview as
select *
from public.read_own_webchat_image_attachment_preview(
  '42010000-0000-4000-8000-000000000001',
  'image-message-a1',
  '42110000-0000-4000-8000-000000000001'
);
reset role;

select is(
  (select pg_catalog.count(*)::integer from admin_cross_member_preview),
  0,
  'administrator role grants no cross-member attachment preview bypass'
);

set local role service_role;
create temporary table service_image_preview as
select *
from public.read_webchat_image_attachment_for_preview(
  '00000000-0000-4000-8000-000000004201',
  '42110000-0000-4000-8000-000000000001'
);
reset role;

select ok(
  exists (
    select 1 from service_image_preview
    where bucket_id = 'webchat-images'
      and object_key like 'user/00000000-0000-4000-8000-000000004201/%'
      and sha256 = repeat('a', 64)
  ),
  'only the service preview projection exposes the object locator and digest'
);

set local role service_role;
create temporary table exact_model_image_read as
select *
from public.read_webchat_image_attachment_for_model(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000001',
  'image-message-a1',
  '42110000-0000-4000-8000-000000000001'
);
reset role;

select ok(
  exists (
    select 1
    from exact_model_image_read
    where bucket_id = 'webchat-images'
      and object_key = 'user/00000000-0000-4000-8000-000000004201/conversation/42010000-0000-4000-8000-000000000001/attachment/42110000-0000-4000-8000-000000000001.webp'
      and media_type = 'image/webp'
      and object_bytes = 900000
      and width = 1600
      and height = 900
      and sha256 = repeat('a', 64)
  ),
  'model image read returns the object only for the exact attached target'
);

set local role service_role;
select is(
  (
    select pg_catalog.count(*)::integer
    from public.read_webchat_image_attachment_for_model(
      '00000000-0000-4000-8000-000000004201',
      '42010000-0000-4000-8000-000000000003',
      'image-message-a1',
      '42110000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'model image read rejects a cross-conversation target'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.read_webchat_image_attachment_for_model(
      '00000000-0000-4000-8000-000000004201',
      '42010000-0000-4000-8000-000000000001',
      'different-message',
      '42110000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'model image read rejects a cross-message target'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.read_webchat_image_attachment_for_model(
      '00000000-0000-4000-8000-000000004202',
      '42010000-0000-4000-8000-000000000001',
      'image-message-a1',
      '42110000-0000-4000-8000-000000000001'
    )
  ),
  0,
  'model image read rejects a cross-user target'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.read_webchat_image_attachment_for_model(
      '00000000-0000-4000-8000-000000004201',
      '42010000-0000-4000-8000-000000000003',
      'unbound-message',
      '42110000-0000-4000-8000-000000000002'
    )
  ),
  0,
  'model image read rejects a ready attachment that is not bound to history'
);
reset role;

set local role service_role;
create temporary table eight_pending_images as
select reservation.id
from pg_catalog.generate_series(10, 17) as number(value)
cross join lateral public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000001',
  ('42110000-0000-4000-8000-' || pg_catalog.lpad(number.value::text, 12, '0'))::uuid,
  'image/png',
  1048576
) as reservation;
reset role;

select is(
  (select pg_catalog.count(*)::integer from eight_pending_images),
  8,
  'one conversation may hold exactly eight pending images'
);

set local role service_role;
select throws_ok(
  $$
    select *
    from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004201',
      '42010000-0000-4000-8000-000000000001',
      '42110000-0000-4000-8000-000000000018',
      'image/png',
      1
    )
  $$,
  '54000',
  'WebChat conversation has eight pending images.',
  'the ninth pending image is rejected under the conversation lock'
);
reset role;

set local role service_role;
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000002',
  '42120000-0000-4000-8000-000000000001', 'image/png', 4194304
);
select * from public.start_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42120000-0000-4000-8000-000000000001',
  '42120000-0000-4000-8000-000000000101', 300
);
select * from public.complete_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42120000-0000-4000-8000-000000000001',
  '42120000-0000-4000-8000-000000000101',
  1, 1, 1, repeat('c', 64)
);
reset role;
select is(
  (
    select object_bytes
    from private.webchat_image_attachments
    where id = '42120000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'normalization may compress a four-MiB input to a smaller stored object'
);
set local role service_role;
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000002',
  '42120000-0000-4000-8000-000000000002', 'image/png', 4194304
);
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000002',
  '42120000-0000-4000-8000-000000000003', 'image/png', 4194304
);
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000002',
  '42120000-0000-4000-8000-000000000004', 'image/png', 4194304
);
select throws_ok(
  $$
    select * from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004201',
      '42010000-0000-4000-8000-000000000002',
      '42120000-0000-4000-8000-000000000005', 'image/png', 1
    )
  $$,
  '54000',
  'WebChat conversation pending images exceed 16 MiB.',
  'compression does not release the independent sixteen-MiB original-input quota'
);
reset role;

set local role service_role;
create temporary table normalized_quota_reservations as
select reservation.id
from pg_catalog.generate_series(1, 5) as number(value)
cross join lateral public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000004',
  ('42130000-0000-4000-8000-' || pg_catalog.lpad(number.value::text, 12, '0'))::uuid,
  'image/png',
  1
) as reservation;

create temporary table normalized_quota_validations as
select validation.status
from pg_catalog.generate_series(1, 4) as number(value)
cross join lateral public.start_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  ('42130000-0000-4000-8000-' || pg_catalog.lpad(number.value::text, 12, '0'))::uuid,
  ('42130000-0000-4000-8000-' || pg_catalog.lpad((100 + number.value)::text, 12, '0'))::uuid,
  300
) as validation;

create temporary table normalized_quota_ready as
select completed.id
from pg_catalog.generate_series(1, 4) as number(value)
cross join lateral public.complete_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  ('42130000-0000-4000-8000-' || pg_catalog.lpad(number.value::text, 12, '0'))::uuid,
  ('42130000-0000-4000-8000-' || pg_catalog.lpad((100 + number.value)::text, 12, '0'))::uuid,
  4194304,
  2048,
  2048,
  repeat(pg_catalog.substr('abcdef', number.value, 1), 64)
) as completed;
reset role;

select is(
  (
    select pg_catalog.sum(object_bytes)::bigint
    from private.webchat_image_attachments
    where conversation_id = '42010000-0000-4000-8000-000000000004'
  ),
  16777216::bigint,
  'four normalized objects may use exactly sixteen MiB independently of input bytes'
);

set local role service_role;
select * from public.start_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42130000-0000-4000-8000-000000000005',
  '42130000-0000-4000-8000-000000000105',
  300
);
select throws_ok(
  $$
    select * from public.complete_webchat_image_validation(
      '00000000-0000-4000-8000-000000004201',
      '42130000-0000-4000-8000-000000000005',
      '42130000-0000-4000-8000-000000000105',
      1,
      1,
      1,
      repeat('a', 64)
    )
  $$,
  '54000',
  'WebChat conversation pending images exceed 16 MiB.',
  'normalized object bytes enforce their own sixteen-MiB pending quota'
);
reset role;

with attachment_ids as (
  select pg_catalog.gen_random_uuid() as id, number.value
  from pg_catalog.generate_series(1, 200) as number(value)
)
insert into private.webchat_image_attachments (
  id,
  user_id,
  conversation_id,
  message_id,
  status,
  object_key,
  original_mime,
  original_bytes,
  normalized_mime,
  object_bytes,
  width,
  height,
  sha256,
  reserved_at,
  ready_at,
  attached_at,
  expires_at
)
select
  attachment.id,
  '00000000-0000-4000-8000-000000004205',
  '42050000-0000-4000-8000-000000000001',
  'count-limit-' || attachment.value::text,
  'attached',
  'user/00000000-0000-4000-8000-000000004205/conversation/42050000-0000-4000-8000-000000000001/attachment/'
    || attachment.id::text || '.webp',
  'image/png',
  1,
  'image/webp',
  1,
  1,
  1,
  repeat('a', 64),
  pg_catalog.statement_timestamp() - interval '2 hours',
  pg_catalog.statement_timestamp() - interval '2 hours',
  pg_catalog.statement_timestamp() - interval '2 hours',
  pg_catalog.statement_timestamp() - interval '90 minutes'
from attachment_ids as attachment;

set local role service_role;
select throws_ok(
  $$
    select * from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004205',
      '42050000-0000-4000-8000-000000000001',
      '42510000-0000-4000-8000-000000000001',
      'image/png',
      1
    )
  $$,
  '54000',
  'WebChat member retained image count limit reached.',
  'a member cannot retain more than two hundred undeleted image attachments'
);
reset role;

with attachment_ids as (
  select pg_catalog.gen_random_uuid() as id, number.value
  from pg_catalog.generate_series(1, 16) as number(value)
)
insert into private.webchat_image_attachments (
  id,
  user_id,
  conversation_id,
  message_id,
  status,
  object_key,
  original_mime,
  original_bytes,
  normalized_mime,
  object_bytes,
  width,
  height,
  sha256,
  reserved_at,
  ready_at,
  attached_at,
  expires_at
)
select
  attachment.id,
  '00000000-0000-4000-8000-000000004206',
  '42060000-0000-4000-8000-000000000001',
  'byte-limit-' || attachment.value::text,
  'attached',
  'user/00000000-0000-4000-8000-000000004206/conversation/42060000-0000-4000-8000-000000000001/attachment/'
    || attachment.id::text || '.webp',
  'image/png',
  4194304,
  'image/webp',
  4194304,
  2048,
  2048,
  repeat('b', 64),
  pg_catalog.statement_timestamp() - interval '2 hours',
  pg_catalog.statement_timestamp() - interval '2 hours',
  pg_catalog.statement_timestamp() - interval '2 hours',
  pg_catalog.statement_timestamp() - interval '90 minutes'
from attachment_ids as attachment;

set local role service_role;
select throws_ok(
  $$
    select * from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004206',
      '42060000-0000-4000-8000-000000000001',
      '42610000-0000-4000-8000-000000000001',
      'image/png',
      1
    )
  $$,
  '54000',
  'WebChat member retained images exceed 64 MiB.',
  'a member cannot reserve an image beyond the sixty-four-MiB retained Storage limit'
);
reset role;

insert into private.webchat_image_attachments (
  id,
  user_id,
  conversation_id,
  status,
  bucket_id,
  object_key,
  original_mime,
  original_bytes,
  deletion_requested_at,
  deleted_at,
  reserved_at,
  expires_at,
  created_at,
  updated_at
)
select
  ('42700000-0000-4000-8000-' || pg_catalog.lpad(number.value::text, 12, '0'))::uuid,
  '00000000-0000-4000-8000-000000004207'::uuid,
  '42070000-0000-4000-8000-000000000001'::uuid,
  'deleted',
  'webchat-images',
  'user/00000000-0000-4000-8000-000000004207'
    || '/conversation/42070000-0000-4000-8000-000000000001'
    || '/attachment/42700000-0000-4000-8000-'
    || pg_catalog.lpad(number.value::text, 12, '0') || '.webp',
  'image/png',
  1,
  pg_catalog.statement_timestamp() - interval '1 minute',
  pg_catalog.statement_timestamp() - interval '1 minute',
  case
    when number.value = 30 then pg_catalog.statement_timestamp() - interval '61 minutes'
    else pg_catalog.statement_timestamp() - interval '30 minutes'
  end,
  case
    when number.value = 30 then pg_catalog.statement_timestamp() - interval '31 minutes'
    else pg_catalog.statement_timestamp()
  end,
  pg_catalog.statement_timestamp() - interval '61 minutes',
  pg_catalog.statement_timestamp() - interval '1 minute'
from pg_catalog.generate_series(1, 30) as number(value);

set local role service_role;
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004207',
  '42070000-0000-4000-8000-000000000001',
  '42710000-0000-4000-8000-000000000001',
  'image/png',
  1
);
reset role;

select ok(
  (
    select pg_catalog.count(*) = 30
    from private.webchat_image_attachments
    where user_id = '00000000-0000-4000-8000-000000004207'
      and reserved_at > pg_catalog.clock_timestamp() - interval '1 hour'
  )
    and exists (
      select 1
      from private.webchat_image_attachments
      where id = '42700000-0000-4000-8000-000000000030'
        and reserved_at < pg_catalog.clock_timestamp() - interval '1 hour'
    ),
  'the rolling limiter excludes only reservations older than one hour'
);

set local role service_role;
select throws_ok(
  $$
    select * from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004207',
      '42070000-0000-4000-8000-000000000001',
      '42710000-0000-4000-8000-000000000002',
      'image/png',
      1
    )
  $$,
  '54000',
  'WebChat member image upload rate limit reached.',
  'the rolling upload limiter rejects a thirty-first reservation in the trailing hour'
);
reset role;

set local role service_role;
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000005',
  '42140000-0000-4000-8000-000000000001',
  'image/png',
  100
);
select * from public.start_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42140000-0000-4000-8000-000000000001',
  '42140000-0000-4000-8000-000000000101',
  600
);
reset role;

update private.webchat_image_attachments
set
  reserved_at = pg_catalog.statement_timestamp() - interval '31 minutes',
  expires_at = pg_catalog.statement_timestamp() - interval '1 minute'
where id = '42140000-0000-4000-8000-000000000001';

set local role service_role;
select ok(
  public.enqueue_expired_webchat_image_attachments(100) >= 1,
  'expiry retention queues an expired image even while validation is still leased'
);
reset role;

select ok(
  exists (
    select 1
    from private.webchat_image_attachments as attachment
    join private.webchat_image_deletion_outbox as queue
      on queue.attachment_id = attachment.id
    where attachment.id = '42140000-0000-4000-8000-000000000001'
      and attachment.status = 'deleting'
      and attachment.validation_owner_token = '42140000-0000-4000-8000-000000000101'
      and queue.available_at >= attachment.validation_lease_expires_at + interval '2 minutes'
  ),
  'expiry enqueue preserves the validation lease and adds a late-write safety window'
);

set local role service_role;
create temporary table early_expiry_deletion_claim as
select *
from public.claim_webchat_image_deletion_queue(
  '42140000-0000-4000-8000-000000000201',
  100,
  300
);
reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from early_expiry_deletion_claim
    where attachment_id = '42140000-0000-4000-8000-000000000001'
  ),
  0,
  'an interleaved cleanup claim cannot cross an active validation lease'
);

update private.webchat_image_attachments
set validation_lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where id = '42140000-0000-4000-8000-000000000001';

update private.webchat_image_deletion_outbox
set
  available_at = pg_catalog.clock_timestamp() - interval '1 second',
  claimed_by = '42140000-0000-4000-8000-000000000301',
  lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second',
  attempt_count = 25
where attachment_id = '42140000-0000-4000-8000-000000000001';

set local role service_role;
create temporary table crashed_expiry_deletion_claim as
select *
from public.claim_webchat_image_deletion_queue(
  '42140000-0000-4000-8000-000000000302',
  100,
  300
);
reset role;

select ok(
  not exists (
    select 1
    from crashed_expiry_deletion_claim
    where attachment_id = '42140000-0000-4000-8000-000000000001'
  )
    and exists (
      select 1
      from private.webchat_image_deletion_outbox
      where attachment_id = '42140000-0000-4000-8000-000000000001'
        and attempt_count = 25
        and dead_lettered_at is not null
        and claimed_by is null
        and lease_expires_at is null
    ),
  'an expired crashed twenty-fifth deletion lease is dead-lettered before a new claim'
);

set local role service_role;
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004202',
  '42020000-0000-4000-8000-000000000001',
  '42210000-0000-4000-8000-000000000001', 'image/webp', 200000
);
select * from public.start_webchat_image_validation(
  '00000000-0000-4000-8000-000000004202',
  '42210000-0000-4000-8000-000000000001',
  '42210000-0000-4000-8000-000000000101', 300
);
select public.fail_webchat_image_validation(
  '00000000-0000-4000-8000-000000004202',
  '42210000-0000-4000-8000-000000000001',
  '42210000-0000-4000-8000-000000000101', 'decode_failed'
);
reset role;

select ok(
  exists (
    select 1
    from private.webchat_image_attachments as attachment
    join private.webchat_image_deletion_outbox as queue
      on queue.attachment_id = attachment.id
    where attachment.id = '42210000-0000-4000-8000-000000000001'
      and attachment.status = 'failed'
      and attachment.failure_code = 'decode_failed'
      and queue.reason = 'validation_failed'
      and queue.available_at >= attachment.validation_started_at + interval '7 minutes'
      and queue.completed_at is null
  ),
  'validation failure is explicit and preserves the write grace in one durable outbox item'
);

set local role service_role;
select ok(
  public.fail_webchat_image_validation(
    '00000000-0000-4000-8000-000000004202',
    '42210000-0000-4000-8000-000000000001',
    '42210000-0000-4000-8000-000000000101', 'decode_failed'
  ),
  'replaying the same validation failure is idempotent'
);
reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from private.webchat_image_deletion_outbox
    where attachment_id = '42210000-0000-4000-8000-000000000001'
  ),
  1,
  'failure replay cannot duplicate the deletion outbox row'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004201', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004201","role":"authenticated"}',
  true
);
set local role authenticated;
select public.upsert_own_webchat_message(
  '42010000-0000-4000-8000-000000000001',
  'image-message-a1',
  null,
  'ai-sdk/v6',
  '{"role":"user","parts":[{"type":"text","text":"Image removed from history"}]}'::jsonb
);
reset role;

select ok(
  exists (
    select 1
    from private.webchat_image_attachments as attachment
    join private.webchat_image_deletion_outbox as queue
      on queue.attachment_id = attachment.id
    where attachment.id = '42110000-0000-4000-8000-000000000001'
      and attachment.status = 'deleting'
      and queue.reason = 'message_attachment_removed'
  ),
  'removing a URN from stored history queues its object without exposing the key'
);

set local role service_role;
select ok(
  public.queue_webchat_image_attachment_deletion(
    '00000000-0000-4000-8000-000000004201',
    '42110000-0000-4000-8000-000000000001',
    'manual_cleanup'
  ),
  'explicit deletion queueing is idempotent for an already queued object'
);
reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from private.webchat_image_deletion_outbox
    where attachment_id = '42110000-0000-4000-8000-000000000001'
  ),
  1,
  'multiple deletion sources converge on one outbox identity'
);

-- The validation-failure fixture above intentionally preserves its upload
-- grace window. Advance only that fixture before exercising deletion retries.
update private.webchat_image_deletion_outbox
set available_at = pg_catalog.clock_timestamp() - interval '1 second'
where attachment_id = '42210000-0000-4000-8000-000000000001';

set local role service_role;
create temporary table claimed_image_deletions as
select *
from public.claim_webchat_image_deletion_queue(
  '42990000-0000-4000-8000-000000000001',
  100,
  300
);
create temporary table duplicate_image_deletion_claim as
select *
from public.claim_webchat_image_deletion_queue(
  '42990000-0000-4000-8000-000000000002',
  100,
  300
);
reset role;

select ok(
  exists (
    select 1 from claimed_image_deletions
    where attachment_id = '42110000-0000-4000-8000-000000000001'
      and attempt = 1
  )
    and not exists (
      select 1 from duplicate_image_deletion_claim
      where attachment_id = '42110000-0000-4000-8000-000000000001'
    ),
  'an active deletion lease prevents another worker from claiming the same object'
);

set local role service_role;
select is(
  public.complete_webchat_image_deletion(
    '42110000-0000-4000-8000-000000000001',
    '42990000-0000-4000-8000-000000000002'
  ),
  false,
  'a non-owner worker cannot complete another deletion lease'
);
select ok(
  public.complete_webchat_image_deletion(
    '42110000-0000-4000-8000-000000000001',
    '42990000-0000-4000-8000-000000000001'
  ),
  'the owning worker confirms Storage deletion'
);
select ok(
  public.complete_webchat_image_deletion(
    '42110000-0000-4000-8000-000000000001',
    '42990000-0000-4000-8000-000000000001'
  ),
  'a lost successful deletion response can be replayed idempotently'
);
reset role;

select ok(
  exists (
    select 1
    from private.webchat_image_attachments as attachment
    join private.webchat_image_deletion_outbox as queue
      on queue.attachment_id = attachment.id
    where attachment.id = '42110000-0000-4000-8000-000000000001'
      and attachment.status = 'deleted'
      and attachment.deleted_at is not null
      and queue.completed_at is not null
  ),
  'metadata reaches deleted only in the same transaction that completes the outbox'
);

do $$
declare
  attempt_index integer;
  claimed_again boolean;
begin
  for attempt_index in 1..24 loop
    if not public.retry_webchat_image_deletion(
      '42210000-0000-4000-8000-000000000001',
      '42990000-0000-4000-8000-000000000001',
      'storage_timeout',
      1
    ) then
      raise exception 'dead-letter fixture could not release attempt %', attempt_index;
    end if;

    update private.webchat_image_deletion_outbox
    set available_at = pg_catalog.clock_timestamp() - interval '1 second'
    where attachment_id = '42210000-0000-4000-8000-000000000001';

    select exists (
      select 1
      from public.claim_webchat_image_deletion_queue(
        '42990000-0000-4000-8000-000000000001',
        100,
        300
      ) as claimed
      where claimed.attachment_id = '42210000-0000-4000-8000-000000000001'
        and claimed.attempt = attempt_index + 1
    ) into claimed_again;
    if not claimed_again then
      raise exception 'dead-letter fixture could not claim attempt %', attempt_index + 1;
    end if;
  end loop;

  if not public.retry_webchat_image_deletion(
    '42210000-0000-4000-8000-000000000001',
    '42990000-0000-4000-8000-000000000001',
    'storage_timeout',
    1
  ) then
    raise exception 'dead-letter fixture could not record terminal failure';
  end if;
end;
$$;

select ok(
  exists (
    select 1
    from private.webchat_image_deletion_outbox
    where attachment_id = '42210000-0000-4000-8000-000000000001'
      and attempt_count = 25
      and last_error_code = 'storage_timeout'
      and dead_lettered_at is not null
      and claimed_by is null
      and lease_expires_at is null
      and completed_at is null
  ),
  'the twenty-fifth failed Storage attempt enters an explicit dead letter'
);

set local role service_role;
create temporary table image_deletion_dead_letters as
select * from public.list_webchat_image_deletion_dead_letters(100);
reset role;

select ok(
  exists (
    select 1
    from image_deletion_dead_letters
    where attachment_id = '42210000-0000-4000-8000-000000000001'
      and user_id = '00000000-0000-4000-8000-000000004202'
      and bucket_id = 'webchat-images'
      and object_key = 'user/00000000-0000-4000-8000-000000004202/conversation/42020000-0000-4000-8000-000000000001/attachment/42210000-0000-4000-8000-000000000001.webp'
      and attempt_count = 25
      and last_error_code = 'storage_timeout'
      and dead_lettered_at is not null
  ),
  'service recovery can inspect the dead-letter object locator and failure metadata'
);

set local role service_role;
select ok(
  public.requeue_webchat_image_deletion_dead_letter(
    '42210000-0000-4000-8000-000000000001',
    'operator_retry'
  ),
  'an operator can requeue a dead letter with an audited reason'
);
create temporary table requeued_image_deletion_claim as
select *
from public.claim_webchat_image_deletion_queue(
  '42990000-0000-4000-8000-000000000003',
  100,
  300
);
reset role;

select ok(
  exists (
    select 1
    from requeued_image_deletion_claim as claimed
    join private.webchat_image_deletion_outbox as queue
      on queue.attachment_id = claimed.attachment_id
    where claimed.attachment_id = '42210000-0000-4000-8000-000000000001'
      and claimed.attempt = 1
      and queue.attempt_count = 1
      and queue.dead_lettered_at is null
      and queue.last_error_code is null
      and queue.requeue_reason = 'operator_retry'
  ),
  'requeue resets attempts and permits a fresh leased claim'
);

set local role service_role;
select ok(
  public.complete_webchat_image_deletion(
    '42210000-0000-4000-8000-000000000001',
    '42990000-0000-4000-8000-000000000003'
  ),
  'a requeued dead letter can complete the normal deletion lifecycle'
);
reset role;

update private.webchat_image_attachments
set
  reserved_at = pg_catalog.statement_timestamp() - interval '31 minutes',
  expires_at = pg_catalog.statement_timestamp() - interval '1 minute'
where id = '42110000-0000-4000-8000-000000000010';

set local role service_role;
select ok(
  public.enqueue_expired_webchat_image_attachments(100) >= 1,
  'the retention worker queues reservations older than thirty minutes'
);
reset role;

select is(
  (
    select status
    from private.webchat_image_attachments
    where id = '42110000-0000-4000-8000-000000000010'
  ),
  'deleting',
  'an expired reservation cannot return to the upload state machine'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004201', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004201","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table image_export_a as
select public.export_own_data() as payload;
reset role;

select ok(
  (
    select pg_catalog.jsonb_typeof(payload #> '{webchat,imageAttachments}') = 'object'
      and pg_catalog.jsonb_typeof(payload #> '{webchat,imageAttachments,items}') = 'array'
      and (payload #>> '{webchat,imageAttachments,count}')::integer
        = pg_catalog.jsonb_array_length(payload #> '{webchat,imageAttachments,items}')
      and (payload #>> '{webchat,imageAttachments,count}')::integer >= 1
      and payload::text not like '%image-member-b@example.test%'
    from image_export_a
  ),
  'personal export reports a count matching the caller normalized attachment items'
);

select ok(
  (
    select not exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        payload #> '{webchat,imageAttachments,items}'
      ) as attachment(item)
      cross join lateral pg_catalog.jsonb_object_keys(attachment.item) as field(name)
      where field.name not in (
        'mediaType',
        'bytes',
        'width',
        'height',
        'createdAt',
        'readyAt',
        'attachedAt',
        'deletedAt'
      )
    )
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          payload #> '{webchat,imageAttachments,items}'
        ) as attachment(item)
        where attachment.item ->> 'mediaType' is distinct from 'image/webp'
      )
      and (payload #> '{webchat,imageAttachments}')::text not like '%urn:ustsacm:webchat-attachment:%'
      and (payload #> '{webchat,imageAttachments}')::text not like '%object_key%'
      and (payload #> '{webchat,imageAttachments}')::text not like '%webchat-images%'
      and (payload #> '{webchat,imageAttachments}')::text not like '%' || repeat('a', 64) || '%'
      and (payload #> '{webchat,imageAttachments}')::text not like '%validation_owner_token%'
      and (payload #> '{webchat,imageAttachments}')::text not like '%last_error_code%'
      and (payload #> '{webchat,imageAttachments}')::text not like '%originalMime%'
      and (payload #> '{webchat,imageAttachments}')::text not like '%conversationId%'
      and (payload #> '{webchat,imageAttachments}')::text not like '%messageId%'
      and (payload #> '{webchat,imageAttachments}')::text not like '%status%'
    from image_export_a
  ),
  'personal export attachment items use an exact privacy-safe metadata allowlist'
);

update private.webchat_image_attachments
set deleted_at = pg_catalog.statement_timestamp() - interval '8 days'
where id = '42110000-0000-4000-8000-000000000001';

set local role service_role;
select is(
  public.purge_deleted_webchat_image_attachments(100),
  1,
  'the retention worker purges a deleted attachment tombstone after seven days'
);
reset role;

select is(
  (
    (select pg_catalog.count(*) from private.webchat_image_attachments
      where id = '42110000-0000-4000-8000-000000000001')
    + (select pg_catalog.count(*) from private.webchat_image_deletion_outbox
      where attachment_id = '42110000-0000-4000-8000-000000000001')
  )::integer,
  0,
  'tombstone purge also removes its completed outbox row by cascade'
);

set local role service_role;
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004201',
  '42010000-0000-4000-8000-000000000006',
  '42160000-0000-4000-8000-000000000001',
  'image/png',
  1000
);
select * from public.start_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42160000-0000-4000-8000-000000000001',
  '42160000-0000-4000-8000-000000000101',
  300
);
select * from public.complete_webchat_image_validation(
  '00000000-0000-4000-8000-000000004201',
  '42160000-0000-4000-8000-000000000001',
  '42160000-0000-4000-8000-000000000101',
  800,
  40,
  20,
  repeat('d', 64)
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004201', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004201","role":"authenticated"}',
  true
);
set local role authenticated;
select public.upsert_own_webchat_message(
  '42010000-0000-4000-8000-000000000006',
  'cascade-image-message',
  null,
  'ai-sdk/v6',
  '{"role":"user","parts":[{"type":"file","mediaType":"image/webp","url":"urn:ustsacm:webchat-attachment:42160000-0000-4000-8000-000000000001"}]}'::jsonb
);
select public.delete_own_webchat_conversation(
  '42010000-0000-4000-8000-000000000006'
);
reset role;

select ok(
  not exists (
    select 1
    from private.webchat_conversations
    where id = '42010000-0000-4000-8000-000000000006'
  ),
  'conversation deletion succeeds while its messages cascade through attachment triggers'
);

select ok(
  not exists (
    select 1
    from private.webchat_conversations
    where id = '42010000-0000-4000-8000-000000000006'
  )
    and exists (
      select 1
      from private.webchat_image_attachments as attachment
      join private.webchat_image_deletion_outbox as queue
        on queue.attachment_id = attachment.id
      where attachment.id = '42160000-0000-4000-8000-000000000001'
        and attachment.status = 'deleting'
        and queue.reason = 'conversation_deleted'
        and queue.completed_at is null
    ),
  'conversation cascade preserves the durable attachment deletion outbox'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000004204',
  'authenticated', 'authenticated', 'image-deletion@example.test', 'test-password', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Image Deletion Member"}'::jsonb,
  now(), now(), '', '', '', ''
);

update public.profiles
set review_status = 'approved'
where id = '00000000-0000-4000-8000-000000004204';

insert into private.webchat_conversations (id, user_id, title)
values (
  '42040000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000004204',
  'Deletion attachment conversation'
);

set local role service_role;
select *
from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004204',
  '42040000-0000-4000-8000-000000000001',
  '42410000-0000-4000-8000-000000000001',
  'image/png',
  100000
);
select *
from public.start_webchat_image_validation(
  '00000000-0000-4000-8000-000000004204',
  '42410000-0000-4000-8000-000000000001',
  '42410000-0000-4000-8000-000000000101',
  600
);
reset role;

select ok(
  public.acquire_account_deletion_recovery_lease(
    '42490000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000004204'
  ),
  'the attachment deletion fixture acquires the normal recovery fence'
);

set local role service_role;
create temporary table first_attachment_deletion_attempt as
select public.delete_auth_user_with_recovery_lease(
  '42490000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000004204'
) as result;
reset role;

select ok(
  (
    select (result ->> 'leaseOwned')::boolean
      and not (result ->> 'deleted')::boolean
      and (result ->> 'attachmentCleanupPending')::boolean
    from first_attachment_deletion_attempt
  ),
  'final account deletion returns a controlled cleanup fence while an object remains'
);

select ok(
  exists (
    select 1
    from private.webchat_image_upload_state
    where user_id = '00000000-0000-4000-8000-000000004204'
      and uploads_frozen
      and frozen_at is not null
  )
    and exists (
      select 1
      from auth.users
      where id = '00000000-0000-4000-8000-000000004204'
    ),
  'the cleanup fence freezes uploads while preserving Auth/Profile'
);

set local role service_role;
select throws_ok(
  $$
    select *
    from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004204',
      '42040000-0000-4000-8000-000000000001',
      '42410000-0000-4000-8000-000000000002',
      'image/png',
      10
    )
  $$,
  '55000',
  'WebChat image uploads are frozen for account deletion.',
  'a frozen deletion target cannot create a late reservation'
);
create temporary table early_deletion_account_claim as
select *
from public.claim_webchat_image_deletion_queue(
  '42490000-0000-4000-8000-000000000002',
  100,
  300
);
reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from early_deletion_account_claim
    where attachment_id = '42410000-0000-4000-8000-000000000001'
  ),
  0,
  'account cleanup cannot claim an object before its validation lease ends'
);

update private.webchat_image_attachments
set validation_lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where id = '42410000-0000-4000-8000-000000000001';

update private.webchat_image_deletion_outbox
set available_at = pg_catalog.clock_timestamp() - interval '1 second'
where attachment_id = '42410000-0000-4000-8000-000000000001';

set local role service_role;
create temporary table deletion_account_claim as
select *
from public.claim_webchat_image_deletion_queue(
  '42490000-0000-4000-8000-000000000002',
  100,
  300
);
select ok(
  public.complete_webchat_image_deletion(
    '42410000-0000-4000-8000-000000000001',
    '42490000-0000-4000-8000-000000000002'
  ),
  'the Edge cleanup worker confirms the account attachment deletion'
);
create temporary table final_attachment_deletion_attempt as
select public.delete_auth_user_with_recovery_lease(
  '42490000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000004204'
) as result;
reset role;

select ok(
  (
    select (result ->> 'leaseOwned')::boolean
      and (result ->> 'deleted')::boolean
      and not (result ->> 'attachmentCleanupPending')::boolean
    from final_attachment_deletion_attempt
  ),
  'the same fenced deletion succeeds only after Storage deletion is confirmed'
);

select is(
  (
    (select pg_catalog.count(*) from auth.users where id = '00000000-0000-4000-8000-000000004204')
    + (select pg_catalog.count(*) from public.profiles where id = '00000000-0000-4000-8000-000000004204')
    + (select pg_catalog.count(*) from private.webchat_image_attachments where user_id = '00000000-0000-4000-8000-000000004204')
  )::integer,
  0,
  'successful final deletion removes Auth, Profile, and attachment tombstones together'
);

select * from finish();

rollback;
