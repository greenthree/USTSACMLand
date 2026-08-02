begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000004901',
    'authenticated', 'authenticated', 'rating-change-main@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Rating Change Main"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000004902',
    'authenticated', 'authenticated', 'rating-change-hidden@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Rating Change Hidden"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000004903',
    'authenticated', 'authenticated', 'rating-change-unbound@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Rating Change Unbound"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-000000004901' then 'Rating Change Main'
    when '00000000-0000-0000-0000-000000004902' then 'Rating Change Hidden'
    else 'Rating Change Unbound'
  end,
  qq = case id
    when '00000000-0000-0000-0000-000000004901' then '14900000001'
    when '00000000-0000-0000-0000-000000004902' then '14900000002'
    else '14900000003'
  end,
  grade = '24级',
  major = '计算机科学与技术',
  review_status = 'approved',
  approved_at = now(),
  is_public = id <> '00000000-0000-0000-0000-000000004902'
where id in (
  '00000000-0000-0000-0000-000000004901',
  '00000000-0000-0000-0000-000000004902',
  '00000000-0000-0000-0000-000000004903'
);

insert into public.platform_accounts (
  id, profile_id, platform, external_id, normalized_external_id, status,
  verified_at, created_at, updated_at
)
overriding system value
values
  (49011, '00000000-0000-0000-0000-000000004901', 'codeforces', 'RatingChangeMain',
    'ratingchangemain', 'verified', '2026-07-10 00:00+08', '2026-07-01 00:00+08', '2026-07-10 00:00+08'),
  (49012, '00000000-0000-0000-0000-000000004901', 'nowcoder', '4901201',
    '4901201', 'verified', '2026-07-10 00:00+08', '2026-07-01 00:00+08', '2026-07-10 00:00+08'),
  (49021, '00000000-0000-0000-0000-000000004902', 'codeforces', 'RatingChangeHidden',
    'ratingchangehidden', 'verified', '2026-07-10 00:00+08', '2026-07-01 00:00+08', '2026-07-10 00:00+08');

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
    (49201::bigint, '00000000-0000-0000-0000-000000004901'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (49202, '00000000-0000-0000-0000-000000004901'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-11 10:00+08'::timestamptz),
    (49203, '00000000-0000-0000-0000-000000004901'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-12 10:00+08'::timestamptz),
    (49208, '00000000-0000-0000-0000-000000004901'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-13 10:00+08'::timestamptz),
    (49204, '00000000-0000-0000-0000-000000004901'::uuid, 'codeforces'::public.platform_name, 'failed'::public.sync_run_status, '2026-07-14 10:00+08'::timestamptz),
    (49205, '00000000-0000-0000-0000-000000004901'::uuid, 'nowcoder'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-12 11:00+08'::timestamptz),
    (49206, '00000000-0000-0000-0000-000000004902'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-11 10:00+08'::timestamptz),
    (49207, '00000000-0000-0000-0000-000000004902'::uuid, 'codeforces'::public.platform_name, 'succeeded'::public.sync_run_status, '2026-07-12 10:00+08'::timestamptz)
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
    (49201::bigint, '00000000-0000-0000-0000-000000004901'::uuid, 'codeforces'::public.platform_name, 49011::bigint, 'succeeded'::public.sync_run_status, '2026-07-09 10:00+08'::timestamptz),
    (49202, '00000000-0000-0000-0000-000000004901'::uuid, 'codeforces'::public.platform_name, 49011::bigint, 'succeeded'::public.sync_run_status, '2026-07-11 10:00+08'::timestamptz),
    (49203, '00000000-0000-0000-0000-000000004901'::uuid, 'codeforces'::public.platform_name, 49011::bigint, 'succeeded'::public.sync_run_status, '2026-07-12 10:00+08'::timestamptz),
    (49208, '00000000-0000-0000-0000-000000004901'::uuid, 'codeforces'::public.platform_name, 49011::bigint, 'succeeded'::public.sync_run_status, '2026-07-13 10:00+08'::timestamptz),
    (49204, '00000000-0000-0000-0000-000000004901'::uuid, 'codeforces'::public.platform_name, 49011::bigint, 'failed'::public.sync_run_status, '2026-07-14 10:00+08'::timestamptz),
    (49205, '00000000-0000-0000-0000-000000004901'::uuid, 'nowcoder'::public.platform_name, 49012::bigint, 'succeeded'::public.sync_run_status, '2026-07-12 11:00+08'::timestamptz),
    (49206, '00000000-0000-0000-0000-000000004902'::uuid, 'codeforces'::public.platform_name, 49021::bigint, 'succeeded'::public.sync_run_status, '2026-07-11 10:00+08'::timestamptz),
    (49207, '00000000-0000-0000-0000-000000004902'::uuid, 'codeforces'::public.platform_name, 49021::bigint, 'succeeded'::public.sync_run_status, '2026-07-12 10:00+08'::timestamptz)
) as fixture(run_id, profile_id, platform, account_id, run_status, recorded_at);

insert into public.stat_snapshots (
  profile_id, platform, sync_run_id, current_rating, max_rating, status, recorded_at
)
values
  ('00000000-0000-0000-0000-000000004901', 'codeforces', 49201, 1200, 1200, 'fresh', '2026-07-09 10:00+08'),
  ('00000000-0000-0000-0000-000000004901', 'codeforces', 49202, 1275, 1275, 'fresh', '2026-07-11 10:00+08'),
  ('00000000-0000-0000-0000-000000004901', 'codeforces', 49203, 1325, 1325, 'fresh', '2026-07-12 10:00+08'),
  ('00000000-0000-0000-0000-000000004901', 'codeforces', 49208, 1325, 1325, 'fresh', '2026-07-13 10:00+08'),
  ('00000000-0000-0000-0000-000000004901', 'codeforces', 49204, 1900, 1900, 'stale', '2026-07-14 10:00+08'),
  ('00000000-0000-0000-0000-000000004901', 'nowcoder', 49205, 1500, 1500, 'fresh', '2026-07-12 11:00+08'),
  ('00000000-0000-0000-0000-000000004902', 'codeforces', 49206, 2100, 2100, 'fresh', '2026-07-11 10:00+08'),
  ('00000000-0000-0000-0000-000000004902', 'codeforces', 49207, 2200, 2200, 'fresh', '2026-07-12 10:00+08');

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'stat_snapshots'
      and indexname = 'stat_snapshots_rating_change_idx'
      and indexdef like '%INCLUDE (current_rating, sync_run_id)%'
  ),
  1,
  'latest Rating lookups have a covering index'
);

select ok(
  pg_catalog.has_function_privilege('anon', 'public.get_public_rating_changes()', 'EXECUTE')
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.get_public_rating_changes()', 'EXECUTE'
    ),
  'anonymous and authenticated visitors can read sanitized Rating changes'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'get_public_rating_changes'
      and procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
  ),
  'the public Rating change function is SECURITY DEFINER with a pinned search path'
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
  (select count(*)::integer from public.get_public_rating_changes()),
  8,
  'two visible members receive one row for each Rating platform'
);

select is(
  (select count(distinct platform)::integer from public.get_public_rating_changes()),
  4,
  'only the four Rating platforms are returned'
);

select ok(
  not exists (
    select 1
    from public.get_public_rating_changes()
    where profile_id = '00000000-0000-0000-0000-000000004902'
  ),
  'non-public profiles are absent'
);

select is(
  (
    select current_rating
    from public.get_public_rating_changes()
    where profile_id = '00000000-0000-0000-0000-000000004901'
      and platform = 'codeforces'
  ),
  1325.00::numeric,
  'the latest successful Rating is returned and the later failed run is ignored'
);

select is(
  (
    select previous_rating
    from public.get_public_rating_changes()
    where profile_id = '00000000-0000-0000-0000-000000004901'
      and platform = 'codeforces'
  ),
  1275.00::numeric,
  'the previous Rating skips repeated values and snapshots from an earlier account binding'
);

select ok(
  (
    select current_recorded_at = '2026-07-13 10:00+08'::timestamptz
      and previous_recorded_at = '2026-07-11 10:00+08'::timestamptz
    from public.get_public_rating_changes()
    where profile_id = '00000000-0000-0000-0000-000000004901'
      and platform = 'codeforces'
  ),
  'the latest and previous distinct observation timestamps remain paired with their Ratings'
);

select is(
  (
    select current_rating - previous_rating
    from public.get_public_rating_changes()
    where profile_id = '00000000-0000-0000-0000-000000004901'
      and platform = 'codeforces'
  ),
  50.00::numeric,
  'the returned pair yields the latest Rating change'
);

select ok(
  (
    select current_rating = 1500 and previous_rating is null
    from public.get_public_rating_changes()
    where profile_id = '00000000-0000-0000-0000-000000004901'
      and platform = 'nowcoder'
  ),
  'a single successful snapshot does not invent a previous Rating'
);

select is(
  (
    select count(*)::integer
    from public.get_public_rating_changes()
    where profile_id = '00000000-0000-0000-0000-000000004903'
      and current_rating is null
      and previous_rating is null
  ),
  4,
  'an unbound public member receives four explicit unavailable rows'
);

reset role;

select * from finish();
rollback;
