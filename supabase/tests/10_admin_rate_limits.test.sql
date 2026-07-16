begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000aa',
    'authenticated', 'authenticated', 'rate-limit-member@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Rate Limit Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000ba',
    'authenticated', 'authenticated', 'rate-limit-admin@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Rate Limit Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-0000000000aa' then 'Rate Limit Member'
    else 'Rate Limit Administrator'
  end,
  role = case
    when id = '00000000-0000-0000-0000-0000000000ba' then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  approved_at = now();

select has_table(
  'public',
  'admin_rate_limit_buckets',
  'administrator rate-limit buckets exist'
);

select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.admin_rate_limit_buckets',
    'SELECT'
  ),
  'browser sessions cannot inspect rate-limit counters'
);

select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.admin_rate_limit_buckets',
    'INSERT'
  ),
  'browser sessions cannot forge rate-limit counters'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.consume_admin_rate_limit(uuid,text,integer,integer)',
    'EXECUTE'
  ),
  'browser sessions cannot consume arbitrary rate-limit keys directly'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.consume_admin_rate_limit(uuid,text,integer,integer)',
    'EXECUTE'
  ),
  'the service role can protect administrator Edge Functions'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.admin_set_member_suspension_unlimited(uuid,boolean,timestamptz,text)',
    'EXECUTE'
  ),
  'authenticated sessions cannot bypass the rate-limited wrapper'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.admin_set_member_suspension(uuid,boolean,timestamptz,text)',
    'EXECUTE'
  ),
  'authenticated sessions can reach the administrator-checked wrapper'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select public.admin_set_member_suspension(
      '00000000-0000-0000-0000-0000000000aa',
      true,
      (select updated_at from public.profiles where id = '00000000-0000-0000-0000-0000000000aa'),
      'not allowed'
    )
  $$,
  '42501',
  'Administrator access required.',
  'ordinary members cannot use a wrapped administrator writer'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    select * from public.consume_admin_rate_limit(
      '00000000-0000-0000-0000-0000000000ba',
      'test.edge',
      2,
      60
    )
  $$,
  'the first service-side administrative request is accepted'
);

select is(
  (
    select remaining_requests
    from public.consume_admin_rate_limit(
      '00000000-0000-0000-0000-0000000000ba',
      'test.edge',
      2,
      60
    )
  ),
  0,
  'the atomic counter reports the remaining allowance'
);

select throws_ok(
  $$
    select * from public.consume_admin_rate_limit(
      '00000000-0000-0000-0000-0000000000ba',
      'test.edge',
      2,
      60
    )
  $$,
  'PT429',
  'admin_rate_limited',
  'requests above the configured limit are rejected'
);

select is(
  (
    select remaining_requests
    from public.consume_admin_rate_limit(
      '00000000-0000-0000-0000-0000000000ba',
      'test.other',
      2,
      60
    )
  ),
  1,
  'different administrative actions use independent buckets'
);

reset role;

update public.admin_rate_limit_buckets
set window_started_at = pg_catalog.clock_timestamp() - interval '2 minutes'
where actor_id = '00000000-0000-0000-0000-0000000000ba'
  and action_key = 'test.edge';

set local role service_role;
select is(
  (
    select remaining_requests
    from public.consume_admin_rate_limit(
      '00000000-0000-0000-0000-0000000000ba',
      'test.edge',
      2,
      60
    )
  ),
  1,
  'expired windows reset their counter atomically'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ba', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000ba","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select public.admin_set_member_suspension(
      '00000000-0000-0000-0000-0000000000aa',
      true,
      (select updated_at from public.profiles where id = '00000000-0000-0000-0000-0000000000aa'),
      'controlled suspension'
    )
  $$,
  'administrators can still perform a wrapped write'
);

reset role;

select is(
  (
    select request_count
    from public.admin_rate_limit_buckets
    where actor_id = '00000000-0000-0000-0000-0000000000ba'
      and action_key = 'member.write'
  ),
  1,
  'wrapped writes consume the expected administrator bucket'
);

select * from finish();

rollback;
