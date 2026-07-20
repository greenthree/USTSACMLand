begin;

create extension if not exists pgtap with schema extensions;

select plan(66);

select has_table(
  'private',
  'webchat_member_access',
  'the private deny-by-default WebChat member access table exists'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'webchat_member_access'
  ),
  'row level security is enabled on member WebChat access'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'private'
      and tablename = 'webchat_member_access'
  ),
  0,
  'the private member access table has no browser-facing RLS policies'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'private.webchat_member_access', 'SELECT')
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.webchat_member_access', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.webchat_member_access', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.webchat_member_access', 'UPDATE'
    ),
  'application roles cannot read or forge private member access directly'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as relation on relation.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'webchat_member_access'
      and constraint_record.contype = 'f'
      and constraint_record.confdeltype = 'c'
      and constraint_record.confrelid = 'public.profiles'::regclass
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        like 'FOREIGN KEY (user_id)%ON DELETE CASCADE%'
  ),
  'member access is deleted with its profile through an ON DELETE CASCADE FK'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'private'
      and tablename = 'webchat_member_access'
      and indexname = 'webchat_member_access_updated_by_idx'
      and indexdef like '%(updated_by)%'
  ),
  'member access has the required updated_by audit index'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.admin_get_webchat_member_access(uuid)', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'authenticated',
      'public.admin_update_webchat_member_access(uuid,boolean,integer,bigint,bigint,text)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.read_own_webchat_usage()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.admin_get_webchat_member_access(uuid)', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role', 'public.read_own_webchat_usage()', 'EXECUTE'
    ),
  'authenticated browsers can reach only the admin and own-usage entry points'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.read_webchat_member_runtime_access(uuid)', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.claim_authorized_webchat_request(uuid,text,text,uuid,integer,bigint,integer)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.mark_authorized_webchat_request_started(uuid,text,uuid)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated', 'public.read_webchat_member_runtime_access(uuid)', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.claim_authorized_webchat_request(uuid,text,text,uuid,integer,bigint,integer)',
      'EXECUTE'
    ),
  'only the service role can read runtime access and admit or start paid work'
);

select ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'public.claim_webchat_request_internal(uuid,text,text,uuid,integer,integer,bigint,integer,bigint,bigint,integer)',
    'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'service_role', 'public.mark_webchat_request_started(uuid,text,uuid)', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.finalize_webchat_request(uuid,text,uuid,text,bigint,bigint,bigint,bigint,bigint)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role', 'public.release_webchat_request(uuid,text,uuid,text)', 'EXECUTE'
    ),
  'legacy claim and start bypasses are revoked while settlement and refund remain available'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'admin_get_webchat_member_access',
        'admin_update_webchat_member_access',
        'read_webchat_member_runtime_access',
        'read_own_webchat_usage',
        'claim_authorized_webchat_request',
        'mark_authorized_webchat_request_started'
      ])
      and procedure.prosecdef
  ),
  6,
  'all member access RPCs are SECURITY DEFINER functions'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'admin_get_webchat_member_access',
        'admin_update_webchat_member_access',
        'read_webchat_member_runtime_access',
        'read_own_webchat_usage',
        'claim_authorized_webchat_request',
        'mark_authorized_webchat_request_started'
      ])
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
  ),
  6,
  'all member access RPCs pin their search path'
);

