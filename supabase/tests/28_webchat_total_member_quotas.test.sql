begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002801',
    'authenticated', 'authenticated', 'total-member-a@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Total Member A"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002802',
    'authenticated', 'authenticated', 'total-member-b@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Total Member B"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002803',
    'authenticated', 'authenticated', 'total-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Total Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-000000002801' then 'Total Member A'
    when '00000000-0000-0000-0000-000000002802' then 'Total Member B'
    else 'Total Administrator'
  end,
  qq = case id
    when '00000000-0000-0000-0000-000000002801' then '12800000001'
    when '00000000-0000-0000-0000-000000002802' then '12800000002'
    else '12800000003'
  end,
  grade = '24级',
  major = '计算机科学与技术',
  role = case
    when id = '00000000-0000-0000-0000-000000002803'
      then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  approved_at = now();

insert into private.webchat_member_access (
  user_id, access_enabled, total_request_limit, total_token_limit, version, updated_by
)
values
  (
    '00000000-0000-0000-0000-000000002801',
    true, 3, 800, 1,
    '00000000-0000-0000-0000-000000002803'
  ),
  (
    '00000000-0000-0000-0000-000000002802',
    true, 5, 1000, 1,
    '00000000-0000-0000-0000-000000002803'
  );

update private.webchat_relay_config
set
  requests_enabled = true,
  global_daily_request_limit = 3,
  global_daily_token_limit = 10000
where singleton;

insert into private.webchat_daily_usage (
  user_id, usage_date, request_count, input_tokens, output_tokens,
  unknown_tokens, total_tokens, reserved_tokens
)
values
  (
    '00000000-0000-0000-0000-000000002801',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date - 1,
    3, 250, 150, 0, 400, 100
  ),
  (
    '00000000-0000-0000-0000-000000002801',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    1, 60, 40, 0, 100, 0
  ),
  (
    '00000000-0000-0000-0000-000000002802',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date - 1,
    1, 60, 40, 0, 100, 200
  );

insert into private.webchat_global_daily_usage (
  usage_date, request_count, input_tokens, output_tokens,
  unknown_tokens, total_tokens, reserved_tokens
)
values (
  (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date - 1,
  4, 310, 190, 0, 500, 300
)
on conflict (usage_date) do update
set
  request_count = excluded.request_count,
  input_tokens = excluded.input_tokens,
  output_tokens = excluded.output_tokens,
  unknown_tokens = excluded.unknown_tokens,
  total_tokens = excluded.total_tokens,
  reserved_tokens = excluded.reserved_tokens;

insert into private.webchat_requests (
  user_id, request_id, request_fingerprint, owner_token, status, quota_date,
  request_counted, claimed_at, upstream_started_at, lease_expires_at,
  finished_at, reserved_tokens, charged_tokens, outcome
)
values
  (
    '00000000-0000-0000-0000-000000002801',
    'total-expired-claimed', repeat('a', 64),
    '28000000-0000-4000-8000-000000000001', 'claimed',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date - 1,
    true, pg_catalog.statement_timestamp() - interval '1 day 2 hours',
    null, pg_catalog.statement_timestamp() - interval '1 day 1 hour',
    null, 100, 0, null
  ),
  (
    '00000000-0000-0000-0000-000000002802',
    'total-expired-started', repeat('b', 64),
    '28000000-0000-4000-8000-000000000002', 'started',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date - 1,
    true, pg_catalog.statement_timestamp() - interval '1 day 2 hours',
    pg_catalog.statement_timestamp() - interval '1 day 119 minutes',
    pg_catalog.statement_timestamp() - interval '1 day 1 hour',
    null, 200, 0, null
  );

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'webchat_member_access'
      and column_name = 'total_request_limit'
  )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'private'
        and table_name = 'webchat_member_access'
        and column_name = 'total_token_limit'
    )
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'private'
        and table_name = 'webchat_member_access'
        and column_name in ('daily_request_limit', 'daily_token_limit')
    ),
  'member access stores only cumulative total-limit columns'
);

