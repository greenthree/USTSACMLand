begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000ac',
  'authenticated',
  'authenticated',
  'luogu-idempotency-member@example.test',
  'test-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Luogu Idempotency Member"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status, verified_at
)
values (
  '00000000-0000-0000-0000-0000000000ac',
  'luogu',
  '409073',
  '409073',
  'verified',
  now()
);

insert into public.sync_jobs (
  id, scope, profile_id, platform, status, trigger_type,
  attempt_count, max_attempts, started_at, payload
)
overriding system value
values
  (
    99501, 'account', '00000000-0000-0000-0000-0000000000ac', 'luogu',
    'running', 'scheduled', 1, 3, '2026-07-14T23:57:00Z',
    '{"platforms":["luogu"]}'::jsonb
  ),
  (
    99502, 'account', '00000000-0000-0000-0000-0000000000ac', 'luogu',
    'running', 'scheduled', 1, 3, '2026-07-14T23:58:00Z',
    '{"platforms":["luogu"]}'::jsonb
  ),
  (
    99503, 'account', '00000000-0000-0000-0000-0000000000ac', 'luogu',
    'running', 'scheduled', 1, 3, '2026-07-14T23:59:00Z',
    '{"platforms":["luogu"]}'::jsonb
  ),
  (
    99504, 'account', '00000000-0000-0000-0000-0000000000ac', 'luogu',
    'running', 'scheduled', 1, 3, '2026-07-15T00:00:00Z',
    '{"platforms":["luogu"]}'::jsonb
  );

insert into public.sync_runs (
  id, job_id, profile_id, platform, platform_account_id,
  attempt, status, started_at
)
overriding system value
values
  (
    99511,
    99501,
    '00000000-0000-0000-0000-0000000000ac',
    'luogu',
    (
      select id from public.platform_accounts
      where profile_id = '00000000-0000-0000-0000-0000000000ac'
        and platform = 'luogu'
    ),
    1,
    'running',
    '2026-07-14T23:57:00Z'
  ),
  (
    99512,
    99502,
    '00000000-0000-0000-0000-0000000000ac',
    'luogu',
    (
      select id from public.platform_accounts
      where profile_id = '00000000-0000-0000-0000-0000000000ac'
        and platform = 'luogu'
    ),
    1,
    'running',
    '2026-07-14T23:58:00Z'
  ),
  (
    99513,
    99503,
    '00000000-0000-0000-0000-0000000000ac',
    'luogu',
    (
      select id from public.platform_accounts
      where profile_id = '00000000-0000-0000-0000-0000000000ac'
        and platform = 'luogu'
    ),
    1,
    'running',
    '2026-07-14T23:59:00Z'
  ),
  (
    99514,
    99504,
    '00000000-0000-0000-0000-0000000000ac',
    'luogu',
    (
      select id from public.platform_accounts
      where profile_id = '00000000-0000-0000-0000-0000000000ac'
        and platform = 'luogu'
    ),
    1,
    'running',
    '2026-07-15T00:00:00Z'
  );

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

select is(
  public.commit_luogu_sync_result(
    (
      select id from public.platform_accounts
      where profile_id = '00000000-0000-0000-0000-0000000000ac'
        and platform = 'luogu'
    ),
    '409073',
    0,
    99501,
    99511,
    true,
    null,
    null,
    42,
    'fresh',
    '2026-07-15T00:00:00Z',
    '2026-07-15T00:01:00Z',
    '2026-07-15T00:01:00Z',
    '2026-07-16T00:01:00Z',
    null,
    null,
    'luogu-records:test-v1',
    '2026-07-15T00:01:00Z',
    1000,
    '{"solvedCount":42}'::jsonb,
    '1001',
    1000,
    42,
    array['P1000', 'B2000'],
    '2026-07-15T00:01:00Z'
  ),
  1::bigint,
  'the first successful synchronization creates checkpoint version one'
);

select is(
  public.commit_luogu_sync_result(
    (
      select id from public.platform_accounts
      where profile_id = '00000000-0000-0000-0000-0000000000ac'
        and platform = 'luogu'
    ),
    '409073',
    1,
    99502,
    99512,
    true,
    null,
    null,
    42,
    'fresh',
    '2026-07-15T00:00:00Z',
    '2026-07-15T00:02:00Z',
    '2026-07-15T00:02:00Z',
    '2026-07-16T00:02:00Z',
    null,
    null,
    'luogu-records:test-v1',
    '2026-07-15T00:02:00Z',
    900,
    '{"solvedCount":42}'::jsonb,
    '1001',
    1000,
    42,
    array['P1000', 'B2000'],
    '2026-07-15T00:02:00Z'
  ),
  2::bigint,
  'a repeated successful source observation still advances the checkpoint'
);

select is(
  (
    select count(*)::integer
    from public.stat_snapshots
    where profile_id = '00000000-0000-0000-0000-0000000000ac'
      and platform = 'luogu'
      and source_observed_at = '2026-07-15T00:00:00Z'
  ),
  1,
  'repeating one successful source observation creates only one snapshot'
);