select is(
  pg_catalog.pg_get_function_arguments(
    'public.claim_authorized_webchat_request(uuid,text,text,uuid,integer,bigint,integer)'::regprocedure
  ),
  'requested_user_id uuid, requested_request_id text, requested_fingerprint text, requested_owner_token uuid, minute_request_limit integer, requested_reserved_tokens bigint, lease_seconds integer DEFAULT 180',
  'authorized claim accepts identity, fingerprint, minute, reservation, and lease inputs only'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.claim_authorized_webchat_request(uuid,text,text,uuid,integer,bigint,integer)'::regprocedure
    ),
    'from private.webchat_global_quota_state'
  ) < pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.claim_authorized_webchat_request(uuid,text,text,uuid,integer,bigint,integer)'::regprocedure
    ),
    'from private.webchat_member_access'
  ),
  'authorized claim takes the global lock before member policy and quota work'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.mark_authorized_webchat_request_started(uuid,text,uuid)'::regprocedure
    ),
    'webchat_relay_config'
  ) < pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.mark_authorized_webchat_request_started(uuid,text,uuid)'::regprocedure
    ),
    'mark_webchat_request_started'
  ),
  'authorized start rechecks current policy before taking the legacy quota lifecycle lock'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002201',
    'authenticated', 'authenticated', 'access-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Access Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002202',
    'authenticated', 'authenticated', 'access-allowed@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Allowed Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002203',
    'authenticated', 'authenticated', 'access-denied@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Denied Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002204',
    'authenticated', 'authenticated', 'access-suspended-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Suspended Access Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002205',
    'authenticated', 'authenticated', 'access-suspended-member@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Suspended Access Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002206',
    'authenticated', 'authenticated', 'access-expired@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Expired Usage Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002207',
    'authenticated', 'authenticated', 'access-lifecycle@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Lifecycle Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002208',
    'authenticated', 'authenticated', 'access-request-limit@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Request Limit Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002209',
    'authenticated', 'authenticated', 'access-token-limit@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Token Limit Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002210',
    'authenticated', 'authenticated', 'access-global-a@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Global Member A"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002211',
    'authenticated', 'authenticated', 'access-global-b@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Global Member B"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002212',
    'authenticated', 'authenticated', 'access-delete@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Delete Access Member"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  role = case
    when id in (
      '00000000-0000-0000-0000-000000002201',
      '00000000-0000-0000-0000-000000002204'
    ) then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = case
    when id in (
      '00000000-0000-0000-0000-000000002204',
      '00000000-0000-0000-0000-000000002205'
    ) then 'suspended'::public.profile_review_status
    else 'approved'::public.profile_review_status
  end,
  approved_at = case
    when id in (
      '00000000-0000-0000-0000-000000002204',
      '00000000-0000-0000-0000-000000002205'
    ) then null
    else now()
  end
where id between
  '00000000-0000-0000-0000-000000002201'
  and '00000000-0000-0000-0000-000000002212';

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002203', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002203","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select * from public.admin_get_webchat_member_access(
      '00000000-0000-0000-0000-000000002202'
    )
  $$,
  '42501',
  'Administrator access required.',
  'an ordinary member cannot inspect another member private WebChat policy'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002204', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002204","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select * from public.admin_get_webchat_member_access(
      '00000000-0000-0000-0000-000000002202'
    )
  $$,
  '42501',
  'Administrator access required.',
  'a suspended administrator loses member access administration immediately'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002201', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002201","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table default_admin_access as
select * from public.admin_get_webchat_member_access(
  '00000000-0000-0000-0000-000000002202'
);

select ok(
  exists (
    select 1
    from default_admin_access
    where not access_enabled
      and total_request_limit = 30
      and total_token_limit = 100000
      and version = 0
      and updated_at is null
  ),
  'a missing member access row is returned as disabled version-zero defaults'
);

select throws_ok(
  $$
    select * from public.admin_get_webchat_member_access(
      '00000000-0000-0000-0000-000000009999'
    )
  $$,
  'P0002',
  'Eligible profile not found.',
  'administrators cannot create orphan WebChat policy through an unknown target'
);

create temporary table default_self_admin_access as
select * from public.admin_get_webchat_member_access(
  '00000000-0000-0000-0000-000000002201'
);

