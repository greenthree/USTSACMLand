begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

create function pg_temp.global_image_table_has_no_direct_acl(requested_table text)
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

create function pg_temp.global_image_function_acl_is(
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
  (select relrowsecurity
   from pg_catalog.pg_class
   where oid = 'private.webchat_global_quota_state'::regclass)
  and pg_temp.global_image_table_has_no_direct_acl('private.webchat_global_quota_state'),
  'the shared global quota singleton still denies direct client and service-role CRUD'
);

select ok(
  exists (
    select 1
    from private.webchat_global_quota_state as state
    where state.singleton
      and state.image_uploads_paused
      and state.image_hourly_attachment_limit = 120
      and state.image_hourly_original_bytes_limit = 268435456
      and state.image_storage_capacity_bytes = 536870912
      and state.image_storage_allocated_bytes = 0
      and state.image_max_active_validations = 2
  ),
  'image controls install on the existing singleton with conservative fail-closed defaults'
);

select ok(
  pg_temp.global_image_function_acl_is(
    'public.reserve_webchat_image_attachment(uuid,uuid,uuid,text,bigint)',
    'service_role'
  )
  and pg_temp.global_image_function_acl_is(
    'public.start_webchat_image_validation(uuid,uuid,uuid,integer)',
    'service_role'
  )
  and pg_temp.global_image_function_acl_is(
    'public.renew_webchat_image_validation(uuid,uuid,uuid,integer)',
    'service_role'
  )
  and pg_temp.global_image_function_acl_is(
    'public.complete_webchat_image_validation(uuid,uuid,uuid,bigint,integer,integer,text)',
    'service_role'
  )
  and pg_temp.global_image_function_acl_is(
    'public.fail_webchat_image_validation(uuid,uuid,uuid,text)',
    'service_role'
  )
  and pg_temp.global_image_function_acl_is(
    'public.complete_webchat_image_deletion(uuid,uuid)',
    'service_role'
  )
  and pg_temp.global_image_function_acl_is(
    'public.reconcile_webchat_image_storage_accounting()',
    'service_role'
  ),
  'all global image control RPCs remain service-role-only'
);

select ok(
  pg_temp.global_image_function_acl_is(
    'private.reserve_webchat_image_attachment_without_global_limits(uuid,uuid,uuid,text,bigint)'
  )
  and pg_temp.global_image_function_acl_is(
    'private.start_webchat_image_validation_without_global_limits(uuid,uuid,uuid,integer)'
  )
  and pg_temp.global_image_function_acl_is(
    'private.renew_webchat_image_validation_without_global_limits(uuid,uuid,uuid,integer)'
  )
  and pg_temp.global_image_function_acl_is(
    'private.complete_webchat_image_validation_without_global_limits(uuid,uuid,uuid,bigint,integer,integer,text)'
  )
  and pg_temp.global_image_function_acl_is(
    'private.fail_webchat_image_validation_without_global_limits(uuid,uuid,uuid,text)'
  )
  and pg_temp.global_image_function_acl_is(
    'private.complete_webchat_image_deletion_without_global_limits(uuid,uuid)'
  ),
  'wrapped state-machine functions have no direct client or service-role execute grant'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004501',
    'authenticated', 'authenticated', 'global-image-a@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Global Image A"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004502',
    'authenticated', 'authenticated', 'global-image-b@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Global Image B"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set review_status = 'approved'
where id in (
  '00000000-0000-4000-8000-000000004501',
  '00000000-0000-4000-8000-000000004502'
);

insert into private.webchat_conversations (id, user_id, title)
values
  (
    '45010000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000004501',
    'Global image limits A'
  ),
  (
    '45020000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000004502',
    'Global image limits B'
  );

set local role service_role;
select throws_ok(
  $$
    select * from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004501',
      '45010000-0000-4000-8000-000000000001',
      '45010000-0000-4000-8000-000000000101',
      'image/png', 10
    )
  $$,
  '55000',
  'WebChat image uploads are globally paused.',
  'new image work fails closed until an operator explicitly unpauses it'
);
reset role;

