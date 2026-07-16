begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000e1',
  'authenticated',
  'authenticated',
  'atomic-persistence-member@example.test',
  'test-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Atomic Persistence Member"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

update public.profiles
set
  review_status = 'approved',
  approved_at = now(),
  grade = '24级',
  major = '计算机科学与技术'
where id = '00000000-0000-0000-0000-0000000000e1';

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status, verified_at
)
values
  ('00000000-0000-0000-0000-0000000000e1', 'atcoder', 'atomic_member', 'atomic_member', 'verified', now()),
  ('00000000-0000-0000-0000-0000000000e1', 'nowcoder', '12345', '12345', 'verified', now()),
  ('00000000-0000-0000-0000-0000000000e1', 'codeforces', 'AtomicMember', 'atomicmember', 'verified', now());

update public.platform_accounts
set
  external_id = 'xcpc_1234567890abcdef',
  normalized_external_id = 'xcpc_1234567890abcdef',
  status = 'verified',
  verified_at = now()
where profile_id = '00000000-0000-0000-0000-0000000000e1'
  and platform = 'xcpc_elo';

insert into public.sync_jobs (
  id, scope, profile_id, platform, status, trigger_type,
  attempt_count, max_attempts, started_at, payload
)
overriding system value
values
  (99601, 'account', '00000000-0000-0000-0000-0000000000e1', 'atcoder', 'running', 'scheduled', 1, 3, '2026-07-16T00:00:00Z', '{"platforms":["atcoder"]}'::jsonb),
  (99602, 'account', '00000000-0000-0000-0000-0000000000e1', 'atcoder', 'running', 'scheduled', 1, 3, '2026-07-16T00:01:00Z', '{"platforms":["atcoder"]}'::jsonb),
  (99603, 'account', '00000000-0000-0000-0000-0000000000e1', 'atcoder', 'running', 'scheduled', 1, 3, '2026-07-16T00:02:00Z', '{"platforms":["atcoder"]}'::jsonb),
  (99604, 'account', '00000000-0000-0000-0000-0000000000e1', 'nowcoder', 'running', 'scheduled', 1, 3, '2026-07-16T00:03:00Z', '{"platforms":["nowcoder"]}'::jsonb),
  (99605, 'account', '00000000-0000-0000-0000-0000000000e1', 'codeforces', 'running', 'scheduled', 1, 3, '2026-07-16T00:04:00Z', '{"platforms":["codeforces"]}'::jsonb),
  (99606, 'account', '00000000-0000-0000-0000-0000000000e1', 'xcpc_elo', 'running', 'scheduled', 1, 3, '2026-07-16T00:05:00Z', '{"platforms":["xcpc_elo"]}'::jsonb),
  (99607, 'account', '00000000-0000-0000-0000-0000000000e1', 'atcoder', 'running', 'scheduled', 1, 3, '2026-07-16T00:06:00Z', '{"platforms":["atcoder"]}'::jsonb);

insert into public.sync_runs (
  id, job_id, profile_id, platform, platform_account_id,
  attempt, status, started_at, finished_at
)
overriding system value
select
  run_id,
  job_id,
  '00000000-0000-0000-0000-0000000000e1'::uuid,
  platform,
  (
    select id
    from public.platform_accounts
    where profile_id = '00000000-0000-0000-0000-0000000000e1'
      and platform = source.platform
  ),
  1,
  run_status::public.sync_run_status,
  started_at,
  case when run_status = 'running' then null else started_at end