select ok(
  exists (
    select 1
    from default_self_admin_access
    where not access_enabled
      and total_request_limit = 30
      and total_token_limit = 100000
      and version = 0
      and updated_at is null
  ),
  'an active administrator is an eligible but deny-by-default WebChat policy target'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_member_access(
      '00000000-0000-0000-0000-000000002202', true, 0, 800, 0, 'Invalid request limit'
    )
  $$,
  '22023',
  'Member total request limit must be between 1 and 10000.',
  'member total request limits enforce the supported lower boundary'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_member_access(
      '00000000-0000-0000-0000-000000002202', true, 3, 99, 0, 'Invalid token limit'
    )
  $$,
  '22023',
  'Member total token limit must be between 100 and 1000000000.',
  'member total token limits enforce the supported lower boundary'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_member_access(
      '00000000-0000-0000-0000-000000002202', true, 3, 800, 0, 'x'
    )
  $$,
  '22023',
  'Member access change reason must contain at least 3 characters.',
  'member policy changes require a bounded audit reason'
);

create temporary table initial_member_update as
select * from public.admin_update_webchat_member_access(
  '00000000-0000-0000-0000-000000002202',
  true,
  2,
  500,
  0,
  'Enable initial pilot access'
);

reset role;

select ok(
  exists (
    select 1
    from initial_member_update
    where access_enabled
      and total_request_limit = 2
      and total_token_limit = 500
      and version = 1
      and updated_at is not null
  ),
  'the first administrator write creates version one and returns bounded policy'
);

select ok(
  exists (
    select 1
    from private.webchat_member_access
    where user_id = '00000000-0000-0000-0000-000000002202'
      and access_enabled
      and total_request_limit = 2
      and total_token_limit = 500
      and version = 1
      and updated_by = '00000000-0000-0000-0000-000000002201'
  ),
  'the private policy stores its limits, optimistic version, and administrator identity'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where action = 'webchat_member_access_update'
      and target_table = 'webchat_member_access'
      and target_id = '00000000-0000-0000-0000-000000002202'
      and before_data = '{"accessEnabled":false,"totalRequestLimit":30,"totalTokenLimit":100000,"version":0}'::jsonb
  ),
  'the first audit snapshot records the effective deny-by-default state'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where action = 'webchat_member_access_update'
      and target_id = '00000000-0000-0000-0000-000000002202'
      and after_data = '{"accessEnabled":true,"totalRequestLimit":2,"totalTokenLimit":500,"version":1}'::jsonb
  ),
  'the audit records the exact post-update access and limit state'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where action = 'webchat_member_access_update'
      and target_id = '00000000-0000-0000-0000-000000002202'
      and metadata ->> 'profile_id' = '00000000-0000-0000-0000-000000002202'
      and metadata ->> 'reason' = 'Enable initial pilot access'
      and metadata -> 'changedFields'
        = '["accessEnabled","totalRequestLimit","totalTokenLimit"]'::jsonb
  ),
  'the audit lists the reason and changed non-secret fields'
);

select ok(
  not exists (
    select 1
    from public.audit_logs
    where action = 'webchat_member_access_update'
      and target_id = '00000000-0000-0000-0000-000000002202'
      and pg_catalog.concat(before_data, after_data, metadata)
        ~* 'access-allowed@example|Allowed Member'
  ),
  'member access audit does not copy member email or name PII'
);

set local role authenticated;

select throws_ok(
  $$
    select * from public.admin_update_webchat_member_access(
      '00000000-0000-0000-0000-000000002202', true, 3, 800, 0, 'Stale update'
    )
  $$,
  '40001',
  'Member WebChat access changed after it was loaded.',
  'the virtual version zero cannot overwrite a configured policy'
);

create temporary table second_member_update as
select * from public.admin_update_webchat_member_access(
  '00000000-0000-0000-0000-000000002202',
  true,
  3,
  800,
  1,
  'Increase pilot allowance'
);

select ok(
  exists (
    select 1 from second_member_update
    where access_enabled
      and total_request_limit = 3
      and total_token_limit = 800
      and version = 2
  ),
  'a current optimistic version advances the policy and its version atomically'
);

create temporary table refreshed_admin_access as
select * from public.admin_get_webchat_member_access(
  '00000000-0000-0000-0000-000000002202'
);

