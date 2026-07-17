begin;

create extension if not exists pgtap with schema extensions;

select plan(66);

select has_table(
  'private',
  'webchat_quota_states',
  'the private WebChat quota lock table exists'
);

select has_table(
  'private',
  'webchat_daily_usage',
  'the private WebChat daily usage table exists'
);

select has_table(
  'private',
  'webchat_requests',
  'the private WebChat request ledger exists'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = any(array[
        'webchat_quota_states',
        'webchat_daily_usage',
        'webchat_requests'
      ])
      and relation.relrowsecurity
  ),
  3,
  'all private WebChat quota tables have row level security enabled'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'private'
      and tablename = any(array[
        'webchat_quota_states',
        'webchat_daily_usage',
        'webchat_requests'
      ])
  ),
  0,
  'the private WebChat quota tables expose no RLS policies'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'private.webchat_quota_states', 'SELECT')
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.webchat_daily_usage', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.webchat_requests', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.webchat_quota_states', 'INSERT'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.webchat_requests', 'UPDATE'
    ),
  'browser and service roles cannot access WebChat quota tables directly'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.claim_webchat_request(uuid,text,text,uuid,integer,integer,bigint,bigint,integer)',
    'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.mark_webchat_request_started(uuid,text,uuid)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.finalize_webchat_request(uuid,text,uuid,text,bigint,bigint,bigint)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.release_webchat_request(uuid,text,uuid,text)',
      'EXECUTE'
    ),
  'browser roles cannot call WebChat quota RPCs'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.claim_webchat_request(uuid,text,text,uuid,integer,integer,bigint,bigint,integer)',
    'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.mark_webchat_request_started(uuid,text,uuid)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.finalize_webchat_request(uuid,text,uuid,text,bigint,bigint,bigint)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.release_webchat_request(uuid,text,uuid,text)',
      'EXECUTE'
    ),
  'the service role can call every WebChat quota RPC'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'claim_webchat_request',
        'mark_webchat_request_started',
        'finalize_webchat_request',
        'release_webchat_request'
      ])
      and not procedure.prosecdef
  ),
  'all WebChat quota RPCs are SECURITY DEFINER functions'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'claim_webchat_request',
        'mark_webchat_request_started',
        'finalize_webchat_request',
        'release_webchat_request'
      ])
      and coalesce(procedure.proconfig::text, '') not like '%search_path=%'
  ),
  'all WebChat quota RPCs pin their search path'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000001901',
    'authenticated', 'authenticated', 'webchat-main@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Main Fixture"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000001902',
    'authenticated', 'authenticated', 'webchat-suspended@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Suspended Fixture"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000001903',
    'authenticated', 'authenticated', 'webchat-release@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Release Fixture"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000001904',
    'authenticated', 'authenticated', 'webchat-minute@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Minute Fixture"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000001905',
    'authenticated', 'authenticated', 'webchat-daily-request@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Daily Request Fixture"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000001906',
    'authenticated', 'authenticated', 'webchat-daily-token@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Daily Token Fixture"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000001907',
    'authenticated', 'authenticated', 'webchat-stale-claim@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Stale Claim Fixture"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000001908',
    'authenticated', 'authenticated', 'webchat-stale-started@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Stale Started Fixture"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000001909',
    'authenticated', 'authenticated', 'webchat-delete@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"WebChat Delete Fixture"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  review_status = 'suspended',
  review_note = 'WebChat quota suspension fixture'
where id = '00000000-0000-0000-0000-000000001902';

set local role service_role;
select throws_ok(
  $$
    select * from public.claim_webchat_request(
      '00000000-0000-0000-0000-000000001902',
      'suspended-request',
      repeat('a', 64),
      '10000000-0000-4000-8000-000000001902',
      5,
      10,
      1000,
      100,
      180
    )
  $$,
  '42501',
  'An active member account is required.',
  'a suspended member cannot claim WebChat quota'
);
reset role;

