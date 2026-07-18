begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select col_type_is(
  'private', 'webchat_requests', 'cached_input_tokens', 'bigint',
  'the private member request ledger stores cached input token counters'
);
select col_type_is(
  'private', 'webchat_requests', 'cache_write_tokens', 'bigint',
  'the private member request ledger stores cache-write token counters'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.finalize_webchat_request(uuid,text,uuid,text,bigint,bigint,bigint,bigint,bigint)',
    'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.finalize_webchat_request(uuid,text,uuid,text,bigint,bigint,bigint,bigint,bigint)',
      'EXECUTE'
    ),
  'only service_role can finalize real member cache usage'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.admin_read_webchat_cache_summary()', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.admin_read_webchat_cache_summary()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role', 'public.admin_read_webchat_cache_summary()', 'EXECUTE'
    ),
  'only authenticated administrators can reach the cache summary boundary'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'public.admin_read_webchat_cache_summary()'::regprocedure
  ),
  'the administrator cache summary is SECURITY DEFINER with a pinned search path'
);

select ok(
  pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.admin_read_webchat_cache_summary()'::regprocedure
    )
  ) !~ '(request_id|request_fingerprint|message_body|response_body|api_key|base_url)',
  'the administrator cache summary does not select identifiers, content, or credentials'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003201',
    'authenticated', 'authenticated', 'cache-member@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Cache Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003202',
    'authenticated', 'authenticated', 'cache-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Cache Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-000000003201' then 'Cache Member'
    else 'Cache Administrator'
  end,
  qq = case id
    when '00000000-0000-0000-0000-000000003201' then '13200000001'
    else '13200000002'
  end,
  role = case id
    when '00000000-0000-0000-0000-000000003202' then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  approved_at = now()
where id in (
  '00000000-0000-0000-0000-000000003201',
  '00000000-0000-0000-0000-000000003202'
);

insert into private.webchat_quota_states (user_id)
values ('00000000-0000-0000-0000-000000003201');