select ok(
  exists (
    select 1 from refreshed_admin_access
    where access_enabled
      and total_request_limit = 3
      and total_token_limit = 800
      and version = 2
  ),
  'the administrative reader returns the latest member policy version'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_member_access(
      '00000000-0000-0000-0000-000000002202', true, 3, 800, 2, 'No effective change'
    )
  $$,
  '22023',
  'At least one member WebChat access field must change.',
  'no-op member policy writes are rejected instead of producing misleading audit'
);

reset role;

insert into private.webchat_member_access (
  user_id, access_enabled, total_request_limit, total_token_limit, updated_by
)
values
  ('00000000-0000-0000-0000-000000002205', true, 5, 1000, '00000000-0000-0000-0000-000000002201'),
  ('00000000-0000-0000-0000-000000002206', true, 5, 1000, '00000000-0000-0000-0000-000000002201'),
  ('00000000-0000-0000-0000-000000002207', true, 5, 1000, '00000000-0000-0000-0000-000000002201'),
  ('00000000-0000-0000-0000-000000002208', true, 1, 1000, '00000000-0000-0000-0000-000000002201'),
  ('00000000-0000-0000-0000-000000002209', true, 5, 150, '00000000-0000-0000-0000-000000002201'),
  ('00000000-0000-0000-0000-000000002210', true, 5, 1000, '00000000-0000-0000-0000-000000002201'),
  ('00000000-0000-0000-0000-000000002211', true, 5, 1000, '00000000-0000-0000-0000-000000002201'),
  ('00000000-0000-0000-0000-000000002212', true, 5, 1000, '00000000-0000-0000-0000-000000002201');

set local role service_role;
create temporary table default_runtime_access as
select * from public.read_webchat_member_runtime_access(
  '00000000-0000-0000-0000-000000002203'
);
create temporary table allowed_runtime_access as
select * from public.read_webchat_member_runtime_access(
  '00000000-0000-0000-0000-000000002202'
);
create temporary table suspended_runtime_access as
select * from public.read_webchat_member_runtime_access(
  '00000000-0000-0000-0000-000000002205'
);
reset role;

select ok(
  exists (
    select 1 from default_runtime_access
    where account_eligible
      and not access_enabled
      and total_request_limit = 30
      and total_token_limit = 100000
      and version = 0
  ),
  'runtime access also treats a missing policy row as denied version-zero defaults'
);

select ok(
  exists (
    select 1 from allowed_runtime_access
    where account_eligible
      and access_enabled
      and total_request_limit = 3
      and total_token_limit = 800
      and version = 2
  ),
  'runtime access returns the configured active member policy without profile details'
);

select ok(
  exists (
    select 1 from suspended_runtime_access
    where not account_eligible
      and access_enabled
      and total_request_limit = 5
      and total_token_limit = 1000
  ),
  'runtime access separates account eligibility from the stored member switch'
);

select is(
  (
    select pg_catalog.array_agg(key order by key)
    from allowed_runtime_access as access
    cross join lateral pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(access)) as fields(key)
  ),
  array[
    'access_enabled',
    'account_eligible',
    'total_request_limit',
    'total_token_limit',
    'version'
  ]::text[],
  'runtime access exposes no member identity, PII, or audit metadata fields'
);

update private.webchat_relay_config
set
  requests_enabled = false,
  global_daily_request_limit = 300,
  global_daily_token_limit = 1000000
where singleton;

set local role service_role;
create temporary table denied_claim as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002203',
  'denied-claim',
  repeat('a', 64),
  '22000000-0000-4000-8000-000000002203',
  3,
  100,
  180
);
create temporary table disabled_claim as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002202',
  'disabled-claim',
  repeat('b', 64),
  '22000000-0000-4000-8000-000000002202',
  3,
  100,
  180
);
create temporary table suspended_claim as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002205',
  'suspended-claim',
  repeat('c', 64),
  '22000000-0000-4000-8000-000000002205',
  3,
  100,
  180
);
reset role;

select is(
  (select decision from denied_claim),
  'member_access_denied',
  'an active member without a private row is denied before the relay switch'
);