select is(
  (
    select count(*)::integer
    from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000001902'
  ),
  0,
  'a rejected suspended member creates no request ledger row'
);

set local role service_role;
create temporary table main_claim as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  repeat('a', 64),
  '10000000-0000-4000-8000-000000001901',
  5,
  10,
  1000,
  100,
  180
);
reset role;

select is(
  (select decision from main_claim),
  'acquired',
  'an approved member atomically acquires a WebChat claim'
);

select ok(
  (select status = 'claimed' from main_claim)
    and (select remaining_minute_requests = 4 from main_claim)
    and (select remaining_daily_requests = 9 from main_claim)
    and (select remaining_daily_tokens = 900 from main_claim),
  'an acquired claim reports the remaining minute, daily request, and token budget'
);

select ok(
  exists (
    select 1
    from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000001901'
      and request_id = 'main-request'
      and request_fingerprint = repeat('a', 64)
      and owner_token = '10000000-0000-4000-8000-000000001901'
      and status = 'claimed'
      and request_counted
      and reserved_tokens = 100
  ),
  'the acquired claim persists its fingerprint, owner fence, status, and reservation'
);

select ok(
  exists (
    select 1
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000001901'
      and usage_date = (now() at time zone 'Asia/Shanghai')::date
      and request_count = 1
      and reserved_tokens = 100
      and total_tokens = 0
  ),
  'claiming increments the Beijing-day request and reservation counters'
);

set local role service_role;
create temporary table main_retry as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  repeat('a', 64),
  '10000000-0000-4000-8000-000000001901',
  5,
  10,
  1000,
  100,
  180
);
create temporary table main_duplicate as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  repeat('a', 64),
  '20000000-0000-4000-8000-000000001901',
  5,
  10,
  1000,
  100,
  180
);
create temporary table main_conflict as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  repeat('b', 64),
  '30000000-0000-4000-8000-000000001901',
  5,
  10,
  1000,
  100,
  180
);
create temporary table main_concurrent as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'concurrent-request',
  repeat('c', 64),
  '40000000-0000-4000-8000-000000001901',
  5,
  10,
  1000,
  100,
  180
);
reset role;

select is(
  (select decision from main_retry),
  'acquired',
  'the same owner can safely repeat the same idempotent claim'
);

select ok(
  exists (
    select 1
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000001901'
      and request_count = 1
      and reserved_tokens = 100
  ),
  'an idempotent claim retry does not consume quota twice'
);

select is(
  (select decision from main_duplicate),
  'duplicate_active',
  'a different owner sees an active duplicate instead of stealing the claim'
);

select is(
  (select decision from main_conflict),
  'idempotency_conflict',
  'reusing a request ID with a different fingerprint is rejected'
);

select is(
  (select decision from main_concurrent),
  'active_concurrent',
  'a second request cannot run while the member has an active generation'
);

select is(
  (
    select count(*)::integer
    from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000001901'
  ),
  1,
  'duplicate, conflicting, and concurrent claims create no extra ledger rows'
);

set local role service_role;
create temporary table main_wrong_mark as
select public.mark_webchat_request_started(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  '20000000-0000-4000-8000-000000001901'
) as value;
create temporary table main_null_mark as
select public.mark_webchat_request_started(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  null
) as value;
create temporary table main_mark as
select public.mark_webchat_request_started(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  '10000000-0000-4000-8000-000000001901'
) as value;
reset role;

select is(
  (select value from main_wrong_mark),
  false,
  'a non-owner cannot mark another worker claim as started'
);

select is(
  (select value from main_mark),
  true,
  'the fenced owner marks the claim started immediately before the upstream request'
);

select ok(
  exists (
    select 1
    from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000001901'
      and request_id = 'main-request'
      and status = 'started'
      and upstream_started_at is not null
  ),
  'marking a claim persists the potentially billable started state'
);