select ok(
  pg_catalog.pg_get_function_result('public.read_own_webchat_usage()'::regprocedure)
    ~ 'total_request_limit integer.*used_requests integer.*total_token_limit bigint.*used_tokens bigint'
    and pg_catalog.pg_get_function_result('public.read_own_webchat_usage()'::regprocedure)
      !~ '(usage_date|reset_at|daily_request_limit|daily_token_limit)',
  'own usage exposes cumulative totals without a member daily-reset contract'
);

select ok(
  pg_catalog.array_to_string(
    (
      select procedure.proargnames
      from pg_catalog.pg_proc as procedure
      where procedure.oid =
        'public.admin_update_webchat_member_access(uuid,boolean,integer,bigint,bigint,text)'::regprocedure
    ),
    ','
  ) like '%requested_total_request_limit,requested_total_token_limit%'
    and pg_catalog.array_to_string(
      (
        select procedure.proargnames
        from pg_catalog.pg_proc as procedure
        where procedure.oid =
          'public.admin_update_webchat_member_access(uuid,boolean,integer,bigint,bigint,text)'::regprocedure
      ),
      ','
    ) not like '%requested_daily%',
  'administrator policy parameters use total-limit names and remove the old daily API'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.claim_authorized_webchat_request(uuid,text,text,uuid,integer,bigint,integer)',
    'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.claim_authorized_webchat_request(uuid,text,text,uuid,integer,bigint,integer)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'public.claim_webchat_total_request(uuid,text,text,uuid,integer,integer,bigint,integer,bigint,bigint,integer)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'public.claim_webchat_request_internal(uuid,text,text,uuid,integer,integer,bigint,integer,bigint,bigint,integer)',
      'EXECUTE'
    )
    and pg_catalog.to_regprocedure(
      'public.claim_webchat_request(uuid,text,text,uuid,integer,integer,bigint,integer,bigint,bigint,integer)'
    ) is null,
  'only the authorized cumulative claim wrapper is service-callable'
);

update private.webchat_relay_config
set model = 'gpt-5.6-sol'
where singleton;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002801', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002801","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table member_a_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1 from member_a_usage
    where access_enabled
      and model = 'gpt-5.6-sol'
      and total_request_limit = 3
      and used_requests = 3
      and remaining_requests = 0
      and total_token_limit = 800
      and used_tokens = 500
      and reserved_tokens = 0
      and remaining_tokens = 300
  ),
  'member usage accumulates across two dates and virtually refunds an expired claim'
);

set local role service_role;
create temporary table member_a_blocked as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002801',
  'total-a-blocked', repeat('c', 64),
  '28000000-0000-4000-8000-000000000003',
  10, 200, 180
);
reset role;

select is(
  (select decision from member_a_blocked),
  'member_total_request_limited',
  'a new Beijing day does not restore an exhausted member request allowance'
);

select ok(
  exists (
    select 1 from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000002801'
      and request_id = 'total-expired-claimed'
      and status = 'released'
      and not request_counted
  )
    and exists (
      select 1 from private.webchat_daily_usage
      where user_id = '00000000-0000-0000-0000-000000002801'
        and usage_date = (
          pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai'
        )::date - 1
        and request_count = 2
        and reserved_tokens = 0
    ),
  'cross-date expired claimed work is persistently refunded before admission'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002803', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002803","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table raised_policy as
select * from public.admin_update_webchat_member_access(
  '00000000-0000-0000-0000-000000002801',
  true, 4, 800, 1,
  'Raise cumulative request allowance for test'
);
reset role;

select ok(
  exists (
    select 1 from raised_policy
    where total_request_limit = 4
      and total_token_limit = 800
      and version = 2
  ),
  'administrator optimistic policy updates return cumulative limit fields'
);

set local role service_role;
create temporary table member_a_acquired as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002801',
  'total-a-acquired', repeat('d', 64),
  '28000000-0000-4000-8000-000000000004',
  10, 200, 180
);
create temporary table member_a_duplicate as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002801',
  'total-a-acquired', repeat('d', 64),
  '28000000-0000-4000-8000-000000000004',
  10, 200, 180
);
reset role;