select is(
  (select decision from disabled_claim),
  'requests_disabled',
  'an authorized member is denied while the database relay switch is off'
);

select is(
  (select decision from suspended_claim),
  'member_access_denied',
  'stored authorization cannot bypass a suspended account'
);

update private.webchat_relay_config
set requests_enabled = true
where singleton;

set local role service_role;
create temporary table oversized_claim as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002202',
  'oversized-claim',
  repeat('d', 64),
  '22000000-0000-4000-8000-000000002221',
  3,
  801,
  180
);
create temporary table exact_claim as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002202',
  'exact-claim',
  repeat('e', 64),
  '22000000-0000-4000-8000-000000002222',
  3,
  800,
  180
);
reset role;

select is(
  (select decision from oversized_claim),
  'member_total_token_limited',
  'one request larger than the administrator limit returns a structured denial'
);

select ok(
  exists (
    select 1 from exact_claim
    where decision = 'acquired'
      and status = 'claimed'
      and remaining_total_requests = 2
      and remaining_total_tokens = 0
  ),
  'a reservation exactly equal to the member token limit is claimed atomically'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002202', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002202","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table allowed_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1 from allowed_usage
    where access_enabled
      and total_request_limit = 3
      and used_requests = 1
      and remaining_requests = 2
      and total_token_limit = 800
      and used_tokens = 0
      and reserved_tokens = 800
      and remaining_tokens = 0
  ),
  'the member sees current request, reservation, limits, and exact remaining quota'
);

select ok(
  pg_catalog.pg_get_function_result('public.read_own_webchat_usage()'::regprocedure)
    !~ '(usage_date|reset_at)',
  'member quota output no longer advertises a daily reset'
);

select is(
  (
    select pg_catalog.array_agg(key order by key)
    from allowed_usage as usage
    cross join lateral pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(usage)) as fields(key)
  ),
  array[
    'access_enabled',
    'model',
    'remaining_requests',
    'remaining_tokens',
    'reserved_tokens',
    'total_request_limit',
    'total_token_limit',
    'used_requests',
    'used_tokens'
  ]::text[],
  'own usage exposes only effective policy and aggregate self-usage fields'
);

set local role service_role;
create temporary table exact_release as
select public.release_webchat_request(
  '00000000-0000-0000-0000-000000002202',
  'exact-claim',
  '22000000-0000-4000-8000-000000002222',
  'test_release'
) as released;
reset role;

select ok(
  (select released from exact_release),
  'an admitted request can still be refunded through the retained lifecycle RPC'
);

set local role authenticated;
create temporary table released_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1 from released_usage
    where used_requests = 0
      and remaining_requests = 3
      and reserved_tokens = 0
      and remaining_tokens = 800
  ),
  'a pre-upstream release is immediately reflected in member remaining quota'
);

insert into private.webchat_daily_usage (
  user_id,
  usage_date,
  request_count,
  input_tokens,
  output_tokens,
  total_tokens,
  reserved_tokens
)
values (
  '00000000-0000-0000-0000-000000002206',
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date,
  2,
  30,
  20,
  50,
  300
);

insert into private.webchat_requests (
  user_id,
  request_id,
  request_fingerprint,
  owner_token,
  status,
  quota_date,
  claimed_at,
  lease_expires_at,
  reserved_tokens
)
values (
  '00000000-0000-0000-0000-000000002206',
  'expired-display',
  repeat('f', 64),
  '22000000-0000-4000-8000-000000002206',
  'claimed',
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date,
  pg_catalog.clock_timestamp() - interval '10 minutes',
  pg_catalog.clock_timestamp() - interval '5 minutes',
  300
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002206', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002206","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table expired_claimed_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1 from expired_claimed_usage
    where used_requests = 1
      and remaining_requests = 4
      and used_tokens = 50
      and reserved_tokens = 0
      and remaining_tokens = 950
  ),
  'an expired unstarted claim is virtually refunded in the member display'
);

select ok(
  exists (
    select 1
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000002206'
      and request_count = 2
      and reserved_tokens = 300
  ),
  'the stable own-usage reader does not mutate the authoritative lifecycle ledger'
);