set local role service_role;
create temporary table main_wrong_release as
select public.release_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  '20000000-0000-4000-8000-000000001901',
  'wrong_owner'
) as value;
create temporary table main_wrong_finalize as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  '20000000-0000-4000-8000-000000001901',
  'completed',
  50,
  20,
  70
);
create temporary table main_null_finalize as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  null,
  'completed',
  50,
  20,
  70
);
create temporary table main_finalize as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  '10000000-0000-4000-8000-000000001901',
  'completed',
  50,
  20,
  70
);
reset role;

select is(
  (select value from main_wrong_release),
  false,
  'a non-owner cannot release another worker claim'
);

select ok(
  not (select value from main_null_mark)
    and not (select transitioned from main_null_finalize),
  'NULL owner tokens cannot bypass mark or finalize fences'
);

select ok(
  not (select transitioned from main_wrong_finalize)
    and (select status = 'started' from main_wrong_finalize),
  'a non-owner cannot finalize another worker started request'
);

select ok(
  (select transitioned from main_finalize)
    and (select status = 'finished' from main_finalize)
    and (select charged_tokens = 70 from main_finalize),
  'the owner finalizes known token usage exactly once'
);

select ok(
  exists (
    select 1
    from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000001901'
      and request_id = 'main-request'
      and status = 'finished'
      and input_tokens = 50
      and output_tokens = 20
      and total_tokens = 70
      and charged_tokens = 70
      and outcome = 'completed'
      and finished_at is not null
  ),
  'known finalization persists trusted usage and terminal request metadata'
);

select ok(
  exists (
    select 1
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000001901'
      and request_count = 1
      and input_tokens = 50
      and output_tokens = 20
      and unknown_tokens = 0
      and total_tokens = 70
      and reserved_tokens = 0
  ),
  'known finalization replaces the reservation with trusted daily usage'
);

set local role service_role;
create temporary table main_repeat_finalize as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  '10000000-0000-4000-8000-000000001901',
  'completed',
  50,
  20,
  70
);
create temporary table main_started_release as
select public.release_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-request',
  '10000000-0000-4000-8000-000000001901',
  'too_late'
) as value;
reset role;

select ok(
  not (select transitioned from main_repeat_finalize)
    and (select status = 'finished' from main_repeat_finalize)
    and (select charged_tokens = 70 from main_repeat_finalize),
  'repeating a terminal finalization is idempotent'
);

select is(
  (
    select total_tokens
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000001901'
  ),
  70::bigint,
  'a repeated finalization does not double-charge daily usage'
);

select is(
  (select value from main_started_release),
  false,
  'a started or finished request cannot be refunded through release'
);

set local role service_role;
create temporary table main_unknown_claim as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-unknown-request',
  repeat('e', 64),
  '50000000-0000-4000-8000-000000001901',
  5,
  10,
  1000,
  120,
  180
);
create temporary table main_unknown_mark as
select public.mark_webchat_request_started(
  '00000000-0000-0000-0000-000000001901',
  'main-unknown-request',
  '50000000-0000-4000-8000-000000001901'
) as value;
create temporary table main_unknown_finalize as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000001901',
  'main-unknown-request',
  '50000000-0000-4000-8000-000000001901',
  'request_aborted',
  null,
  null,
  null
);
reset role;

select is(
  (select decision from main_unknown_claim),
  'acquired',
  'a later request can reserve quota for an unknown-usage outcome'
);

select ok(
  (select value from main_unknown_mark)
    and (select transitioned from main_unknown_finalize)
    and (select charged_tokens = 120 from main_unknown_finalize),
  'an aborted started request charges the full reservation when usage is unknown'
);

select ok(
  exists (
    select 1
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000001901'
      and request_count = 2
      and input_tokens = 50
      and output_tokens = 20
      and unknown_tokens = 120
      and total_tokens = 190
      and reserved_tokens = 0
  ),
  'unknown finalization preserves trusted usage and moves the reservation into unknown tokens'
);