from (
  values
    (99611::bigint, 99601::bigint, 'atcoder'::public.platform_name, 'running'::text, '2026-07-16T00:00:00Z'::timestamptz),
    (99612::bigint, 99602::bigint, 'atcoder'::public.platform_name, 'running'::text, '2026-07-16T00:01:00Z'::timestamptz),
    (99613::bigint, 99603::bigint, 'atcoder'::public.platform_name, 'running'::text, '2026-07-16T00:02:00Z'::timestamptz),
    (99614::bigint, 99604::bigint, 'nowcoder'::public.platform_name, 'running'::text, '2026-07-16T00:03:00Z'::timestamptz),
    (99615::bigint, 99605::bigint, 'codeforces'::public.platform_name, 'skipped'::text, '2026-07-16T00:04:00Z'::timestamptz),
    (99616::bigint, 99606::bigint, 'xcpc_elo'::public.platform_name, 'running'::text, '2026-07-16T00:05:00Z'::timestamptz),
    (99617::bigint, 99607::bigint, 'atcoder'::public.platform_name, 'running'::text, '2026-07-16T00:06:00Z'::timestamptz)
) as source(run_id, job_id, platform, run_status, started_at);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.commit_platform_sync_result(bigint,text,bigint,bigint,boolean,numeric,numeric,integer,public.stat_freshness_status,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.sync_error_code,text,text,timestamp with time zone,integer,jsonb)',
    'EXECUTE'
  ),
  'authenticated users cannot execute the atomic persistence RPC'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.commit_platform_sync_result(bigint,text,bigint,bigint,boolean,numeric,numeric,integer,public.stat_freshness_status,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.sync_error_code,text,text,timestamp with time zone,integer,jsonb)',
    'EXECUTE'
  ),
  'the service role can execute the atomic persistence RPC'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select throws_ok(
  $$
    select public.commit_platform_sync_result(
      (select id from public.platform_accounts where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'atcoder'),
      'atomic_member', 99601, 99611, true, 1500, 1600, 100, 'fresh',
      '2026-07-16T00:00:00Z', '2026-07-16T00:00:01Z', '2026-07-16T00:00:01Z',
      '2026-07-16T13:00:00Z', null, null, 'atcoder:test-v1',
      '2026-07-16T00:00:01Z', 1000, '{"currentRating":1500}'::jsonb
    )
  $$,
  '42501',
  'service_role is required',
  'the function also verifies the JWT role internally'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $$
    select public.commit_platform_sync_result(
      (select id from public.platform_accounts where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'atcoder'),
      'atomic_member', 99601, 99611, true, 1500, 1600, 100, 'fresh',
      '2026-07-16T00:00:00Z', '2026-07-16T00:00:01Z', '2026-07-16T00:00:01Z',
      '2026-07-16T13:00:00Z', null, null, 'atcoder:test-v1',
      '2026-07-16T00:00:01Z', 1000, '{"currentRating":1500,"maxRating":1600,"solvedCount":100}'::jsonb
    )
  $$,
  'a successful non-Luogu result commits atomically'
);

select results_eq(
  $$
    select current_rating, max_rating, solved_count, status::text,
      source_observed_at, last_success_at, error_code::text, source_version
    from public.platform_stats
    where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'atcoder'
  $$,
  $$
    values (
      1500.00::numeric, 1600.00::numeric, 100, 'fresh'::text,
      '2026-07-16T00:00:00Z'::timestamptz, '2026-07-16T00:00:01Z'::timestamptz,
      null::text, 'atcoder:test-v1'::text
    )
  $$,
  'successful metrics and source metadata reach platform_stats'
);

select results_eq(
  $$ select id, status::text, source_version from public.sync_runs where id = 99611 $$,
  $$ values (99611::bigint, 'succeeded'::text, 'atcoder:test-v1'::text) $$,
  'the successful run reaches its terminal state in the same transaction'
);

select lives_ok(
  $$
    select public.commit_platform_sync_result(
      (select id from public.platform_accounts where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'atcoder'),
      'atomic_member', 99602, 99612, true, 1500, 1600, 100, 'fresh',
      '2026-07-16T00:00:00Z', '2026-07-16T00:01:01Z', '2026-07-16T00:01:01Z',
      '2026-07-16T13:00:00Z', null, null, 'atcoder:test-v1',
      '2026-07-16T00:01:01Z', 1000, '{"currentRating":1500}'::jsonb
    )
  $$,
  'repeating one upstream observation still completes the second run'
);

select is(
  (
    select count(*)::integer from public.stat_snapshots
    where profile_id = '00000000-0000-0000-0000-0000000000e1'
      and platform = 'atcoder'
      and source_observed_at = '2026-07-16T00:00:00Z'
  ),
  1,
  'the same successful source observation creates only one snapshot'
);

select is(
  (select status::text from public.sync_runs where id = 99612),
  'succeeded',
  'the idempotent second run is not left running'
);

select lives_ok(
  $$
    select public.commit_platform_sync_result(
      (select id from public.platform_accounts where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'atcoder'),
      'atomic_member', 99603, 99613, false, 1500, 1600, 100, 'fresh',
      '2026-07-16T00:00:00Z', '2026-07-16T00:02:01Z', '2026-07-16T00:01:01Z',
      '2026-07-16T13:00:00Z', 'rate_limited', 'AtCoder rate limited the request.',
      'atcoder:test-v1', '2026-07-16T00:02:01Z', 1000,
      '{"diagnostics":{"status":429}}'::jsonb
    )
  $$,
  'a failed result commits retained statistics and diagnostics atomically'
);

select results_eq(
  $$
    select current_rating, max_rating, solved_count, source_observed_at,
      last_success_at, error_code::text, source_version
    from public.platform_stats
    where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'atcoder'
  $$,
  $$
    values (
      1500.00::numeric, 1600.00::numeric, 100,
      '2026-07-16T00:00:00Z'::timestamptz, '2026-07-16T00:01:01Z'::timestamptz,
      'rate_limited'::text, 'atcoder:test-v1'::text
    )
  $$,
  'a failure keeps every last-success field while recording the new error'
);

select ok(
  exists (
    select 1 from public.stat_snapshots
    where sync_run_id = 99613 and source_observed_at is null and current_rating = 1500
  ),
  'a failure snapshot is auditable without claiming a new source observation'
);