update private.webchat_requests
set
  status = 'started',
  upstream_started_at = claimed_at + interval '1 second'
where user_id = '00000000-0000-0000-0000-000000002206'
  and request_id = 'expired-display';

set local role authenticated;
create temporary table expired_started_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1 from expired_started_usage
    where used_requests = 2
      and remaining_requests = 3
      and used_tokens = 350
      and reserved_tokens = 0
      and remaining_tokens = 650
  ),
  'an expired started claim is conservatively charged in the member display'
);

set local role service_role;
create temporary table lifecycle_claim as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002207',
  'revoked-before-start',
  repeat('1', 64),
  '22000000-0000-4000-8000-000000002207',
  3,
  100,
  180
);
reset role;

select is(
  (select decision from lifecycle_claim),
  'acquired',
  'an eligible pilot member can acquire a fenced request claim'
);

update private.webchat_member_access
set access_enabled = false, version = version + 1
where user_id = '00000000-0000-0000-0000-000000002207';

set local role service_role;
create temporary table revoked_start as
select public.mark_authorized_webchat_request_started(
  '00000000-0000-0000-0000-000000002207',
  'revoked-before-start',
  '22000000-0000-4000-8000-000000002207'
) as started;
create temporary table revoked_release as
select public.release_webchat_request(
  '00000000-0000-0000-0000-000000002207',
  'revoked-before-start',
  '22000000-0000-4000-8000-000000002207',
  'access_revoked'
) as released;
reset role;

select ok(
  not (select started from revoked_start),
  'authorization revoked after claim prevents the paid upstream start'
);

select ok(
  (select released from revoked_release),
  'a claim blocked by revocation can still be refunded'
);

select ok(
  exists (
    select 1
    from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000002207'
      and request_id = 'revoked-before-start'
      and status = 'released'
      and not request_counted
      and outcome = 'access_revoked'
  ),
  'the revoked claim ledger reaches an explicit non-billable terminal state'
);

select ok(
  exists (
    select 1
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000002207'
      and request_count = 0
      and reserved_tokens = 0
  ),
  'revocation cleanup refunds both member request and token reservations'
);

set local role service_role;
create temporary table request_limit_first as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002208',
  'request-limit-first',
  repeat('2', 64),
  '22000000-0000-4000-8000-000000002208',
  3,
  100,
  180
);
create temporary table request_limit_started as
select public.mark_authorized_webchat_request_started(
  '00000000-0000-0000-0000-000000002208',
  'request-limit-first',
  '22000000-0000-4000-8000-000000002208'
) as started;
create temporary table request_limit_finished as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000002208',
  'request-limit-first',
  '22000000-0000-4000-8000-000000002208',
  'success',
  10,
  10,
  20
);
create temporary table request_limit_second as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002208',
  'request-limit-second',
  repeat('3', 64),
  '22000000-0000-4000-8000-000000002218',
  3,
  100,
  180
);
reset role;

select ok(
  (select decision = 'acquired' from request_limit_first)
    and (select started from request_limit_started)
    and (select transitioned and charged_tokens = 20 from request_limit_finished),
  'authorized claim, start, and known-token settlement preserve the existing lifecycle'
);

select is(
  (select decision from request_limit_second),
  'member_total_request_limited',
  'the database-enforced administrator request limit blocks the next daily request'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002208', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002208","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table request_limit_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1 from request_limit_usage
    where used_requests = 1
      and remaining_requests = 0
      and used_tokens = 20
      and reserved_tokens = 0
      and remaining_tokens = 980
  ),
  'the member display agrees with the request limit and finalized token charge'
);