select ok(
  exists (
    select 1 from member_a_acquired
    where decision = 'acquired'
      and remaining_total_requests = 0
      and remaining_total_tokens = 100
  ),
  'raising the cumulative allowance permits one serialized claim with total remaining values'
);

select ok(
  (select decision = 'acquired' from member_a_duplicate)
    and (
      select count(*) = 1
      from private.webchat_requests
      where user_id = '00000000-0000-0000-0000-000000002801'
        and request_id = 'total-a-acquired'
    ),
  'replaying the same cumulative claim is idempotent'
);

select ok(
  exists (
    select 1 from private.webchat_global_daily_usage
    where usage_date = (
      pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai'
    )::date
      and request_count = 1
      and reserved_tokens = 200
  ),
  'an exhausted previous global day does not prevent a claim in the new Beijing day'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002803', true);
set local role authenticated;
create temporary table lowered_policy as
select * from public.admin_update_webchat_member_access(
  '00000000-0000-0000-0000-000000002801',
  true, 2, 800, 2,
  'Lower cumulative allowance below historical use'
);
reset role;

set local role service_role;
create temporary table member_a_lowered_block as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002801',
  'total-a-after-lower', repeat('e', 64),
  '28000000-0000-4000-8000-000000000005',
  10, 50, 180
);
reset role;

select is(
  (select decision from member_a_lowered_block),
  'member_total_request_limited',
  'lowering a member allowance below cumulative use immediately blocks new work'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002802', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002802","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table member_b_usage as
select * from public.read_own_webchat_usage();
reset role;

select ok(
  exists (
    select 1 from member_b_usage
    where used_requests = 1
      and used_tokens = 300
      and reserved_tokens = 0
      and remaining_tokens = 700
  ),
  'an expired started request from a previous date is virtually charged to cumulative use'
);

set local role service_role;
create temporary table member_b_acquired as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002802',
  'total-b-acquired', repeat('f', 64),
  '28000000-0000-4000-8000-000000000006',
  10, 100, 180
);
create temporary table member_b_duplicate as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000002802',
  'total-b-acquired', repeat('f', 64),
  '28000000-0000-4000-8000-000000000006',
  10, 100, 180
);
reset role;

select ok(
  exists (
    select 1 from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000002802'
      and request_id = 'total-expired-started'
      and status = 'expired'
      and charged_tokens = 200
  )
    and exists (
      select 1 from private.webchat_daily_usage
      where user_id = '00000000-0000-0000-0000-000000002802'
        and total_tokens = 300
        and reserved_tokens = 0
    ),
  'cross-date expired started work is persistently and conservatively settled'
);

select ok(
  (select decision = 'acquired' from member_b_acquired)
    and (select decision = 'acquired' from member_b_duplicate)
    and (
      select count(*) = 1
      from private.webchat_requests
      where user_id = '00000000-0000-0000-0000-000000002802'
        and request_id = 'total-b-acquired'
    ),
  'expired-started reconciliation and the replacement claim remain idempotent'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002803', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002803","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table pilot_totals as
select * from public.admin_list_webchat_pilot_members();
reset role;

select ok(
  exists (
    select 1 from pilot_totals
    where user_id = '00000000-0000-0000-0000-000000002801'
      and used_requests = 4
      and today_request_count = 2
      and used_tokens = 500
      and today_settled_tokens = 100
      and today_reserved_tokens = 200
      and remaining_requests = 0
  ),
  'administrator pilot observability separates cumulative totals from today activity'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002801', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002801","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select * from public.admin_list_webchat_pilot_members() $$,
  '42501',
  'Administrator access required.',
  'ordinary members cannot read cumulative pilot observability'
);

select throws_like(
  $$ select * from public.claim_authorized_webchat_request(
    '00000000-0000-0000-0000-000000002801',
    'browser-bypass', repeat('1', 64),
    '28000000-0000-4000-8000-000000000007',
    10, 10, 180
  ) $$,
  '%permission denied%',
  'authenticated browsers cannot bypass the service-only cumulative claim'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_like(
  $$ select * from public.read_own_webchat_usage() $$,
  '%permission denied%',
  'anonymous visitors cannot read cumulative member usage'
);

reset role;

select * from finish();

rollback;
