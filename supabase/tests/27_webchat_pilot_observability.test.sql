begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002701',
    'authenticated', 'authenticated', 'pilot-enabled@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Enabled"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002702',
    'authenticated', 'authenticated', 'pilot-disabled@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Disabled"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002703',
    'authenticated', 'authenticated', 'pilot-unconfigured@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Unconfigured"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002704',
    'authenticated', 'authenticated', 'pilot-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002705',
    'authenticated', 'authenticated', 'pilot-suspended-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Suspended Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-000000002701' then 'Pilot Enabled'
    when '00000000-0000-0000-0000-000000002702' then 'Pilot Disabled'
    when '00000000-0000-0000-0000-000000002703' then 'Pilot Unconfigured'
    when '00000000-0000-0000-0000-000000002704' then 'Pilot Administrator'
    else 'Pilot Suspended Administrator'
  end,
  qq = case id
    when '00000000-0000-0000-0000-000000002701' then '12700000001'
    when '00000000-0000-0000-0000-000000002702' then '12700000002'
    when '00000000-0000-0000-0000-000000002703' then '12700000003'
    when '00000000-0000-0000-0000-000000002704' then '12700000004'
    else '12700000005'
  end,
  grade = case
    when id = '00000000-0000-0000-0000-000000002701' then '24级'
    when id = '00000000-0000-0000-0000-000000002702' then '23级'
    else '22级'
  end,
  major = case
    when id = '00000000-0000-0000-0000-000000002701' then '计算机科学与技术'
    when id = '00000000-0000-0000-0000-000000002702' then '软件工程'
    else '人工智能'
  end,
  role = case
    when id in (
      '00000000-0000-0000-0000-000000002704',
      '00000000-0000-0000-0000-000000002705'
    ) then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = case
    when id = '00000000-0000-0000-0000-000000002705'
      then 'suspended'::public.profile_review_status
    else 'approved'::public.profile_review_status
  end,
  approved_at = now();