set local role service_role;
create temporary table release_claim as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001903',
  'release-request',
  repeat('d', 64),
  '10000000-0000-4000-8000-000000001903',
  5,
  10,
  1000,
  90,
  180
);
create temporary table release_wrong_owner as
select public.release_webchat_request(
  '00000000-0000-0000-0000-000000001903',
  'release-request',
  '20000000-0000-4000-8000-000000001903',
  'wrong_owner'
) as value;
create temporary table release_null_owner as
select public.release_webchat_request(
  '00000000-0000-0000-0000-000000001903',
  'release-request',
  null,
  'null_owner'
) as value;
create temporary table release_owner as
select public.release_webchat_request(
  '00000000-0000-0000-0000-000000001903',
  'release-request',
  '10000000-0000-4000-8000-000000001903',
  'fetch_not_started'
) as value;
reset role;

select is(
  (select decision from release_claim),
  'acquired',
  'the release fixture acquires a refundable pre-fetch claim'
);

select ok(
  not (select value from release_wrong_owner)
    and not (select value from release_null_owner),
  'wrong and NULL owner tokens cannot refund a pre-fetch claim'
);

select is(
  (select value from release_owner),
  true,
  'the fenced owner can release a claim before the upstream request starts'
);

select ok(
  exists (
    select 1
    from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000001903'
      and request_id = 'release-request'
      and status = 'released'
      and not request_counted
      and outcome = 'fetch_not_started'
      and finished_at is not null
  ),
  'release preserves an idempotency tombstone while removing it from quota counts'
);

select ok(
  exists (
    select 1
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000001903'
      and request_count = 0
      and reserved_tokens = 0
      and total_tokens = 0
  ),
  'release refunds the request and token reservation atomically'
);

set local role service_role;
create temporary table release_repeat as
select public.release_webchat_request(
  '00000000-0000-0000-0000-000000001903',
  'release-request',
  '10000000-0000-4000-8000-000000001903',
  'fetch_not_started'
) as value;
create temporary table release_duplicate as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001903',
  'release-request',
  repeat('d', 64),
  '30000000-0000-4000-8000-000000001903',
  5,
  10,
  1000,
  90,
  180
);
reset role;

select is(
  (select value from release_repeat),
  false,
  'releasing the same terminal claim twice is idempotent'
);

select is(
  (select decision from release_duplicate),
  'duplicate_terminal',
  'a released request ID remains a terminal duplicate tombstone'
);

set local role service_role;
create temporary table minute_first as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001904',
  'minute-first',
  repeat('a', 64),
  '10000000-0000-4000-8000-000000001904',
  1,
  10,
  1000,
  50,
  180
);
create temporary table minute_mark as
select public.mark_webchat_request_started(
  '00000000-0000-0000-0000-000000001904',
  'minute-first',
  '10000000-0000-4000-8000-000000001904'
) as value;
create temporary table minute_finalize as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000001904',
  'minute-first',
  '10000000-0000-4000-8000-000000001904',
  'completed',
  20,
  10,
  30
);
create temporary table minute_second as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001904',
  'minute-second',
  repeat('b', 64),
  '20000000-0000-4000-8000-000000001904',
  1,
  10,
  1000,
  50,
  180
);
reset role;

select is(
  (select decision from minute_first),
  'acquired',
  'the minute-limit fixture consumes its first request'
);

select is(
  (select decision from minute_second),
  'minute_limited',
  'the sliding 60-second limit blocks the next completed request'
);

select is(
  (
    select count(*)::integer
    from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000001904'
  ),
  1,
  'a minute-limited attempt creates no request ledger row'
);