update private.webchat_global_quota_state
set
  image_uploads_paused = false,
  image_hourly_attachment_limit = 2,
  image_hourly_original_bytes_limit = 1000,
  image_storage_capacity_bytes = 8388608,
  image_max_active_validations = 2,
  updated_at = pg_catalog.clock_timestamp()
where singleton;

set local role service_role;
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004501',
  '45010000-0000-4000-8000-000000000001',
  '45010000-0000-4000-8000-000000000101',
  'image/png', 10
);
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004502',
  '45020000-0000-4000-8000-000000000001',
  '45020000-0000-4000-8000-000000000101',
  'image/png', 10
);
select throws_ok(
  $$
    select * from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004501',
      '45010000-0000-4000-8000-000000000001',
      '45010000-0000-4000-8000-000000000102',
      'image/png', 10
    )
  $$,
  '54000',
  'WebChat global image upload rate limit reached.',
  'the rolling attachment budget is shared across members'
);
reset role;

update private.webchat_image_attachments
set
  status = 'deleted',
  deletion_requested_at = pg_catalog.clock_timestamp(),
  deleted_at = pg_catalog.clock_timestamp(),
  updated_at = pg_catalog.clock_timestamp()
where id = '45010000-0000-4000-8000-000000000101';

set local role service_role;
select throws_ok(
  $$
    select * from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004501',
      '45010000-0000-4000-8000-000000000001',
      '45010000-0000-4000-8000-000000000102',
      'image/png', 10
    )
  $$,
  '54000',
  'WebChat global image upload rate limit reached.',
  'recent deleted tombstones still consume the rolling abuse budget'
);
reset role;

update private.webchat_global_quota_state
set image_uploads_paused = true, updated_at = pg_catalog.clock_timestamp()
where singleton;

set local role service_role;
select lives_ok(
  $$
    select * from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004502',
      '45020000-0000-4000-8000-000000000001',
      '45020000-0000-4000-8000-000000000101',
      'image/png', 10
    )
  $$,
  'an exact reservation retry remains idempotent while new uploads are paused'
);
reset role;

update private.webchat_image_attachments
set
  status = 'deleted',
  deletion_requested_at = coalesce(deletion_requested_at, pg_catalog.clock_timestamp()),
  deleted_at = coalesce(deleted_at, pg_catalog.clock_timestamp()),
  reserved_at = pg_catalog.statement_timestamp() - interval '2 hours',
  expires_at = pg_catalog.statement_timestamp() - interval '105 minutes',
  updated_at = pg_catalog.clock_timestamp()
where id in (
  '45010000-0000-4000-8000-000000000101',
  '45020000-0000-4000-8000-000000000101'
);

update private.webchat_global_quota_state
set
  image_uploads_paused = false,
  image_hourly_attachment_limit = 100,
  image_hourly_original_bytes_limit = 15,
  updated_at = pg_catalog.clock_timestamp()
where singleton;

set local role service_role;
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004501',
  '45010000-0000-4000-8000-000000000001',
  '45010000-0000-4000-8000-000000000201',
  'image/png', 10
);
select throws_ok(
  $$
    select * from public.reserve_webchat_image_attachment(
      '00000000-0000-4000-8000-000000004502',
      '45020000-0000-4000-8000-000000000001',
      '45020000-0000-4000-8000-000000000201',
      'image/png', 6
    )
  $$,
  '54000',
  'WebChat global image upload byte budget reached.',
  'the rolling original-byte budget is shared across members'
);
reset role;

select is(
  (select image_storage_allocated_bytes
   from private.webchat_global_quota_state
   where singleton),
  0::bigint,
  'reserving an attachment does not consume Storage capacity before processing starts'
);

update private.webchat_image_attachments
set
  status = 'deleted',
  deletion_requested_at = pg_catalog.clock_timestamp(),
  deleted_at = pg_catalog.clock_timestamp(),
  reserved_at = pg_catalog.statement_timestamp() - interval '2 hours',
  expires_at = pg_catalog.statement_timestamp() - interval '105 minutes',
  updated_at = pg_catalog.clock_timestamp()
