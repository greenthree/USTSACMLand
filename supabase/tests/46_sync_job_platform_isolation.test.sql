begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select ok(
  pg_catalog.to_regprocedure('private.enforce_sync_job_platform_isolation()') is not null,
  'the private synchronization hierarchy trigger function exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'enforce_sync_job_platform_isolation'
      and procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
      and coalesce(procedure.proconfig::text, '') like '%statement_timeout=15s%'
  ),
  'the hierarchy trigger is SECURITY DEFINER with a pinned path and timeout'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'private.enforce_sync_job_platform_isolation()',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'private.enforce_sync_job_platform_isolation()',
    'EXECUTE'
  ),
  'the trigger function is not directly executable by application roles'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = 'public.sync_jobs'::regclass
      and trigger.tgname = 'sync_jobs_platform_isolation'
      and not trigger.tgisinternal
      and trigger.tgdeferrable
      and trigger.tginitdeferred
  ),
  'the hierarchy guard is a deferred constraint trigger'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'private.enforce_sync_job_platform_isolation()'::regprocedure
  ) like '%pg_advisory_xact_lock%',
  'the hierarchy guard serializes concurrent commits with a transaction lock'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000e46',
    'authenticated',
    'authenticated',
    'sync-isolation-a@example.test',
    'test-password',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Sync Isolation A"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000f46',
    'authenticated',
    'authenticated',
    'sync-isolation-b@example.test',
    'test-password',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Sync Isolation B"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

insert into public.sync_jobs (
  id, scope, profile_id, platform, status, trigger_type, attempt_count,
  max_attempts, scheduled_for, payload, dedupe_key
)
overriding system value
values (
  94601,
  'account',
  '00000000-0000-0000-0000-000000000e46',
  'codeforces',
  'queued',
  'manual',
  0,
  2,
  now(),
  '{"platforms":["codeforces"]}'::jsonb,
  'member:00000000-0000-0000-0000-000000000e46:platform:codeforces'
);

set constraints sync_jobs_platform_isolation immediate;

select is(
  (select dedupe_key from public.sync_jobs where id = 94601),
  'member:00000000-0000-0000-0000-000000000e46:platform:codeforces',
  'an account job uses its member-and-platform dedupe key'
);

select lives_ok(
  $$
    insert into public.sync_jobs (
      id, scope, profile_id, platform, status, trigger_type, attempt_count,
      max_attempts, scheduled_for, payload, dedupe_key
    )
    overriding system value
    values (
      94602, 'account', '00000000-0000-0000-0000-000000000e46', 'atcoder',
      'queued', 'manual', 0, 2, now(), '{"platforms":["atcoder"]}'::jsonb,
      'member:00000000-0000-0000-0000-000000000e46:platform:atcoder'
    )
  $$,
  'different platform account jobs may be active for one member'
);

select is(
  (
    select count(*)::integer
    from public.sync_jobs
    where profile_id = '00000000-0000-0000-0000-000000000e46'
      and status in ('queued', 'running')
  ),
  2,
  'both independent platform jobs remain active'
);

select throws_ok(
  $$
    insert into public.sync_jobs (
      id, scope, profile_id, platform, status, trigger_type, attempt_count,
      max_attempts, scheduled_for, started_at, payload, dedupe_key
    )
    overriding system value
    values (
      94603, 'account', '00000000-0000-0000-0000-000000000e46', 'codeforces',
      'running', 'manual', 1, 2, now(), now(), '{"platforms":["codeforces"]}'::jsonb,
      'intentionally-different-key'
    )
  $$,
  '23505',
  'An active synchronization job already exists for this member scope or platform.',
  'same-platform jobs conflict even when their dedupe keys differ'
);