select lives_ok(
  $$
    select public.commit_platform_sync_result(
      (select id from public.platform_accounts where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'nowcoder'),
      '12345', 99604, 99614, false, null, null, null, 'unavailable',
      null, '2026-07-16T00:03:01Z', null, null, 'not_found', 'Nowcoder account was not found.',
      null, '2026-07-16T00:03:01Z', 1000, null
    )
  $$,
  'a first synchronization failure commits an unavailable state'
);

select results_eq(
  $$
    select current_rating, max_rating, solved_count, status::text,
      source_observed_at, last_success_at, source_version
    from public.platform_stats
    where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'nowcoder'
  $$,
  $$ values (null::numeric, null::numeric, null::integer, 'unavailable'::text, null::timestamptz, null::timestamptz, null::text) $$,
  'a first failure stores nulls rather than inventing zero metrics'
);

select throws_ok(
  $$
    select public.commit_platform_sync_result(
      (select id from public.platform_accounts where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'codeforces'),
      'AtomicMember', 99605, 99615, true, 1800, 1900, 200, 'fresh',
      '2026-07-16T00:04:00Z', '2026-07-16T00:04:01Z', '2026-07-16T00:04:01Z',
      '2026-07-16T13:00:00Z', null, null, 'codeforces:test-v1',
      '2026-07-16T00:04:01Z', 1000, '{"currentRating":1800}'::jsonb
    )
  $$,
  '40001',
  'Synchronization run is no longer writable',
  'a run that already left running state rejects the entire commit'
);

select ok(
  not exists (
    select 1 from public.platform_stats
    where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'codeforces'
  ),
  'a rejected terminal run leaves platform_stats unchanged'
);

select ok(
  not exists (select 1 from public.stat_snapshots where sync_run_id = 99615),
  'a rejected terminal run leaves no public snapshot'
);

select lives_ok(
  $$
    select public.commit_platform_sync_result(
      (select id from public.platform_accounts where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'xcpc_elo'),
      'xcpc_1234567890abcdef', 99606, 99616, true, 1723.5, 1801.25, null, 'fresh',
      '2026-07-16T00:05:00Z', '2026-07-16T00:05:01Z', '2026-07-16T00:05:01Z',
      '2026-07-22T00:00:00Z', null, null, 'xcpc-elo:test-v1',
      '2026-07-16T00:05:01Z', 1000, '{"currentRating":1723.5,"maxRating":1801.25}'::jsonb
    )
  $$,
  'XCPC ELO decimal ratings commit without implicit rounding'
);

select results_eq(
  $$
    select current_rating, max_rating from public.platform_stats
    where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'xcpc_elo'
  $$,
  $$ values (1723.50::numeric, 1801.25::numeric) $$,
  'current XCPC ELO ratings preserve their decimal precision'
);

select results_eq(
  $$ select current_rating, max_rating from public.stat_snapshots where sync_run_id = 99616 $$,
  $$ values (1723.50::numeric, 1801.25::numeric) $$,
  'historical XCPC ELO snapshots preserve their decimal precision'
);

update public.profiles
set review_status = 'suspended'
where id = '00000000-0000-0000-0000-0000000000e1';

select throws_ok(
  $$
    select public.commit_platform_sync_result(
      (select id from public.platform_accounts where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'atcoder'),
      'atomic_member', 99607, 99617, true, 9999, 9999, 9999, 'fresh',
      '2026-07-16T00:06:00Z', '2026-07-16T00:06:01Z', '2026-07-16T00:06:01Z',
      '2026-07-16T13:00:00Z', null, null, 'atcoder:test-v2',
      '2026-07-16T00:06:01Z', 1000, '{"currentRating":9999}'::jsonb
    )
  $$,
  '40001',
  'Member synchronization is no longer allowed',
  'a suspended member rejects an in-flight non-Luogu commit'
);

select is(
  (select current_rating from public.platform_stats where profile_id = '00000000-0000-0000-0000-0000000000e1' and platform = 'atcoder'),
  1500.00::numeric,
  'the rejected suspended-member commit preserves previous statistics'
);

select ok(
  not exists (select 1 from public.stat_snapshots where sync_run_id = 99617),
  'the rejected suspended-member commit creates no snapshot'
);

select is(
  (select status::text from public.sync_runs where id = 99617),
  'running',
  'the rejected suspended-member commit rolls back its run mutation'
);

select col_type_is('public', 'platform_stats', 'current_rating', 'numeric(12,2)', 'platform_stats ratings preserve two decimal places');
select col_type_is('public', 'stat_snapshots', 'max_rating', 'numeric(12,2)', 'snapshot ratings preserve two decimal places');
select col_type_is('public', 'xcpc_elo_cache_players', 'rating', 'numeric(12,2)', 'XCPC cache ratings preserve two decimal places');

select * from finish();

rollback;