where id = '45010000-0000-4000-8000-000000000201';

update private.webchat_global_quota_state
set
  image_hourly_original_bytes_limit = 1000,
  image_storage_capacity_bytes = 4194304,
  image_max_active_validations = 2,
  updated_at = pg_catalog.clock_timestamp()
where singleton;

set local role service_role;
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004501',
  '45010000-0000-4000-8000-000000000001',
  '45010000-0000-4000-8000-000000000301',
  'image/png', 10
);
select * from public.reserve_webchat_image_attachment(
  '00000000-0000-4000-8000-000000004502',
  '45020000-0000-4000-8000-000000000001',
  '45020000-0000-4000-8000-000000000301',
  'image/png', 10
);
select * from public.start_webchat_image_validation(
  '00000000-0000-4000-8000-000000004501',
  '45010000-0000-4000-8000-000000000301',
  '45010000-0000-4000-8000-000000000311',
  300
);
reset role;

select is(
  (
    select image_storage_allocated_bytes
    from private.webchat_global_quota_state
    where singleton
  ),
  4194304::bigint,
  'validation start reserves the maximum normalized object size before external work'
);

set local role service_role;
select throws_ok(
  $$
    select * from public.start_webchat_image_validation(
      '00000000-0000-4000-8000-000000004502',
      '45020000-0000-4000-8000-000000000301',
      '45020000-0000-4000-8000-000000000311',
      300
    )
  $$,
  '54000',
  'WebChat global image Storage capacity reached.',
  'worst-case reservation prevents concurrent workers from overcommitting Storage'
);
reset role;

update private.webchat_global_quota_state
set
  image_storage_capacity_bytes = 8388608,
  image_max_active_validations = 1,
  updated_at = pg_catalog.clock_timestamp()
where singleton;

set local role service_role;
select throws_ok(
  $$
    select * from public.start_webchat_image_validation(
      '00000000-0000-4000-8000-000000004502',
      '45020000-0000-4000-8000-000000000301',
      '45020000-0000-4000-8000-000000000311',
      300
    )
  $$,
  '54000',
  'WebChat global image validation concurrency limit reached.',
  'the leased processing circuit breaker is shared across members'
);
reset role;

update private.webchat_image_attachments
set validation_lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where id = '45010000-0000-4000-8000-000000000301';

set local role service_role;
select throws_ok(
  $$
    select * from public.renew_webchat_image_validation(
      '00000000-0000-4000-8000-000000004501',
      '45010000-0000-4000-8000-000000000301',
      '45010000-0000-4000-8000-000000000311',
      300
    )
  $$,
  '55000',
  'WebChat image validation lease is unavailable.',
  'an expired worker cannot revive its processing permit'
);
select lives_ok(
  $$
    select * from public.start_webchat_image_validation(
      '00000000-0000-4000-8000-000000004501',
      '45010000-0000-4000-8000-000000000301',
      '45010000-0000-4000-8000-000000000312',
      300
    )
  $$,
  'an expired lease can be fenced and taken over by a new worker'
);
reset role;

select is(
  (
    select image_storage_allocated_bytes
    from private.webchat_global_quota_state
    where singleton
  ),
  4194304::bigint,
  'lease takeover does not reserve Storage capacity twice'
);