set local role service_role;
create temporary table token_limit_first as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002209',
  'token-limit-first',
  repeat('4', 64),
  '22000000-0000-4000-8000-000000002209',
  3,
  100,
  180
);
create temporary table token_limit_started as
select public.mark_authorized_webchat_request_started(
  '00000000-0000-0000-0000-000000002209',
  'token-limit-first',
  '22000000-0000-4000-8000-000000002209'
) as started;
create temporary table token_limit_finished as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000002209',
  'token-limit-first',
  '22000000-0000-4000-8000-000000002209',
  'success',
  50,
  50,
  100
);
create temporary table token_limit_second as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002209',
  'token-limit-second',
  repeat('5', 64),
  '22000000-0000-4000-8000-000000002219',
  3,
  60,
  180
);
reset role;

select ok(
  (select decision = 'acquired' from token_limit_first)
    and (select started from token_limit_started)
    and (select transitioned and charged_tokens = 100 from token_limit_finished),
  'a first request can settle exactly below the member daily token limit'
);

select is(
  (select decision from token_limit_second),
  'member_total_token_limited',
  'settled plus requested tokens cannot exceed the administrator token limit'
);

delete from private.webchat_requests;
delete from private.webchat_daily_usage;
delete from private.webchat_global_daily_usage;

update private.webchat_relay_config
set
  global_daily_request_limit = 1,
  global_daily_token_limit = 1000000
where singleton;

set local role service_role;
create temporary table global_request_first as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002210',
  'global-request-first',
  repeat('6', 64),
  '22000000-0000-4000-8000-000000002210',
  3,
  100,
  180
);
create temporary table global_request_second as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002211',
  'global-request-second',
  repeat('7', 64),
  '22000000-0000-4000-8000-000000002211',
  3,
  100,
  180
);
reset role;

select is(
  (select decision from global_request_first),
  'acquired',
  'the first request fits the database global request budget'
);

select is(
  (select decision from global_request_second),
  'global_daily_request_limited',
  'authorized claim reads and enforces the database global request budget'
);

set local role service_role;
select public.release_webchat_request(
  '00000000-0000-0000-0000-000000002210',
  'global-request-first',
  '22000000-0000-4000-8000-000000002210',
  'test_release'
);
reset role;

delete from private.webchat_requests;
delete from private.webchat_daily_usage;
delete from private.webchat_global_daily_usage;

update private.webchat_relay_config
set
  global_daily_request_limit = 100,
  global_daily_token_limit = 100
where singleton;

set local role service_role;
create temporary table global_token_first as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002210',
  'global-token-first',
  repeat('8', 64),
  '22000000-0000-4000-8000-000000002230',
  3,
  100,
  180
);
create temporary table global_token_second as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002211',
  'global-token-second',
  repeat('9', 64),
  '22000000-0000-4000-8000-000000002231',
  3,
  1,
  180
);
reset role;

select is(
  (select decision from global_token_first),
  'acquired',
  'a reservation equal to the global token budget is accepted'
);

select is(
  (select decision from global_token_second),
  'global_daily_token_limited',
  'authorized claim reads and enforces the database global token budget'
);

update public.admin_rate_limit_buckets
set
  window_started_at = pg_catalog.clock_timestamp(),
  request_count = 30,
  updated_at = pg_catalog.clock_timestamp()
where actor_id = '00000000-0000-0000-0000-000000002201'
  and action_key = 'webchat_member_access.write';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002201', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002201","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select * from public.admin_update_webchat_member_access(
      '00000000-0000-0000-0000-000000002202', false, 3, 800, 2, 'Rate limited change'
    )
  $$,
  'PT429',
  'admin_rate_limited',
  'member access writes use the shared administrator rate limiter'
);

reset role;

select ok(
  exists (
    select 1
    from private.webchat_member_access
    where user_id = '00000000-0000-0000-0000-000000002202'
      and access_enabled
      and version = 2
  ),
  'a rate-limited administration attempt leaves member policy unchanged'
);

delete from public.profiles
where id = '00000000-0000-0000-0000-000000002212';

select is(
  (
    select pg_catalog.count(*)::integer
    from private.webchat_member_access
    where user_id = '00000000-0000-0000-0000-000000002212'
  ),
  0,
  'deleting a member profile cascades its private WebChat authorization row'
);

select * from finish();

rollback;