set local role service_role;
create temporary table daily_request_first as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001905',
  'daily-request-first',
  repeat('a', 64),
  '10000000-0000-4000-8000-000000001905',
  10,
  1,
  1000,
  50,
  180
);
create temporary table daily_request_mark as
select public.mark_webchat_request_started(
  '00000000-0000-0000-0000-000000001905',
  'daily-request-first',
  '10000000-0000-4000-8000-000000001905'
) as value;
create temporary table daily_request_finalize as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000001905',
  'daily-request-first',
  '10000000-0000-4000-8000-000000001905',
  'completed',
  20,
  10,
  30
);
create temporary table daily_request_second as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001905',
  'daily-request-second',
  repeat('b', 64),
  '20000000-0000-4000-8000-000000001905',
  10,
  1,
  1000,
  50,
  180
);
reset role;

select is(
  (select decision from daily_request_first),
  'acquired',
  'the daily-request fixture consumes its first request'
);

select is(
  (select decision from daily_request_second),
  'daily_request_limited',
  'the Beijing-day request limit blocks the next request'
);

select is(
  (
    select request_count
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000001905'
  ),
  1,
  'a daily-request rejection does not increment the daily counter'
);

set local role service_role;
create temporary table daily_token_first as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001906',
  'daily-token-first',
  repeat('a', 64),
  '10000000-0000-4000-8000-000000001906',
  10,
  10,
  100,
  80,
  180
);
create temporary table daily_token_mark as
select public.mark_webchat_request_started(
  '00000000-0000-0000-0000-000000001906',
  'daily-token-first',
  '10000000-0000-4000-8000-000000001906'
) as value;
create temporary table daily_token_finalize as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000001906',
  'daily-token-first',
  '10000000-0000-4000-8000-000000001906',
  'completed',
  50,
  30,
  80
);
create temporary table daily_token_second as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001906',
  'daily-token-second',
  repeat('b', 64),
  '20000000-0000-4000-8000-000000001906',
  10,
  10,
  100,
  30,
  180
);
reset role;

select is(
  (select decision from daily_token_first),
  'acquired',
  'the daily-token fixture consumes a known token charge'
);

select is(
  (select decision from daily_token_second),
  'daily_token_limited',
  'used plus newly reserved tokens cannot exceed the Beijing-day budget'
);

select ok(
  exists (
    select 1
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000001906'
      and total_tokens = 80
      and reserved_tokens = 0
  ),
  'a daily-token rejection leaves trusted usage unchanged'
);

set local role service_role;
create temporary table stale_claim_first as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001907',
  'stale-claimed-first',
  repeat('a', 64),
  '10000000-0000-4000-8000-000000001907',
  10,
  10,
  1000,
  80,
  180
);
reset role;

select is(
  (select decision from stale_claim_first),
  'acquired',
  'the stale-claim fixture starts with an active pre-fetch reservation'
);

update private.webchat_requests
set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where user_id = '00000000-0000-0000-0000-000000001907'
  and request_id = 'stale-claimed-first';

set local role service_role;
create temporary table stale_claim_same_id as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001907',
  'stale-claimed-first',
  repeat('a', 64),
  '30000000-0000-4000-8000-000000001907',
  10,
  10,
  1000,
  80,
  180
);
create temporary table stale_claim_second as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001907',
  'stale-claimed-second',
  repeat('b', 64),
  '20000000-0000-4000-8000-000000001907',
  10,
  10,
  1000,
  50,
  180
);
reset role;

select is(
  (select decision from stale_claim_same_id),
  'duplicate_terminal',
  'an expired pre-fetch request ID is refunded and cannot be resumed across quota windows'
);

select is(
  (select decision from stale_claim_second),
  'acquired',
  'a new request reclaims the slot after a stale pre-fetch claim'
);

select ok(
  exists (
    select 1
    from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000001907'
      and request_id = 'stale-claimed-first'
      and status = 'released'
      and not request_counted
      and outcome = 'lease_expired_before_start'
      and charged_tokens = 0
  ),
  'a stale claim that never started is released without a token charge'
);