set local role service_role;
select * from public.complete_webchat_image_validation(
  '00000000-0000-4000-8000-000000004501',
  '45010000-0000-4000-8000-000000000301',
  '45010000-0000-4000-8000-000000000312',
  100,
  10,
  10,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
reset role;

select ok(
  (select storage_allocation_bytes = 100
   from private.webchat_image_attachments
   where id = '45010000-0000-4000-8000-000000000301')
  and (select image_storage_allocated_bytes = 100
       from private.webchat_global_quota_state
       where singleton),
  'successful completion replaces worst-case allocation with actual normalized bytes'
);

set local role service_role;
select ok(
  public.queue_webchat_image_attachment_deletion(
    '00000000-0000-4000-8000-000000004501',
    '45010000-0000-4000-8000-000000000301',
    'global_limit_test'
  ),
  'a completed draft can enter the durable Storage deletion queue'
);
reset role;

select is(
  (select image_storage_allocated_bytes
   from private.webchat_global_quota_state
   where singleton),
  100::bigint,
  'queueing deletion does not release capacity before Storage confirms removal'
);

update private.webchat_image_deletion_outbox
set available_at = pg_catalog.clock_timestamp() - interval '1 second'
where attachment_id = '45010000-0000-4000-8000-000000000301';

set local role service_role;
select * from public.claim_webchat_image_deletion_queue(
  '45010000-0000-4000-8000-000000000399',
  10,
  300
);
select ok(
  public.complete_webchat_image_deletion(
    '45010000-0000-4000-8000-000000000301',
    '45010000-0000-4000-8000-000000000399'
  ),
  'the Storage deletion worker can confirm the object removal'
);
reset role;

select ok(
  (select storage_allocation_bytes = 0
   from private.webchat_image_attachments
   where id = '45010000-0000-4000-8000-000000000301')
  and (select image_storage_allocated_bytes = 0
       from private.webchat_global_quota_state
       where singleton),
  'confirmed Storage deletion releases both attachment and global allocation once'
);

update private.webchat_global_quota_state
set image_max_active_validations = 2, updated_at = pg_catalog.clock_timestamp()
where singleton;

set local role service_role;
select * from public.start_webchat_image_validation(
  '00000000-0000-4000-8000-000000004502',
  '45020000-0000-4000-8000-000000000301',
  '45020000-0000-4000-8000-000000000311',
  300
);
select ok(
  public.fail_webchat_image_validation(
    '00000000-0000-4000-8000-000000004502',
    '45020000-0000-4000-8000-000000000301',
    '45020000-0000-4000-8000-000000000311',
    'decode_failed'
  ),
  'a validation failure transitions through the globally serialized wrapper'
);
reset role;

select ok(
  (select status = 'failed' and storage_allocation_bytes = 4194304
   from private.webchat_image_attachments
   where id = '45020000-0000-4000-8000-000000000301')
  and (select image_storage_allocated_bytes = 4194304
       from private.webchat_global_quota_state
       where singleton),
  'failed validation retains worst-case capacity until durable object cleanup'
);

update private.webchat_image_deletion_outbox
set available_at = pg_catalog.clock_timestamp() - interval '1 second'
where attachment_id = '45020000-0000-4000-8000-000000000301';

set local role service_role;
select * from public.claim_webchat_image_deletion_queue(
  '45020000-0000-4000-8000-000000000399',
  10,
  300
);
create temporary table failed_image_deletion_result as
select public.complete_webchat_image_deletion(
  '45020000-0000-4000-8000-000000000301',
  '45020000-0000-4000-8000-000000000399'
) as completed;
reset role;

select ok(
  (select completed from failed_image_deletion_result)
  and (
    select image_storage_allocated_bytes = 0
    from private.webchat_global_quota_state
    where singleton
  ),
  'confirmed cleanup releases capacity retained by a failed worker'
);

update private.webchat_global_quota_state
set
  image_storage_allocated_bytes = 1,
  image_uploads_paused = false,
  updated_at = pg_catalog.clock_timestamp()
where singleton;

set local role service_role;
create temporary table image_reconciliation_result as
select * from public.reconcile_webchat_image_storage_accounting();
reset role;

select ok(
  exists (
    select 1
    from image_reconciliation_result
    where not accounting_consistent
      and uploads_paused
      and recorded_allocation_bytes = 1
      and attachment_allocation_bytes = 0
  ),
  'accounting drift is visible and automatically pauses future image work'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'webchat_image_attachments_global_reserved_at_idx'
  )
  and exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'webchat_image_attachments_active_validation_idx'
  )
  and exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and indexname = 'webchat_image_attachments_storage_allocation_idx'
  ),
  'rolling budget, active lease, and Storage allocation scans have dedicated indexes'
);

select * from finish();

rollback;
