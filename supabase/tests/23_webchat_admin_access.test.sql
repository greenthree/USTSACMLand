begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

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
        'mark_authorized_webchat_request_started',
        'admin_get_member_detail'
      ])
      and procedure.prosecdef
  ),
  7,
  'all widened administrator access RPCs remain SECURITY DEFINER functions'
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
        'mark_authorized_webchat_request_started',
        'admin_get_member_detail'
      ])
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
  ),
  7,
  'all widened administrator access RPCs still pin their search path'
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
  'browser RPC grants remain limited to authenticated administration and self usage'
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
      'service_role', 'public.mark_authorized_webchat_request_started(uuid,text,uuid)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated', 'public.read_webchat_member_runtime_access(uuid)', 'EXECUTE'
    ),
  'runtime access, authorized claim, and authorized start remain service-only'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.admin_get_member_detail(uuid)', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.admin_get_member_detail(uuid)', 'EXECUTE'
    ),
  'member detail keeps its authenticated entry point and anonymous denial'
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
  'widening account roles does not reopen legacy paid-request bypasses'
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
  'authorized administrator claims retain the global-before-account lock order'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.admin_update_webchat_member_access(uuid,boolean,integer,bigint,bigint,text)'::regprocedure
    ),
    'order by administrator.id'
  ) > 0,
  'administrator self-authorization retains deterministic live-role locking'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002301',
    'authenticated', 'authenticated', 'webchat-self-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Self Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002302',
    'authenticated', 'authenticated', 'webchat-default-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Default Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002303',
    'authenticated', 'authenticated', 'webchat-suspended-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Suspended Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002304',
    'authenticated', 'authenticated', 'webchat-detail-member@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Detail Member"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  role = case
    when id in (
      '00000000-0000-0000-0000-000000002301',
      '00000000-0000-0000-0000-000000002302',
      '00000000-0000-0000-0000-000000002303'
    ) then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = case
    when id = '00000000-0000-0000-0000-000000002303'
      then 'suspended'::public.profile_review_status
    else 'approved'::public.profile_review_status
  end,
  review_note = case
    when id = '00000000-0000-0000-0000-000000002303'
      then 'Suspended administrator fixture'
    else null
  end,
  approved_at = case
    when id = '00000000-0000-0000-0000-000000002303' then null
    else now()
  end
where id in (
  '00000000-0000-0000-0000-000000002301',
  '00000000-0000-0000-0000-000000002302',
  '00000000-0000-0000-0000-000000002303',
  '00000000-0000-0000-0000-000000002304'
);

insert into private.webchat_member_access (
  user_id,
  access_enabled,
  total_request_limit,
  total_token_limit,
  updated_by
)
values (
  '00000000-0000-0000-0000-000000002303',
  true,
  2,
  500,
  '00000000-0000-0000-0000-000000002301'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002304', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002304","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select * from public.admin_get_member_detail(
      '00000000-0000-0000-0000-000000002301'
    )
  $$,
  '42501',
  'Administrator access required.',
  'an ordinary member cannot read an administrator private detail page'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002303', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002303","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select * from public.admin_get_member_detail(
      '00000000-0000-0000-0000-000000002301'
    )
  $$,
  '42501',
  'Administrator access required.',
  'a suspended administrator cannot read another administrator detail page'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002301', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002301","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table administrator_detail as
select * from public.admin_get_member_detail(
  '00000000-0000-0000-0000-000000002301'
);
create temporary table suspended_administrator_detail as
select * from public.admin_get_member_detail(
  '00000000-0000-0000-0000-000000002303'
);

select ok(
  (
    select pg_catalog.count(*)
    from administrator_detail
  ) = (
    select pg_catalog.count(*)
    from unnest(enum_range(null::public.platform_name))
  )
    and exists (
      select 1
      from administrator_detail
      where id = '00000000-0000-0000-0000-000000002301'
        and email = 'webchat-self-admin@example.test'
        and full_name = 'WebChat Self Administrator'
        and review_status = 'approved'
    ),
  'an active administrator can read their administrator profile and platform matrix'
);

