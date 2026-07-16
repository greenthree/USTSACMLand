begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000f7',
  'authenticated',
  'authenticated',
  'queue-member@example.test',
  'test-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Queue Fixture Member"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

insert into public.sync_jobs (
  id, scope, profile_id, platform, status, trigger_type, attempt_count,
  max_attempts, scheduled_for, started_at, payload, priority
)
overriding system value
values
  (99701, 'account', '00000000-0000-0000-0000-0000000000f7', 'codeforces',
    'queued', 'scheduled', 1, 3, now() - interval '5 minutes', null,
    '{"platforms":["codeforces"]}'::jsonb, 5),
  (99702, 'account', '00000000-0000-0000-0000-0000000000f7', 'atcoder',
    'queued', 'scheduled', 1, 3, now() + interval '1 hour', null,
    '{"platforms":["atcoder"]}'::jsonb, 0),
  (99703, 'account', '00000000-0000-0000-0000-0000000000f7', 'luogu',
    'queued', 'scheduled', 3, 3, now() - interval '5 minutes', null,
    '{"platforms":["luogu"]}'::jsonb, 0),
  (99704, 'account', '00000000-0000-0000-0000-0000000000f7', 'nowcoder',
    'running', 'scheduled', 1, 3, now() - interval '1 hour', now() - interval '20 minutes',
    '{"platforms":["nowcoder"]}'::jsonb, 10),
  (99705, 'account', '00000000-0000-0000-0000-0000000000f7', 'qoj',
    'running', 'scheduled', 1, 1, now() - interval '1 hour', now() - interval '20 minutes',
    '{"platforms":["qoj"]}'::jsonb, 0);

insert into public.sync_runs (
  id, job_id, profile_id, platform, attempt, status, started_at
)
overriding system value
values
  (99706, 99704, '00000000-0000-0000-0000-0000000000f7', 'nowcoder',
    1, 'running', now() - interval '20 minutes'),
  (99707, 99705, '00000000-0000-0000-0000-0000000000f7', 'qoj',
    1, 'running', now() - interval '20 minutes');

set local role service_role;
create temporary table claimed_queue_jobs as
select * from public.claim_due_sync_jobs(12, interval '15 minutes');
reset role;

select is(
  (select count(*)::integer from claimed_queue_jobs),
  2,
  'the queue claims due and recovered jobs only'
);

select ok(
  exists (select 1 from claimed_queue_jobs where job_id = 99701 and attempt_count = 2),
  'a due retry is claimed with its attempt incremented'
);

select ok(
  exists (select 1 from claimed_queue_jobs where job_id = 99704 and attempt_count = 2),
  'a stale running job is recovered and reclaimed'
);

select is(
  (select status::text from public.sync_jobs where id = 99702),
  'queued',
  'future work remains queued'
);

select is(
  (select attempt_count::integer from public.sync_jobs where id = 99702),
  1,
  'future work does not consume an attempt'
);

select is(
  (select status::text from public.sync_jobs where id = 99703),
  'failed',
  'an exhausted queued job becomes terminal'
);

select is(
  (select status::text from public.sync_jobs where id = 99705),
  'failed',
  'an exhausted stale worker becomes terminal'
);

select is(
  (
    select count(*)::integer
    from public.sync_runs
    where id in (99706, 99707)
      and status = 'failed'
      and error_code = 'timeout'
      and finished_at is not null
  ),
  2,
  'stale running attempts are closed before their jobs are recovered or failed'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_due_sync_jobs(integer,interval)',
    'EXECUTE'
  ),
  'ordinary authenticated users cannot claim queue work'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_due_sync_jobs(integer,interval)',
    'EXECUTE'
  ),
  'the service role can claim queue work'
);

insert into public.sync_jobs (
  id, scope, profile_id, platform, status, trigger_type, attempt_count,
  max_attempts, scheduled_for, payload, dedupe_key
)
overriding system value
values (
  99708,
  'account',
  '00000000-0000-0000-0000-0000000000f7',
  'codeforces',
  'queued',
  'manual',
  0,
  3,
  now(),
  '{"platforms":["codeforces"]}'::jsonb,
  'duplicate-submission-guard'
);

select throws_ok(
  $$
    insert into public.sync_jobs (
      id, scope, profile_id, platform, status, trigger_type, attempt_count,
      max_attempts, scheduled_for, started_at, payload, dedupe_key
    )
    overriding system value
    values (
      99709,
      'account',
      '00000000-0000-0000-0000-0000000000f7',
      'codeforces',
      'running',
      'manual',
      1,
      3,
      now(),
      now(),
      '{"platforms":["codeforces"]}'::jsonb,
      'duplicate-submission-guard'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "sync_jobs_active_dedupe_idx"',
  'duplicate active synchronization submissions are rejected atomically'
);

select * from finish();

rollback;