insert into private.webchat_member_access (
  user_id,
  access_enabled,
  daily_request_limit,
  daily_token_limit,
  version,
  updated_by
)
values
  (
    '00000000-0000-0000-0000-000000002701',
    true, 10, 5000, 2,
    '00000000-0000-0000-0000-000000002704'
  ),
  (
    '00000000-0000-0000-0000-000000002702',
    false, 7, 3000, 3,
    '00000000-0000-0000-0000-000000002704'
  ),
  (
    '00000000-0000-0000-0000-000000002704',
    true, 5, 2000, 4,
    '00000000-0000-0000-0000-000000002704'
  ),
  (
    '00000000-0000-0000-0000-000000002705',
    true, 4, 1500, 5,
    '00000000-0000-0000-0000-000000002704'
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
values
  (
    '00000000-0000-0000-0000-000000002701',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    5, 600, 400, 1000, 200
  ),
  (
    '00000000-0000-0000-0000-000000002702',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    3, 300, 200, 500, 300
  ),
  (
    '00000000-0000-0000-0000-000000002704',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    1, 0, 0, 0, 100
  );

insert into private.webchat_requests (
  user_id,
  request_id,
  request_fingerprint,
  owner_token,
  status,
  quota_date,
  request_counted,
  claimed_at,
  upstream_started_at,
  lease_expires_at,
  finished_at,
  reserved_tokens,
  input_tokens,
  output_tokens,
  total_tokens,
  charged_tokens,
  outcome
)
values
  (
    '00000000-0000-0000-0000-000000002701',
    'pilot-expired-claimed',
    repeat('a', 64),
    '27000000-0000-4000-8000-000000000001',
    'claimed',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    true,
    pg_catalog.statement_timestamp() - interval '2 hours',
    null,
    pg_catalog.statement_timestamp() - interval '1 hour',
    null,
    200,
    null, null, null,
    0,
    null
  ),
  (
    '00000000-0000-0000-0000-000000002701',
    'pilot-finished-history',
    repeat('b', 64),
    '27000000-0000-4000-8000-000000000002',
    'finished',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    true,
    pg_catalog.statement_timestamp() - interval '30 minutes',
    pg_catalog.statement_timestamp() - interval '29 minutes',
    null,
    pg_catalog.statement_timestamp() - interval '28 minutes',
    50,
    10, 20, 30,
    30,
    'succeeded'
  ),
  (
    '00000000-0000-0000-0000-000000002702',
    'pilot-expired-started',
    repeat('c', 64),
    '27000000-0000-4000-8000-000000000003',
    'started',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    true,
    pg_catalog.statement_timestamp() - interval '2 hours',
    pg_catalog.statement_timestamp() - interval '119 minutes',
    pg_catalog.statement_timestamp() - interval '1 hour',
    null,
    300,
    null, null, null,
    0,
    null
  ),
  (
    '00000000-0000-0000-0000-000000002704',
    'pilot-active-claimed',
    repeat('d', 64),
    '27000000-0000-4000-8000-000000000004',
    'claimed',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    true,
    pg_catalog.statement_timestamp() - interval '1 minute',
    null,
    pg_catalog.statement_timestamp() + interval '5 minutes',
    null,
    100,
    null, null, null,
    0,
    null
  );

select has_function(
  'public',
  'admin_list_webchat_pilot_members',
  array[]::text[],
  'the administrator WebChat pilot roster function exists'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'public.admin_list_webchat_pilot_members()'::regprocedure
  ),
  'the pilot roster is SECURITY DEFINER with a pinned search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.admin_list_webchat_pilot_members()', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.admin_list_webchat_pilot_members()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role', 'public.admin_list_webchat_pilot_members()', 'EXECUTE'
    ),
  'only authenticated browser sessions can reach the administrator-checked roster'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) as actor(role_name)
    cross join unnest(array[
      'private.webchat_member_access',
      'private.webchat_daily_usage',
      'private.webchat_requests'
    ]) as private_table(table_name)
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as access(privilege_name)
    where pg_catalog.has_table_privilege(
      actor.role_name,
      private_table.table_name,
      access.privilege_name
    )
  ),
  'pilot observability does not reopen any private WebChat table privilege'
);

select ok(
  pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.admin_list_webchat_pilot_members()'::regprocedure
    )
  ) !~ '(request_id|request_fingerprint|prompt|message_body|response_body|reply)',
  'the roster implementation does not select request identifiers or conversation content'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002704', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002704","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table pilot_roster as
select * from public.admin_list_webchat_pilot_members();

reset role;

select set_eq(
  $$
    select distinct fields.key
    from pilot_roster as roster
    cross join lateral pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(roster)) as fields(key)
  $$,
  $$ values
    ('user_id'), ('full_name'), ('grade'), ('major'), ('role'), ('review_status'),
    ('access_enabled'), ('daily_request_limit'), ('daily_token_limit'), ('usage_date'),
    ('request_count'), ('settled_tokens'), ('reserved_tokens'), ('remaining_requests'),
    ('remaining_tokens'), ('active_request_count'), ('last_request_at'), ('version'),
    ('updated_at')
  $$,
  'the pilot roster exposes only the documented content-free field set'
);

select is(
  (select count(*)::integer from pilot_roster),
  4,
  'the roster contains every account with an explicit access row'
);

select ok(
  not exists (
    select 1 from pilot_roster
    where user_id = '00000000-0000-0000-0000-000000002703'
  ),
  'an account without explicit WebChat configuration is absent'
);

select ok(
  exists (
    select 1 from pilot_roster
    where user_id = '00000000-0000-0000-0000-000000002702'
      and not access_enabled
      and daily_request_limit = 7
      and daily_token_limit = 3000
  ),
  'an explicitly configured disabled account remains visible for pilot review'
);

