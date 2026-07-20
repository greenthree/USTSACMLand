begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000a17',
  'authenticated',
  'authenticated',
  'atomic-job-completion@example.test',
  'test-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Atomic Job Completion Fixture"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

insert into public.sync_jobs (
  id, scope, profile_id, platform, status, trigger_type, attempt_count,
  max_attempts, scheduled_for, started_at, payload
)
overriding system value
values
  (17001, 'account', '00000000-0000-0000-0000-000000000a17', 'codeforces',
    'running', 'scheduled', 1, 3, now(), now(), '{"platforms":["codeforces"]}'::jsonb),
  (17002, 'account', '00000000-0000-0000-0000-000000000a17', 'qoj',
    'running', 'scheduled', 1, 3, now(), now(), '{"platforms":["qoj"]}'::jsonb),
  (17003, 'account', '00000000-0000-0000-0000-000000000a17', 'atcoder',
    'running', 'scheduled', 1, 3, now(), now(), '{"platforms":["atcoder"]}'::jsonb),
  (17004, 'account', '00000000-0000-0000-0000-000000000a17', 'xcpc_elo',
    'running', 'scheduled', 1, 1, now(), now(), '{"platforms":["xcpc_elo"]}'::jsonb);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_sync_job_attempt(bigint,smallint,boolean,boolean,public.sync_error_code,text)',
    'EXECUTE'
  ),
  'ordinary authenticated users cannot complete queue attempts'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.complete_sync_job_attempt(bigint,smallint,boolean,boolean,public.sync_error_code,text)',
    'EXECUTE'
  ),
  'the service role can complete queue attempts'
);

set local role service_role;
create temporary table first_completion as
select * from public.complete_sync_job_attempt(
  17001,
  1::smallint,
  false,
  true,
  'rate_limited',
  'temporary upstream limit'
);
reset role;

select ok(
  (select transitioned from first_completion),
  'the current first attempt transitions atomically'
);

select is(
  (select job_status::text from first_completion),
  'queued',
  'a retryable first attempt is requeued'
);

select is(
  round(extract(epoch from (
    (select retry_at from first_completion) - (select transitioned_at from first_completion)
  )))::integer,
  120,
  'the first retry uses an exact two-minute backoff'
);

select is(
  (select status::text from public.sync_jobs where id = 17001),
  'queued',
  'the first retry persists queued state'
);

select is(
  (select last_error_code::text from public.sync_jobs where id = 17001),
  'rate_limited',
  'the retry retains its structured failure code'
);

set local role service_role;
create temporary table early_claim as
select * from public.claim_due_sync_jobs(12, interval '15 minutes');
reset role;

select ok(
  not exists (select 1 from early_claim where job_id = 17001),
  'a retry cannot be claimed before its scheduled time'
);

update public.sync_jobs set scheduled_for = now() - interval '1 minute' where id = 17001;
set local role service_role;
create temporary table second_claim as
select * from public.claim_due_sync_jobs(1, interval '15 minutes');
reset role;

select is(
  (select attempt_count::integer from second_claim where job_id = 17001),
  2,
  'the due retry is claimed as the second attempt'
);

set local role service_role;
create temporary table stale_completion as
select * from public.complete_sync_job_attempt(
  17001,
  1::smallint,
  true,
  false,
  null,
  null
);
reset role;

select ok(
  not (select transitioned from stale_completion),
  'a stale first worker cannot complete after the second attempt'
);

select is(
  (select status::text from public.sync_jobs where id = 17001),
  'running',
  'the rejected stale completion does not overwrite the active retry'
);

set local role service_role;
create temporary table second_completion as
select * from public.complete_sync_job_attempt(
  17001,
  2::smallint,
  false,
  true,
  'timeout',
  'temporary timeout'
);
reset role;

select is(
  (select job_status::text from second_completion),
  'failed',
  'the second failed attempt exhausts even a legacy max-attempts value'
);

select is(
  (select retry_at from second_completion),
  null::timestamptz,
  'an exhausted job has no further retry time'
);

set local role service_role;
create temporary table qoj_completion as
select * from public.complete_sync_job_attempt(
  17002,
  1::smallint,
  false,
  true,
  'rate_limited',
  'temporary QOJ limit'
);
reset role;

select is(
  (select job_status::text from qoj_completion),
  'queued',
  'QOJ receives the same single durable retry as every other platform'
);

select is(
  round(extract(epoch from (
    (select retry_at from qoj_completion) - (select transitioned_at from qoj_completion)
  )))::integer,
  120,
  'the QOJ retry uses the bounded two-minute delay'
);

update public.sync_jobs set scheduled_for = now() - interval '1 minute' where id = 17002;
set local role service_role;
create temporary table qoj_second_claim as
select * from public.claim_due_sync_jobs(1, interval '15 minutes');
create temporary table qoj_second_completion as
select * from public.complete_sync_job_attempt(
  17002,
  2::smallint,
  false,
  true,
  'rate_limited',
  'QOJ limit persisted'
);
create temporary table permanent_completion as
select * from public.complete_sync_job_attempt(
  17003,
  1::smallint,
  false,
  false,
  'not_found',
  'permanent failure'
);
create temporary table successful_completion as
select * from public.complete_sync_job_attempt(
  17004,
  1::smallint,
  true,
  false,
  null,
  null
);
reset role;

select is(
  (select attempt_count::integer from qoj_second_claim where job_id = 17002),
  2,
  'the due QOJ retry is claimed as the second attempt'
);

select is(
  (select job_status::text from qoj_second_completion),
  'failed',
  'a second QOJ failure is terminal without a third attempt'
);

select is(
  (select job_status::text from permanent_completion),
  'failed',
  'a permanent platform failure is terminal immediately'
);

select is(
  (select job_status::text from successful_completion),
  'succeeded',
  'a successful current attempt reaches the succeeded state'
);

select is(
  (select finished_at is not null from public.sync_jobs where id = 17004),
  true,
  'a succeeded job records its completion time'
);

select throws_ok(
  $$
    select * from public.complete_sync_job_attempt(
      17004,
      1::smallint,
      true,
      true,
      'timeout',
      'invalid success metadata'
    )
  $$,
  '22023',
  'Successful attempts cannot include failure metadata.',
  'success and failure metadata cannot be mixed'
);

select throws_ok(
  $$
    select * from public.complete_sync_job_attempt(
      17999,
      1::smallint,
      true,
      false,
      null,
      null
    )
  $$,
  'P0002',
  'Synchronization job was not found.',
  'missing jobs fail explicitly'
);

select throws_ok(
  $$
    select * from public.complete_sync_job_attempt(
      17004,
      null::smallint,
      true,
      false,
      null,
      null
    )
  $$,
  '22023',
  'Job ID and positive expected attempt are required.',
  'a null expected attempt is rejected'
);

select throws_ok(
  $$
    select * from public.complete_sync_job_attempt(
      17004,
      1::smallint,
      null::boolean,
      false,
      null,
      null
    )
  $$,
  '22023',
  'Attempt outcome flags are required.',
  'a null attempt outcome is rejected'
);

select * from finish();

rollback;