select throws_ok(
  $$
    insert into public.sync_jobs (
      id, scope, profile_id, platform, status, trigger_type, attempt_count,
      max_attempts, scheduled_for, payload, dedupe_key
    )
    overriding system value
    values (
      94604, 'member', '00000000-0000-0000-0000-000000000e46', null,
      'queued', 'manual', 0, 1, now(), '{"platforms":["codeforces","atcoder"]}'::jsonb,
      'member:00000000-0000-0000-0000-000000000e46'
    )
  $$,
  '23505',
  'An active synchronization job already exists for this member scope or platform.',
  'a member-scope job cannot start while any account job is active'
);

select lives_ok(
  $$
    insert into public.sync_jobs (
      id, scope, profile_id, platform, status, trigger_type, attempt_count,
      max_attempts, scheduled_for, payload, dedupe_key
    )
    overriding system value
    values (
      94605, 'account', '00000000-0000-0000-0000-000000000f46', 'codeforces',
      'queued', 'manual', 0, 2, now(), '{"platforms":["codeforces"]}'::jsonb,
      'member:00000000-0000-0000-0000-000000000f46:platform:codeforces'
    )
  $$,
  'the same platform may run independently for another member'
);

update public.sync_jobs
set status = 'cancelled', finished_at = now()
where id in (94601, 94602);

select is(
  (
    select count(*)::integer
    from public.sync_jobs
    where profile_id = '00000000-0000-0000-0000-000000000e46'
      and status in ('queued', 'running')
  ),
  0,
  'terminal account jobs release the member hierarchy'
);

select lives_ok(
  $$
    insert into public.sync_jobs (
      id, scope, profile_id, platform, status, trigger_type, attempt_count,
      max_attempts, scheduled_for, payload, dedupe_key
    )
    overriding system value
    values (
      94606, 'member', '00000000-0000-0000-0000-000000000e46', null,
      'queued', 'manual', 0, 1, now(), '{"platforms":["codeforces","atcoder"]}'::jsonb,
      'member:00000000-0000-0000-0000-000000000e46'
    )
  $$,
  'a member-scope job may start after account jobs become terminal'
);

select throws_ok(
  $$
    insert into public.sync_jobs (
      id, scope, profile_id, platform, status, trigger_type, attempt_count,
      max_attempts, scheduled_for, payload, dedupe_key
    )
    overriding system value
    values (
      94607, 'account', '00000000-0000-0000-0000-000000000e46', 'qoj',
      'queued', 'manual', 0, 2, now(), '{"platforms":["qoj"]}'::jsonb,
      'member:00000000-0000-0000-0000-000000000e46:platform:qoj'
    )
  $$,
  '23505',
  'An active synchronization job already exists for this member scope or platform.',
  'an account job cannot start while a member-scope job is active'
);

update public.sync_jobs
set status = 'cancelled', finished_at = now()
where id = 94606;

select lives_ok(
  $$
    insert into public.sync_jobs (
      id, scope, profile_id, platform, status, trigger_type, attempt_count,
      max_attempts, scheduled_for, payload, dedupe_key
    )
    overriding system value
    values (
      94608, 'account', '00000000-0000-0000-0000-000000000e46', 'qoj',
      'queued', 'manual', 0, 2, now(), '{"platforms":["qoj"]}'::jsonb,
      'member:00000000-0000-0000-0000-000000000e46:platform:qoj'
    )
  $$,
  'an account job may start after the member-scope job becomes terminal'
);

select is(
  (
    select count(*)::integer
    from public.sync_jobs
    where profile_id = '00000000-0000-0000-0000-000000000e46'
      and status in ('queued', 'running')
  ),
  1,
  'only the newly released account job is active for the first member'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'sync_jobs_active_dedupe_idx'
      and indexdef like '%dedupe_key%'
  ),
  'the active dedupe unique index remains in force alongside the hierarchy guard'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.sync_jobs', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.sync_jobs', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.sync_jobs', 'DELETE'),
  'ordinary users still cannot mutate synchronization jobs directly'
);

select * from finish();

rollback;