select ok(
  not exists (
    select 1 from pilot_roster
    where usage_date <> (
      pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai'
    )::date
  ),
  'all pilot usage is reported for the current Beijing date'
);

select ok(
  exists (
    select 1 from pilot_roster
    where user_id = '00000000-0000-0000-0000-000000002701'
      and request_count = 4
      and settled_tokens = 1000
      and reserved_tokens = 0
      and remaining_requests = 6
      and remaining_tokens = 4000
      and active_request_count = 0
  ),
  'an expired claimed lease refunds its counted request and reservation'
);

select ok(
  exists (
    select 1 from pilot_roster
    where user_id = '00000000-0000-0000-0000-000000002702'
      and request_count = 3
      and settled_tokens = 800
      and reserved_tokens = 0
      and remaining_requests = 4
      and remaining_tokens = 2200
      and active_request_count = 0
  ),
  'an expired started lease retains its request and moves reservation to settled usage'
);

select ok(
  exists (
    select 1 from pilot_roster
    where user_id = '00000000-0000-0000-0000-000000002704'
      and request_count = 1
      and settled_tokens = 0
      and reserved_tokens = 100
      and remaining_requests = 4
      and remaining_tokens = 1900
      and active_request_count = 1
  ),
  'only an unexpired claimed or started lease counts as active'
);

select is(
  (
    select roster.last_request_at
    from pilot_roster as roster
    where roster.user_id = '00000000-0000-0000-0000-000000002701'
  ),
  (
    select max(request.claimed_at)
    from private.webchat_requests as request
    where request.user_id = '00000000-0000-0000-0000-000000002701'
  ),
  'last request activity uses the historical maximum claimed timestamp'
);

select ok(
  exists (
    select 1 from pilot_roster
    where user_id = '00000000-0000-0000-0000-000000002705'
      and role = 'admin'
      and review_status = 'suspended'
      and access_enabled
  ),
  'the roster preserves configured suspended-account state for administrator cleanup'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002701', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002701","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table own_enabled_usage as
select * from public.read_own_webchat_usage();

select throws_ok(
  $$ select * from public.admin_list_webchat_pilot_members() $$,
  '42501',
  'Administrator access required.',
  'an ordinary member cannot read the pilot roster'
);

reset role;

select ok(
  exists (
    select 1
    from pilot_roster as roster
    cross join own_enabled_usage as own_usage
    where roster.user_id = '00000000-0000-0000-0000-000000002701'
      and roster.usage_date = own_usage.usage_date
      and roster.request_count = own_usage.request_count
      and roster.settled_tokens = own_usage.settled_tokens
      and roster.reserved_tokens = own_usage.reserved_tokens
      and roster.remaining_requests = own_usage.remaining_requests
      and roster.remaining_tokens = own_usage.remaining_tokens
  ),
  'expired-claimed pilot totals match the member own-usage reader exactly'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002702', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002702","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table own_disabled_usage as
select * from public.read_own_webchat_usage();

reset role;

select ok(
  exists (
    select 1
    from pilot_roster as roster
    cross join own_disabled_usage as own_usage
    where roster.user_id = '00000000-0000-0000-0000-000000002702'
      and roster.request_count = own_usage.request_count
      and roster.settled_tokens = own_usage.settled_tokens
      and roster.reserved_tokens = own_usage.reserved_tokens
      and roster.remaining_requests = own_usage.remaining_requests
      and roster.remaining_tokens = own_usage.remaining_tokens
  ),
  'expired-started pilot totals match the member own-usage reader exactly'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002705', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002705","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select * from public.admin_list_webchat_pilot_members() $$,
  '42501',
  'Administrator access required.',
  'a suspended administrator cannot read the pilot roster'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_like(
  $$ select * from public.admin_list_webchat_pilot_members() $$,
  '%permission denied%',
  'anonymous visitors cannot execute the pilot roster function'
);

reset role;

select * from finish();

rollback;
