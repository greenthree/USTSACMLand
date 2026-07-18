begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.read_own_webchat_usage()', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.read_own_webchat_usage()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role', 'public.read_own_webchat_usage()', 'EXECUTE'
    ),
  'only authenticated browser sessions can execute own WebChat usage'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
      and procedure.pronargs = 0
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'read_own_webchat_usage'
  ),
  'own usage remains a zero-argument SECURITY DEFINER RPC with pinned search path'
);

select matches(
  pg_catalog.pg_get_function_result('public.read_own_webchat_usage()'::regprocedure),
  '^TABLE\(access_enabled boolean, model text, total_request_limit integer,',
  'nullable model is the second field in the own-usage result'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.read_own_webchat_usage()'::regprocedure),
    'nullif(pg_catalog.btrim(config.model), '''')'
  ) > 0,
  'the returned model is normalized directly from the private relay model'
);

select ok(
  pg_catalog.lower(
    pg_catalog.pg_get_functiondef('public.read_own_webchat_usage()'::regprocedure)
  ) !~ '(base_url|api_key|global_daily|vault\.)',
  'own usage source does not read relay addresses, keys, Vault, or global budgets'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002401',
    'authenticated', 'authenticated', 'model-member@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Model Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002402',
    'authenticated', 'authenticated', 'model-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Model Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002403',
    'authenticated', 'authenticated', 'model-denied@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Model Denied Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002404',
    'authenticated', 'authenticated', 'model-suspended@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Model Suspended Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  role = case
    when id in (
      '00000000-0000-0000-0000-000000002402',
      '00000000-0000-0000-0000-000000002404'
    ) then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = case
    when id = '00000000-0000-0000-0000-000000002404'
      then 'suspended'::public.profile_review_status
    else 'approved'::public.profile_review_status
  end,
  approved_at = case
    when id = '00000000-0000-0000-0000-000000002404' then null
    else now()
  end
where id in (
  '00000000-0000-0000-0000-000000002401',
  '00000000-0000-0000-0000-000000002402',
  '00000000-0000-0000-0000-000000002403',
  '00000000-0000-0000-0000-000000002404'
);

insert into private.webchat_member_access (
  user_id,
  access_enabled,
  total_request_limit,
  total_token_limit,
  updated_by
)
values
  (
    '00000000-0000-0000-0000-000000002401',
    true,
    5,
    1000,
    '00000000-0000-0000-0000-000000002402'
  ),
  (
    '00000000-0000-0000-0000-000000002402',
    true,
    8,
    2000,
    '00000000-0000-0000-0000-000000002402'
  ),
  (
    '00000000-0000-0000-0000-000000002404',
    true,
    2,
    500,
    '00000000-0000-0000-0000-000000002402'
  );

update private.webchat_relay_config
set
  base_url = 'https://relay.model.example.test/v1',
  model = 'gpt-5.6'
where singleton;

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
  '00000000-0000-0000-0000-000000002401',
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
  '00000000-0000-0000-0000-000000002401',
  'model-expired-claim',
  repeat('d', 64),
  '24000000-0000-4000-8000-000000002401',
  'claimed',
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date,
  pg_catalog.clock_timestamp() - interval '10 minutes',
  pg_catalog.clock_timestamp() - interval '5 minutes',
  300
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002401', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002401","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table authorized_member_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1
    from authorized_member_usage
    where access_enabled
      and model = 'gpt-5.6'
      and total_request_limit = 5
      and used_requests = 1
      and remaining_requests = 4
      and total_token_limit = 1000
      and used_tokens = 50
      and reserved_tokens = 0
      and remaining_tokens = 950
  ),
  'an authorized member sees the model and preserved virtual expired-claim refund'
);

select ok(
  pg_catalog.pg_get_function_result(
    'public.read_own_webchat_usage()'::regprocedure
  ) !~ '(usage_date|reset_at)',
  'member quota output no longer advertises a daily reset'
);

select ok(
  exists (
    select 1
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000002401'
      and request_count = 2
      and total_tokens = 50
      and reserved_tokens = 300
  ),
  'the stable model-aware reader still leaves lifecycle accounting untouched'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002402', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table authorized_admin_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1
    from authorized_admin_usage
    where access_enabled
      and model = 'gpt-5.6'
      and total_request_limit = 8
      and used_requests = 0
      and remaining_requests = 8
      and total_token_limit = 2000
      and used_tokens = 0
      and reserved_tokens = 0
      and remaining_tokens = 2000
  ),
  'an authorized approved administrator sees the same current model and own quota'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002403', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002403","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table denied_member_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1
    from denied_member_usage
    where not access_enabled
      and model is null
      and total_request_limit = 30
      and total_token_limit = 100000
  ),
  'an approved account without private authorization cannot discover the model'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002404', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002404","role":"authenticated"}',
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
      and model is null
      and total_request_limit = 2
      and total_token_limit = 500
  ),
  'a suspended administrator cannot discover the model despite a stored enabled policy'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002499', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002499","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table unknown_profile_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1
    from unknown_profile_usage
    where not access_enabled
      and model is null
      and used_requests = 0
      and used_tokens = 0
      and reserved_tokens = 0
  ),
  'an authenticated JWT without a profile receives no model or usage disclosure'
);

select is(
  (
    select pg_catalog.array_agg(key order by key)
    from authorized_admin_usage as usage
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
  'model-aware own usage exposes only the documented self-policy aggregate fields'
);

select ok(
  not exists (
    select 1
    from authorized_admin_usage as usage
    cross join lateral pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(usage)) as fields(key)
    where fields.key = any(array[
      'base_url',
      'api_key',
      'requests_enabled',
      'global_daily_request_limit',
      'global_daily_token_limit'
    ])
  )
    and pg_catalog.to_jsonb((select usage from authorized_admin_usage as usage))::text
      not like '%relay.model.example.test%',
  'own usage JSON contains no relay address, API key, switch, or global configuration'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.webchat_member_access
    where user_id = '00000000-0000-0000-0000-000000002403'
  ),
  0,
  'reading denied usage does not materialize a private authorization row'
);

update private.webchat_relay_config
set
  base_url = null,
  model = null
where singleton;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002402', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002402","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table unconfigured_model_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1
    from unconfigured_model_usage
    where access_enabled
      and model is null
      and total_request_limit = 8
      and total_token_limit = 2000
  ),
  'an authorized account sees null when no relay model is configured'
);

update private.webchat_relay_config
set
  base_url = 'https://relay.model.example.test/v1',
  model = 'gpt-5.7'
where singleton;

set local role authenticated;
create temporary table changed_model_usage as
select * from public.read_own_webchat_usage();
reset role;

select is(
  (select model from changed_model_usage),
  'gpt-5.7',
  'authorized own usage reads the current database model rather than a cached value'
);

select * from finish();

rollback;
