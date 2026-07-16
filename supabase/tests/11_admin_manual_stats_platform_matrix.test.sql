begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select is(
  pg_catalog.to_regprocedure(
    'public.admin_set_manual_platform_stats(uuid,public.platform_name,integer,integer,integer,timestamp with time zone,text,timestamp with time zone)'
  )::text,
  null::text,
  'the legacy integer Rating overload is removed'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.admin_set_manual_platform_stats(uuid,public.platform_name,numeric,numeric,integer,timestamp with time zone,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'authenticated administrators can call the rate-limited numeric wrapper'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.admin_set_manual_platform_stats_unlimited(uuid,public.platform_name,numeric,numeric,integer,timestamp with time zone,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'authenticated users cannot bypass the manual-statistics rate limit'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000ab',
    'authenticated', 'authenticated', 'manual-stats-member@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Manual Stats Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000bb',
    'authenticated', 'authenticated', 'manual-stats-admin@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Manual Stats Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-0000000000ab' then 'Manual Stats Member'
    else 'Manual Stats Administrator'
  end,
  role = case
    when id = '00000000-0000-0000-0000-0000000000bb' then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  approved_at = now()
where id in (
  '00000000-0000-0000-0000-0000000000ab',
  '00000000-0000-0000-0000-0000000000bb'
);

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status, verified_at
)
values
  (
    '00000000-0000-0000-0000-0000000000ab',
    'atcoder',
    'manual_stats_member',
    'manual_stats_member',
    'verified',
    now()
  ),
  (
    '00000000-0000-0000-0000-0000000000ab',
    'luogu',
    '409073',
    '409073',
    'verified',
    now()
  ),
  (
    '00000000-0000-0000-0000-0000000000ab',
    'qoj',
    'manual-stats-member',
    'manual-stats-member',
    'verified',
    now()
  )
on conflict (profile_id, platform) do update
set
  status = 'verified',
  verified_at = now();

update public.platform_accounts
set status = 'verified', verified_at = now()
where profile_id = '00000000-0000-0000-0000-0000000000ab'
  and platform = 'xcpc_elo';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select *
    from public.admin_set_manual_platform_stats(
      '00000000-0000-0000-0000-0000000000ab',
      'atcoder',
      1450,
      1525,
      321,
      pg_catalog.clock_timestamp() - interval '1 hour',
      'AtCoder Rating and solved-count correction',
      null
    )
  $$,
  'AtCoder accepts Rating and solved count in one manual entry'
);

reset role;

select results_eq(
  $$
    select current_rating, max_rating, solved_count, source_version
    from public.platform_stats
    where profile_id = '00000000-0000-0000-0000-0000000000ab'
      and platform = 'atcoder'
  $$,
  $$ values (1450::numeric, 1525::numeric, 321, 'admin-manual/v1'::text) $$,
  'AtCoder manual statistics persist both metric families'
);

select is(
  (
    select count(*)::integer
    from public.stat_snapshots
    where profile_id = '00000000-0000-0000-0000-0000000000ab'
      and platform = 'atcoder'
      and current_rating = 1450
      and max_rating = 1525
      and solved_count = 321
      and status = 'fresh'
  ),
  1,
  'AtCoder manual entry records one fresh snapshot with Rating and solved count'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where actor_id = '00000000-0000-0000-0000-0000000000bb'
      and action = 'manual_stats_updated'
      and metadata ->> 'profile_id' = '00000000-0000-0000-0000-0000000000ab'
      and metadata ->> 'platform' = 'atcoder'
  ),
  1,
  'AtCoder manual entry is audited against the administrator identity'
);

set local role authenticated;

select lives_ok(
  $$
    select *
    from public.admin_set_manual_platform_stats(
      '00000000-0000-0000-0000-0000000000ab',
      'xcpc_elo',
      1723.5,
      1801.25,
      null,
      pg_catalog.clock_timestamp() - interval '1 hour',
      'XCPC ELO decimal correction',
      null
    )
  $$,
  'XCPC ELO accepts Ratings with up to two decimal places'
);

reset role;

select results_eq(
  $$
    select current_rating, max_rating, solved_count, source_version
    from public.platform_stats
    where profile_id = '00000000-0000-0000-0000-0000000000ab'
      and platform = 'xcpc_elo'
  $$,
  $$ values (1723.50::numeric, 1801.25::numeric, null::integer, 'admin-manual/v1'::text) $$,
  'XCPC ELO manual statistics preserve decimal Rating values'
);

set local role authenticated;

select throws_ok(
  $$
    select *
    from public.admin_set_manual_platform_stats(
      '00000000-0000-0000-0000-0000000000ab',
      'xcpc_elo',
      1723.456,
      1801.25,
      null,
      null,
      'Too many XCPC decimal places',
      null
    )
  $$,
  '22023',
  'XCPC ELO Rating supports at most two decimal places.',
  'XCPC ELO rejects more than two decimal places'
);

select throws_ok(
  $$
    select *
    from public.admin_set_manual_platform_stats(
      '00000000-0000-0000-0000-0000000000ab',
      'atcoder',
      1450.5,
      1525,
      null,
      null,
      'Fractional AtCoder Rating',
      (
        select updated_at
        from public.platform_stats
        where profile_id = '00000000-0000-0000-0000-0000000000ab'
          and platform = 'atcoder'
      )
    )
  $$,
  '22023',
  'Rating must be a non-negative integer for platform atcoder.',
  'non-XCPC manual Ratings remain integer-only'
);

reset role;

set local role authenticated;

select throws_ok(
  $$
    select *
    from public.admin_set_manual_platform_stats(
      '00000000-0000-0000-0000-0000000000ab',
      'xcpc_elo',
      null,
      null,
      1,
      null,
      'Unsupported XCPC solved count',
      null
    )
  $$,
  '22023',
  'Solved count is not supported for platform xcpc_elo.',
  'XCPC ELO rejects a solved count'
);

select throws_ok(
  $$
    select *
    from public.admin_set_manual_platform_stats(
      '00000000-0000-0000-0000-0000000000ab',
      'luogu',
      1000,
      1000,
      null,
      null,
      'Unsupported Luogu Rating',
      null
    )
  $$,
  '22023',
  'Rating is not supported for platform luogu.',
  'Luogu rejects Rating values'
);

select throws_ok(
  $$
    select *
    from public.admin_set_manual_platform_stats(
      '00000000-0000-0000-0000-0000000000ab',
      'qoj',
      1000,
      1000,
      null,
      null,
      'Unsupported QOJ Rating',
      null
    )
  $$,
  '22023',
  'Rating is not supported for platform qoj.',
  'QOJ rejects Rating values'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.platform_stats
    where profile_id = '00000000-0000-0000-0000-0000000000ab'
      and platform in ('luogu', 'qoj')
  ),
  0,
  'rejected Luogu and QOJ metric combinations do not create current statistics'
);

select is(
  (
    select count(*)::integer
    from public.sync_jobs
    where profile_id = '00000000-0000-0000-0000-0000000000ab'
      and platform in ('luogu', 'qoj')
      and payload ->> 'source' = 'admin_manual'
  ),
  0,
  'rejected Luogu and QOJ metric combinations do not create manual synchronization jobs'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where actor_id = '00000000-0000-0000-0000-0000000000bb'
      and action = 'manual_stats_updated'
      and metadata ->> 'platform' in ('luogu', 'qoj')
  ),
  0,
  'rejected Luogu and QOJ metric combinations do not create success audit records'
);

select * from finish();

rollback;
