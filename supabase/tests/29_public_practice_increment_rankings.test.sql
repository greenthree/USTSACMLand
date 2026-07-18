begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002901',
    'authenticated', 'authenticated', 'increment-main@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Increment Main"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002902',
    'authenticated', 'authenticated', 'increment-rebound@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Increment Rebound"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002903',
    'authenticated', 'authenticated', 'increment-hidden@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Increment Hidden"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002904',
    'authenticated', 'authenticated', 'increment-unbound@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Increment Unbound"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-000000002901' then 'Increment Main'
    when '00000000-0000-0000-0000-000000002902' then 'Increment Rebound'
    when '00000000-0000-0000-0000-000000002903' then 'Increment Hidden'
    else 'Increment Unbound'
  end,
  qq = case id
    when '00000000-0000-0000-0000-000000002901' then '12900000001'
    when '00000000-0000-0000-0000-000000002902' then '12900000002'
    when '00000000-0000-0000-0000-000000002903' then '12900000003'
    else '12900000004'
  end,
  grade = '24级',
  major = '计算机科学与技术',
  review_status = 'approved',
  approved_at = now(),
  is_public = id <> '00000000-0000-0000-0000-000000002903'
where id in (
  '00000000-0000-0000-0000-000000002901',
  '00000000-0000-0000-0000-000000002902',
  '00000000-0000-0000-0000-000000002903',
  '00000000-0000-0000-0000-000000002904'
);

insert into public.platform_accounts (
  id, profile_id, platform, external_id, normalized_external_id, status,
  verified_at, created_at, updated_at
)
overriding system value
values
  (29011, '00000000-0000-0000-0000-000000002901', 'codeforces', 'IncrementMain',
    'incrementmain', 'verified', '2026-07-01 00:00+08', '2026-07-01 00:00+08', '2026-07-01 00:00+08'),
  (29012, '00000000-0000-0000-0000-000000002901', 'nowcoder', '2901201',
    '2901201', 'verified', '2026-07-01 00:00+08', '2026-07-01 00:00+08', '2026-07-01 00:00+08'),
  (29013, '00000000-0000-0000-0000-000000002901', 'atcoder', 'Increment_Main',
    'increment_main', 'verified', '2026-07-01 00:00+08', '2026-07-01 00:00+08', '2026-07-01 00:00+08'),
  (29014, '00000000-0000-0000-0000-000000002901', 'luogu', '2901401',
    '2901401', 'verified', '2026-07-01 00:00+08', '2026-07-01 00:00+08', '2026-07-01 00:00+08'),
  (29021, '00000000-0000-0000-0000-000000002902', 'codeforces', 'IncrementRebound',
    'incrementrebound', 'verified', '2026-07-12 00:00+08', '2026-07-01 00:00+08', '2026-07-12 00:00+08'),
  (29031, '00000000-0000-0000-0000-000000002903', 'codeforces', 'IncrementHidden',
    'incrementhidden', 'verified', '2026-07-01 00:00+08', '2026-07-01 00:00+08', '2026-07-01 00:00+08');

insert into public.sync_jobs (
  id, scope, profile_id, platform, status, trigger_type, attempt_count, max_attempts,
  scheduled_for, started_at, finished_at
)
overriding system value
select
  fixture.run_id,
  'account'::public.sync_job_scope,
  fixture.profile_id,
  fixture.platform,
  case when fixture.run_status = 'succeeded'
    then 'succeeded'::public.sync_job_status
    else 'failed'::public.sync_job_status
  end,
  'scheduled'::public.sync_trigger_type,
  1,
  1,
  fixture.recorded_at,
  fixture.recorded_at - interval '1 minute',
  fixture.recorded_at