select ok(
  exists (
    select 1
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000001907'
      and request_count = 1
      and reserved_tokens = 50
      and total_tokens = 0
  ),
  'stale pre-fetch recovery refunds the old quota before reserving the new claim'
);

set local role service_role;
create temporary table stale_started_first as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001908',
  'stale-started-first',
  repeat('a', 64),
  '10000000-0000-4000-8000-000000001908',
  10,
  10,
  1000,
  100,
  180
);
create temporary table stale_started_mark as
select public.mark_webchat_request_started(
  '00000000-0000-0000-0000-000000001908',
  'stale-started-first',
  '10000000-0000-4000-8000-000000001908'
) as value;
reset role;

select is(
  (select decision from stale_started_first),
  'acquired',
  'the stale-started fixture acquires its first request'
);

update private.webchat_requests
set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where user_id = '00000000-0000-0000-0000-000000001908'
  and request_id = 'stale-started-first';

set local role service_role;
create temporary table stale_started_second as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001908',
  'stale-started-second',
  repeat('b', 64),
  '20000000-0000-4000-8000-000000001908',
  10,
  10,
  1000,
  50,
  180
);
create temporary table stale_started_old_finalize as
select * from public.finalize_webchat_request(
  '00000000-0000-0000-0000-000000001908',
  'stale-started-first',
  '10000000-0000-4000-8000-000000001908',
  'completed',
  20,
  10,
  30
);
reset role;

select is(
  (select decision from stale_started_second),
  'acquired',
  'a new request reclaims the slot after a stale started generation'
);

select ok(
  exists (
    select 1
    from private.webchat_requests
    where user_id = '00000000-0000-0000-0000-000000001908'
      and request_id = 'stale-started-first'
      and status = 'expired'
      and request_counted
      and charged_tokens = 100
      and outcome = 'lease_expired_after_start'
  ),
  'a stale started request is conservatively charged its full reservation'
);

select ok(
  exists (
    select 1
    from private.webchat_daily_usage
    where user_id = '00000000-0000-0000-0000-000000001908'
      and request_count = 2
      and unknown_tokens = 100
      and total_tokens = 100
      and reserved_tokens = 50
  ),
  'stale started recovery keeps the old request counted and reserves the replacement'
);

select ok(
  not (select transitioned from stale_started_old_finalize)
    and (select status = 'expired' from stale_started_old_finalize)
    and (select charged_tokens = 100 from stale_started_old_finalize),
  'an expired worker is fenced from overwriting its conservative terminal charge'
);

set local role service_role;
create temporary table delete_claim as
select * from public.claim_webchat_request(
  '00000000-0000-0000-0000-000000001909',
  'delete-request',
  repeat('a', 64),
  '10000000-0000-4000-8000-000000001909',
  10,
  10,
  1000,
  50,
  180
);
reset role;

select is(
  (select decision from delete_claim),
  'acquired',
  'the account-deletion fixture has quota state, usage, and request rows'
);

select is(
  (
    (select count(*) from private.webchat_quota_states
      where user_id = '00000000-0000-0000-0000-000000001909')
    + (select count(*) from private.webchat_daily_usage
      where user_id = '00000000-0000-0000-0000-000000001909')
    + (select count(*) from private.webchat_requests
      where user_id = '00000000-0000-0000-0000-000000001909')
  )::integer,
  3,
  'all three private WebChat rows exist before profile deletion'
);

delete from public.profiles
where id = '00000000-0000-0000-0000-000000001909';

select is(
  (
    (select count(*) from private.webchat_quota_states
      where user_id = '00000000-0000-0000-0000-000000001909')
    + (select count(*) from private.webchat_daily_usage
      where user_id = '00000000-0000-0000-0000-000000001909')
    + (select count(*) from private.webchat_requests
      where user_id = '00000000-0000-0000-0000-000000001909')
  )::integer,
  0,
  'profile deletion cascades through all private WebChat quota records'
);

select * from finish();

rollback;