select ok(
  exists (
    select 1
    from suspended_administrator_detail
    where id = '00000000-0000-0000-0000-000000002303'
      and review_status = 'suspended'
      and suspension_note = 'Suspended administrator fixture'
  ),
  'an active administrator can inspect a suspended administrator target'
);

create temporary table default_admin_policy as
select * from public.admin_get_webchat_member_access(
  '00000000-0000-0000-0000-000000002301'
);

select ok(
  exists (
    select 1
    from default_admin_policy
    where not access_enabled
      and total_request_limit = 30
      and total_token_limit = 100000
      and version = 0
      and updated_at is null
  ),
  'an approved administrator without a private row is still denied by default'
);

reset role;

set local role service_role;
create temporary table default_admin_runtime as
select * from public.read_webchat_member_runtime_access(
  '00000000-0000-0000-0000-000000002302'
);
create temporary table default_admin_claim as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002302',
  'default-admin-denied',
  repeat('a', 64),
  '23000000-0000-4000-8000-000000002302',
  3,
  100,
  180
);
reset role;

select ok(
  exists (
    select 1
    from default_admin_runtime
    where account_eligible
      and not access_enabled
      and total_request_limit = 30
      and total_token_limit = 100000
      and version = 0
  ),
  'runtime recognizes an approved administrator account without granting implicit access'
);

select is(
  (select decision from default_admin_claim),
  'member_access_denied',
  'an approved administrator still cannot claim without an explicit private row'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.webchat_member_access
    where user_id = '00000000-0000-0000-0000-000000002302'
  ),
  0,
  'a denied default administrator claim does not materialize private authorization'
);

set local role authenticated;
create temporary table administrator_self_update as
select * from public.admin_update_webchat_member_access(
  '00000000-0000-0000-0000-000000002301',
  true,
  4,
  1000,
  0,
  'Enable administrator pilot access'
);
reset role;

select ok(
  exists (
    select 1
    from administrator_self_update
    where access_enabled
      and total_request_limit = 4
      and total_token_limit = 1000
      and version = 1
      and updated_at is not null
  ),
  'an active administrator can explicitly authorize their own WebChat policy'
);

select ok(
  exists (
    select 1
    from private.webchat_member_access
    where user_id = '00000000-0000-0000-0000-000000002301'
      and access_enabled
      and total_request_limit = 4
      and total_token_limit = 1000
      and version = 1
      and updated_by = '00000000-0000-0000-0000-000000002301'
  ),
  'administrator self-authorization stores the same bounded private policy'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where actor_id = '00000000-0000-0000-0000-000000002301'
      and action = 'webchat_member_access_update'
      and target_id = '00000000-0000-0000-0000-000000002301'
      and metadata ->> 'profile_id' = '00000000-0000-0000-0000-000000002301'
      and metadata ->> 'reason' = 'Enable administrator pilot access'
      and before_data ->> 'version' = '0'
      and after_data ->> 'version' = '1'
      and pg_catalog.concat(before_data, after_data, metadata)
        !~* 'webchat-self-admin@example|WebChat Self Administrator'
  ),
  'administrator self-authorization is versioned, attributed, and PII-redacted in audit'
);

set local role service_role;
create temporary table enabled_admin_runtime as
select * from public.read_webchat_member_runtime_access(
  '00000000-0000-0000-0000-000000002301'
);
reset role;

select ok(
  exists (
    select 1
    from enabled_admin_runtime
    where account_eligible
      and access_enabled
      and total_request_limit = 4
      and total_token_limit = 1000
      and version = 1
  ),
  'service runtime accepts an explicitly authorized approved administrator'
);

set local role authenticated;
create temporary table empty_admin_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1
    from empty_admin_usage
    where access_enabled
      and used_requests = 0
      and remaining_requests = 4
      and used_tokens = 0
      and reserved_tokens = 0
      and remaining_tokens = 1000
  ),
  'an authorized administrator sees their full remaining self quota'
);