from (
  values
    (29201::bigint, '00000000-0000-0000-0000-000000002901'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (29202, '00000000-0000-0000-0000-000000002901'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-16 18:00+08'::timestamptz),
    (29203, '00000000-0000-0000-0000-000000002901'::uuid, 'codeforces'::public.platform_name, 'failed'::public.sync_run_status, '2026-07-16 19:00+08'::timestamptz),
    (29204, '00000000-0000-0000-0000-000000002901'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-17 12:00+08'::timestamptz),
    (29205, '00000000-0000-0000-0000-000000002901'::uuid, 'nowcoder'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (29206, '00000000-0000-0000-0000-000000002901'::uuid, 'nowcoder'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-15 10:00+08'::timestamptz),
    (29207, '00000000-0000-0000-0000-000000002901'::uuid, 'atcoder'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-14 10:00+08'::timestamptz),
    (29208, '00000000-0000-0000-0000-000000002901'::uuid, 'luogu'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (29209, '00000000-0000-0000-0000-000000002902'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (29210, '00000000-0000-0000-0000-000000002902'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-15 10:00+08'::timestamptz),
    (29211, '00000000-0000-0000-0000-000000002903'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (29212, '00000000-0000-0000-0000-000000002903'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-15 10:00+08'::timestamptz)
) as fixture(run_id, profile_id, platform, run_status, recorded_at);

insert into public.sync_runs (
  id, job_id, profile_id, platform, platform_account_id, attempt, status,
  started_at, finished_at, duration_ms, metrics
)
overriding system value
select
  fixture.run_id,
  fixture.run_id,
  fixture.profile_id,
  fixture.platform,
  fixture.account_id,
  1,
  fixture.run_status,
  fixture.recorded_at - interval '1 minute',
  fixture.recorded_at,
  60000,
  '{}'::jsonb
from (
  values
    (29201::bigint, '00000000-0000-0000-0000-000000002901'::uuid, 'codeforces'::public.platform_name, 29011::bigint, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (29202, '00000000-0000-0000-0000-000000002901'::uuid, 'codeforces'::public.platform_name, 29011::bigint, 'succeeded'::public.sync_run_status, '2026-07-16 18:00+08'::timestamptz),
    (29203, '00000000-0000-0000-0000-000000002901'::uuid, 'codeforces'::public.platform_name, 29011::bigint, 'failed'::public.sync_run_status, '2026-07-16 19:00+08'::timestamptz),
    (29204, '00000000-0000-0000-0000-000000002901'::uuid, 'codeforces'::public.platform_name, 29011::bigint, 'succeeded'::public.sync_run_status, '2026-07-17 12:00+08'::timestamptz),
    (29205, '00000000-0000-0000-0000-000000002901'::uuid, 'nowcoder'::public.platform_name, 29012::bigint, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (29206, '00000000-0000-0000-0000-000000002901'::uuid, 'nowcoder'::public.platform_name, 29012::bigint, 'succeeded'::public.sync_run_status, '2026-07-15 10:00+08'::timestamptz),
    (29207, '00000000-0000-0000-0000-000000002901'::uuid, 'atcoder'::public.platform_name, 29013::bigint, 'succeeded'::public.sync_run_status, '2026-07-14 10:00+08'::timestamptz),
    (29208, '00000000-0000-0000-0000-000000002901'::uuid, 'luogu'::public.platform_name, 29014::bigint, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (29209, '00000000-0000-0000-0000-000000002902'::uuid, 'codeforces'::public.platform_name, 29021::bigint, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (29210, '00000000-0000-0000-0000-000000002902'::uuid, 'codeforces'::public.platform_name, 29021::bigint, 'succeeded'::public.sync_run_status, '2026-07-15 10:00+08'::timestamptz),
    (29211, '00000000-0000-0000-0000-000000002903'::uuid, 'codeforces'::public.platform_name, 29031::bigint, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (29212, '00000000-0000-0000-0000-000000002903'::uuid, 'codeforces'::public.platform_name, 29031::bigint, 'succeeded'::public.sync_run_status, '2026-07-15 10:00+08'::timestamptz)
) as fixture(run_id, profile_id, platform, account_id, run_status, recorded_at);

insert into public.stat_snapshots (
  profile_id, platform, sync_run_id, solved_count, status, recorded_at
)
values
  ('00000000-0000-0000-0000-000000002901', 'codeforces', 29201, 100, 'fresh', '2026-07-09 10:00+08'),
  ('00000000-0000-0000-0000-000000002901', 'codeforces', 29202, 112, 'fresh', '2026-07-16 18:00+08'),
  ('00000000-0000-0000-0000-000000002901', 'codeforces', 29203, 999, 'stale', '2026-07-16 19:00+08'),
  ('00000000-0000-0000-0000-000000002901', 'codeforces', 29204, 150, 'fresh', '2026-07-17 12:00+08'),
  ('00000000-0000-0000-0000-000000002901', 'nowcoder', 29205, 50, 'fresh', '2026-07-09 10:00+08'),
  ('00000000-0000-0000-0000-000000002901', 'nowcoder', 29206, 45, 'fresh', '2026-07-15 10:00+08'),
  ('00000000-0000-0000-0000-000000002901', 'atcoder', 29207, 10, 'fresh', '2026-07-14 10:00+08'),
  ('00000000-0000-0000-0000-000000002901', 'luogu', 29208, 20, 'fresh', '2026-07-09 10:00+08'),
  ('00000000-0000-0000-0000-000000002902', 'codeforces', 29209, 200, 'fresh', '2026-07-09 10:00+08'),
  ('00000000-0000-0000-0000-000000002902', 'codeforces', 29210, 210, 'fresh', '2026-07-15 10:00+08'),
  ('00000000-0000-0000-0000-000000002903', 'codeforces', 29211, 1, 'fresh', '2026-07-09 10:00+08'),
  ('00000000-0000-0000-0000-000000002903', 'codeforces', 29212, 99, 'fresh', '2026-07-15 10:00+08');

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'stat_snapshots'
      and indexname = 'stat_snapshots_solved_range_idx'
      and indexdef like '%INCLUDE (solved_count, sync_run_id)%'
  ),
  1,
  'solved-count range lookups have a covering index'
);

select ok(
  pg_catalog.has_function_privilege(
    'anon', 'public.get_public_practice_increments(date,date)', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.get_public_practice_increments(date,date)', 'EXECUTE'
    ),
  'anonymous and authenticated visitors can read the sanitized increment ranking'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'get_public_practice_increments'
      and procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
  ),
  'the public increment function is SECURITY DEFINER with a pinned search path'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'public.stat_snapshots', 'SELECT'),
  'anonymous visitors still cannot read raw snapshot rows'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select is(
  (
    select count(*)::integer
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id in (
      '00000000-0000-0000-0000-000000002901',
      '00000000-0000-0000-0000-000000002902',
      '00000000-0000-0000-0000-000000002904'
    )
  ),
  15,
  'three public members receive one row for each of the five solved platforms'
);

select ok(
  not exists (
    select 1
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id = '00000000-0000-0000-0000-000000002903'
  ),
  'non-public profiles are absent from the increment ranking'
);

select is(
  (
    select solved_delta
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id = '00000000-0000-0000-0000-000000002901'
      and platform = 'codeforces'
  ),
  12,
  'a complete interval subtracts the latest pre-range baseline from the latest in-range count'
);

select is(
  (
    select end_solved_count
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id = '00000000-0000-0000-0000-000000002901'
      and platform = 'codeforces'
  ),
  112,
  'failed observations and snapshots after the inclusive end date are ignored'
);

select is(
  (
    select baseline_recorded_at
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id = '00000000-0000-0000-0000-000000002901'
      and platform = 'codeforces'
  ),
  '2026-07-09 10:00+08'::timestamptz,
  'the baseline is the last successful snapshot strictly before the Beijing start date'
);

select is(
  (
    select coverage_status
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id = '00000000-0000-0000-0000-000000002901'
      and platform = 'nowcoder'
  ),
  'count_decreased',
  'a cumulative-count correction is exposed explicitly'
);

select is(
  (
    select solved_delta
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id = '00000000-0000-0000-0000-000000002901'
      and platform = 'nowcoder'
  ),
  0,
  'a cumulative-count decrease contributes zero rather than a negative gain'
);

select ok(
  (
    select coverage_status = 'missing_baseline' and solved_delta is null
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id = '00000000-0000-0000-0000-000000002901'
      and platform = 'atcoder'
  ),
  'an in-range observation is not misused as a missing pre-range baseline'
);

select is(
  (
    select coverage_status
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id = '00000000-0000-0000-0000-000000002901'
      and platform = 'luogu'
  ),
  'missing_end',
  'a baseline without an in-range successful observation remains incomplete'
);

select is(
  (
    select coverage_status
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id = '00000000-0000-0000-0000-000000002901'
      and platform = 'qoj'
  ),
  'unbound',
  'an unbound platform is distinguished from incomplete snapshot coverage'
);

select ok(
  (
    select coverage_status = 'missing_baseline'
      and baseline_solved_count is null
      and end_solved_count = 210
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id = '00000000-0000-0000-0000-000000002902'
      and platform = 'codeforces'
  ),
  'snapshots recorded before the current account binding are not used as a baseline'
);

select is(
  (
    select count(*)::integer
    from public.get_public_practice_increments('2026-07-10', '2026-07-16')
    where profile_id = '00000000-0000-0000-0000-000000002904'
      and coverage_status = 'unbound'
  ),
  5,
  'a public member with no bindings receives five explicit unbound rows'
);

select throws_ok(
  $$ select * from public.get_public_practice_increments(null::date, date '2026-07-16') $$,
  '22004',
  'Practice ranking start and end dates are required.',
  'both dates are required'
);

select throws_ok(
  $$ select * from public.get_public_practice_increments('-infinity'::date, date '2026-07-16') $$,
  '22023',
  'Practice ranking dates must be finite.',
  'infinite calendar bounds are rejected'
);

select throws_ok(
  $$ select * from public.get_public_practice_increments(date '2026-07-17', date '2026-07-16') $$,
  '22023',
  'Practice ranking start date must not be after the end date.',
  'reversed ranges are rejected'
);

select throws_ok(
  $$
    select *
    from public.get_public_practice_increments(
      (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 366,
      (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
    )
  $$,
  '22023',
  'Practice ranking ranges may include at most 366 days.',
  'unbounded historical ranges are rejected'
);

select throws_ok(
  $$
    select *
    from public.get_public_practice_increments(
      (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date,
      (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 1
    )
  $$,
  '22023',
  'Practice ranking end date must not be in the future.',
  'future Beijing dates are rejected'
);

reset role;

select * from finish();
rollback;