select is(
  public.commit_luogu_sync_result(
    (
      select id from public.platform_accounts
      where profile_id = '00000000-0000-0000-0000-0000000000ac'
        and platform = 'luogu'
    ),
    '409073',
    2,
    99503,
    99513,
    false,
    null,
    null,
    42,
    'fresh',
    '2026-07-15T00:00:00Z',
    '2026-07-15T00:03:00Z',
    '2026-07-15T00:02:00Z',
    '2026-07-16T00:02:00Z',
    'timeout',
    'Luogu request timed out.',
    'luogu-records:test-v1',
    '2026-07-15T00:03:00Z',
    1000,
    '{"diagnostics":{"kind":"timeout"}}'::jsonb,
    null,
    null,
    null,
    null,
    null
  ),
  2::bigint,
  'a failed synchronization preserves checkpoint version two'
);

select is(
  (
    select state_version
    from public.luogu_sync_states
    where platform_account_id = (
      select id from public.platform_accounts
      where profile_id = '00000000-0000-0000-0000-0000000000ac'
        and platform = 'luogu'
    )
  ),
  2::bigint,
  'a failed synchronization does not mutate the incremental checkpoint'
);

select results_eq(
  $$
    select solved_count, status::text, source_observed_at, last_success_at,
      error_code::text, source_version
    from public.platform_stats
    where profile_id = '00000000-0000-0000-0000-0000000000ac'
      and platform = 'luogu'
  $$,
  $$
    values (
      42,
      'fresh'::text,
      '2026-07-15T00:00:00Z'::timestamptz,
      '2026-07-15T00:02:00Z'::timestamptz,
      'timeout'::text,
      'luogu-records:test-v1'::text
    )
  $$,
  'a failed synchronization retains the last successful current statistics'
);

select is(
  (
    select count(*)::integer
    from public.stat_snapshots
    where profile_id = '00000000-0000-0000-0000-0000000000ac'
      and platform = 'luogu'
  ),
  2,
  'the sequence stores one successful observation and one failure snapshot'
);

select ok(
  exists (
    select 1
    from public.stat_snapshots
    where sync_run_id = 99513
      and source_observed_at is null
  ),
  'the failure snapshot does not claim a successful source observation time'
);

select results_eq(
  $$
    select sync_run_id, source_observed_at is null as source_is_null
    from public.stat_snapshots
    where profile_id = '00000000-0000-0000-0000-0000000000ac'
      and platform = 'luogu'
    order by sync_run_id
  $$,
  $$ values (99511::bigint, false), (99513::bigint, true) $$,
  'the repeated successful run has no duplicate snapshot while the failure remains auditable'
);

select results_eq(
  $$
    select id, status::text
    from public.sync_runs
    where id in (99511, 99512, 99513)
    order by id
  $$,
  $$
    values
      (99511::bigint, 'succeeded'::text),
      (99512::bigint, 'succeeded'::text),
      (99513::bigint, 'failed'::text)
  $$,
  'all three synchronization runs reach their expected terminal state'
);

update public.profiles
set review_status = 'suspended'
where id = '00000000-0000-0000-0000-0000000000ac';

select throws_ok(
  $$
    select public.commit_luogu_sync_result(
      (
        select id from public.platform_accounts
        where profile_id = '00000000-0000-0000-0000-0000000000ac'
          and platform = 'luogu'
      ),
      '409073', 2, 99504, 99514, true, null, null, 9999, 'fresh',
      '2026-07-15T00:04:00Z', '2026-07-15T00:04:01Z', '2026-07-15T00:04:01Z',
      '2026-07-16T00:04:01Z', null, null, 'luogu-records:test-v2',
      '2026-07-15T00:04:01Z', 1000, '{"solvedCount":9999}'::jsonb,
      '2000', 2000, 9999, array['P9999'], '2026-07-15T00:04:01Z'
    )
  $$,
  '40001',
  'Member synchronization is no longer allowed',
  'a suspended member rejects an in-flight Luogu commit'
);

select is(
  (
    select state_version from public.luogu_sync_states
    where platform_account_id = (
      select id from public.platform_accounts
      where profile_id = '00000000-0000-0000-0000-0000000000ac'
        and platform = 'luogu'
    )
  ),
  2::bigint,
  'the rejected suspended-member commit preserves the Luogu checkpoint'
);

select ok(
  not exists (select 1 from public.stat_snapshots where sync_run_id = 99514),
  'the rejected suspended-member Luogu commit creates no snapshot'
);

select is(
  (select solved_count from public.platform_stats where profile_id = '00000000-0000-0000-0000-0000000000ac' and platform = 'luogu'),
  42,
  'the rejected suspended-member Luogu commit preserves previous statistics'
);

select is(
  (select status::text from public.sync_runs where id = 99514),
  'running',
  'the rejected suspended-member Luogu commit rolls back its run mutation'
);

select * from finish();

rollback;