update private.webchat_relay_config
set
  requests_enabled = true,
  global_daily_request_limit = 300,
  global_daily_token_limit = 1000000
where singleton;

set local role service_role;
create temporary table administrator_claim as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002301',
  'administrator-request',
  repeat('b', 64),
  '23000000-0000-4000-8000-000000002301',
  3,
  100,
  180
);
reset role;

select ok(
  exists (
    select 1
    from administrator_claim
    where decision = 'acquired'
      and status = 'claimed'
      and remaining_total_requests = 3
      and remaining_total_tokens = 900
  ),
  'an explicitly authorized approved administrator can acquire a paid request claim'
);

set local role authenticated;
create temporary table claimed_admin_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1
    from claimed_admin_usage
    where used_requests = 1
      and remaining_requests = 3
      and used_tokens = 0
      and reserved_tokens = 100
      and remaining_tokens = 900
  ),
  'administrator self usage reflects the active request reservation'
);

set local role service_role;
create temporary table administrator_started as
select public.mark_authorized_webchat_request_started(
  '00000000-0000-0000-0000-000000002301',
  'administrator-request',
  '23000000-0000-4000-8000-000000002301'
) as started;
create temporary table administrator_finished as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000002301',
  'administrator-request',
  '23000000-0000-4000-8000-000000002301',
  'success',
  30,
  20,
  50
);
reset role;

select ok(
  (select started from administrator_started),
  'an authorized approved administrator passes the final start-time authorization check'
);

select ok(
  exists (
    select 1
    from administrator_finished
    where transitioned
      and status = 'finished'
      and charged_tokens = 50
  ),
  'administrator WebChat usage can settle through the retained lifecycle RPC'
);

set local role authenticated;
create temporary table settled_admin_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1
    from settled_admin_usage
    where used_requests = 1
      and remaining_requests = 3
      and used_tokens = 50
      and reserved_tokens = 0
      and remaining_tokens = 950
  ),
  'administrator self usage shows finalized tokens and the correct remaining quota'
);

set local role service_role;
create temporary table suspended_admin_runtime as
select * from public.read_webchat_member_runtime_access(
  '00000000-0000-0000-0000-000000002303'
);
create temporary table suspended_admin_claim as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002303',
  'suspended-admin-denied',
  repeat('c', 64),
  '23000000-0000-4000-8000-000000002303',
  3,
  100,
  180
);
reset role;

select ok(
  exists (
    select 1
    from suspended_admin_runtime
    where not account_eligible
      and access_enabled
      and total_request_limit = 2
      and total_token_limit = 500
  ),
  'runtime separates a suspended administrator account from its stored enabled policy'
);

select is(
  (select decision from suspended_admin_claim),
  'member_access_denied',
  'a suspended administrator cannot claim despite a stored enabled policy'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002303', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002303","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table suspended_admin_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1
    from suspended_admin_usage
    where not access_enabled
      and total_request_limit = 2
      and total_token_limit = 500
  ),
  'a suspended administrator own-usage response reports effective access disabled'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002301', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002301","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select * from public.admin_update_webchat_member_access(
      '00000000-0000-0000-0000-000000002303',
      true,
      3,
      600,
      1,
      'Attempt to re-enable suspended administrator'
    )
  $$,
  '42501',
  'Only an active member or administrator can receive WebChat access.',
  'an active administrator cannot enable WebChat for a suspended administrator'
);

create temporary table suspended_admin_policy as
select * from public.admin_get_webchat_member_access(
  '00000000-0000-0000-0000-000000002303'
);
reset role;

select ok(
  exists (
    select 1
    from suspended_admin_policy
    where access_enabled
      and total_request_limit = 2
      and total_token_limit = 500
      and version = 1
  ),
  'an active administrator may inspect a suspended administrator stored policy'
);

select * from finish();

rollback;