insert into private.webchat_daily_usage (
  user_id, usage_date, request_count, reserved_tokens
)
values (
  '00000000-0000-0000-0000-000000003201',
  (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
  1,
  5000
);

insert into private.webchat_global_daily_usage (
  usage_date, request_count, reserved_tokens
)
values (
  (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
  1,
  5000
);

insert into private.webchat_requests (
  user_id, request_id, request_fingerprint, owner_token, status, quota_date,
  claimed_at, upstream_started_at, lease_expires_at, reserved_tokens
)
values (
  '00000000-0000-0000-0000-000000003201',
  'real-cache-hit',
  repeat('a', 64),
  '32000000-0000-4000-8000-000000000001',
  'started',
  (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
  pg_catalog.statement_timestamp() - interval '1 minute',
  pg_catalog.statement_timestamp() - interval '59 seconds',
  pg_catalog.statement_timestamp() + interval '4 minutes',
  5000
);

set local role service_role;
select throws_ok(
  $$
    select * from public.finalize_webchat_request(
      '00000000-0000-0000-0000-000000003201',
      'real-cache-hit',
      '32000000-0000-4000-8000-000000000001',
      'completed',
      null, null, null,
      1, null
    )
  $$,
  '22023',
  'Cached token usage is inconsistent.',
  'cache counters cannot be supplied when trusted token usage is absent'
);

create temporary table finalized_cache_request as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000003201',
  'real-cache-hit',
  '32000000-0000-4000-8000-000000000001',
  'completed',
  3000, 200, 3200,
  2048, 3000
);
reset role;

select ok(
  exists (
    select 1 from finalized_cache_request
    where transitioned and status = 'finished' and charged_tokens = 3200
  ),
  'a started member request finalizes with trusted cache usage'
);

select ok(
  exists (
    select 1 from private.webchat_requests
    where request_id = 'real-cache-hit'
      and input_tokens = 3000
      and cached_input_tokens = 2048
      and cache_write_tokens = 3000
      and charged_tokens = 3200
  ),
  'the member request ledger stores only aggregate cache counters'
);

select ok(
  exists (
    select 1 from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000003201'
      and total_tokens = 3200
      and reserved_tokens = 0
  )
    and exists (
      select 1 from private.webchat_global_daily_usage
      where usage_date = (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date
        and total_tokens = 3200
        and reserved_tokens = 0
    ),
  'cache discounts do not reduce member or global quota charging'
);

insert into private.webchat_requests (
  user_id, request_id, request_fingerprint, owner_token, status, quota_date,
  claimed_at, upstream_started_at, finished_at, reserved_tokens,
  input_tokens, output_tokens, total_tokens, charged_tokens,
  cached_input_tokens, cache_write_tokens, outcome
)
values
  (
    '00000000-0000-0000-0000-000000003201',
    'real-cache-miss', repeat('b', 64),
    '32000000-0000-4000-8000-000000000002', 'finished',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    pg_catalog.statement_timestamp() - interval '30 seconds',
    pg_catalog.statement_timestamp() - interval '29 seconds',
    pg_catalog.statement_timestamp() - interval '28 seconds',
    2000, 1500, 10, 1510, 1510, 0, 1500, 'completed'
  ),
  (
    '00000000-0000-0000-0000-000000003201',
    'real-cache-unobserved', repeat('c', 64),
    '32000000-0000-4000-8000-000000000003', 'finished',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    pg_catalog.statement_timestamp() - interval '20 seconds',
    pg_catalog.statement_timestamp() - interval '19 seconds',
    pg_catalog.statement_timestamp() - interval '18 seconds',
    2500, 2000, 10, 2010, 2010, null, null, 'completed'
  );

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003202', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003202","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table cache_summary as
select * from public.admin_read_webchat_cache_summary();
reset role;

select ok(
  exists (
    select 1 from cache_summary
    where observed_requests = 2
      and eligible_requests = 2
      and cache_hit_requests = 1
      and eligible_input_tokens = 4500
      and cached_input_tokens = 2048
      and cache_write_tokens = 4500
  ),
  'the administrator summary reports only observed eligible aggregate cache usage'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003201', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003201","role":"authenticated"}',
  true
);
set local role authenticated;
select throws_ok(
  $$ select * from public.admin_read_webchat_cache_summary() $$,
  '42501',
  'Administrator access required.',
  'ordinary members cannot read the aggregate cache summary'
);
reset role;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$ select * from public.admin_read_webchat_cache_summary() $$,
  '42501',
  'permission denied for function admin_read_webchat_cache_summary',
  'anonymous visitors cannot execute the aggregate cache summary'
);
reset role;

select throws_ok(
  $$
    insert into private.webchat_requests (
      user_id, request_id, request_fingerprint, owner_token, status, quota_date,
      claimed_at, upstream_started_at, finished_at, reserved_tokens,
      input_tokens, output_tokens, total_tokens, charged_tokens,
      cached_input_tokens, outcome
    ) values (
      '00000000-0000-0000-0000-000000003201',
      'invalid-cache-counter', repeat('d', 64),
      '32000000-0000-4000-8000-000000000004', 'finished',
      (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
      pg_catalog.statement_timestamp(), pg_catalog.statement_timestamp(),
      pg_catalog.statement_timestamp(), 100,
      10, 1, 11, 11, 11, 'completed'
    )
  $$,
  '23514',
  'new row for relation "webchat_requests" violates check constraint "webchat_requests_cache_usage_consistent"',
  'the ledger rejects cached input counters larger than total input usage'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'private.webchat_requests', 'SELECT')
    and not pg_catalog.has_table_privilege('service_role', 'private.webchat_requests', 'SELECT'),
  'cache observability does not reopen direct request-ledger reads'
);

select * from finish();

rollback;
