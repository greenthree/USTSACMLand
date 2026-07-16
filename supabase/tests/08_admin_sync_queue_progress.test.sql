begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000a8',
    'authenticated', 'authenticated', 'queue-view-member@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Queue View Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000b8',
    'authenticated', 'authenticated', 'queue-view-admin@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Queue View Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-0000000000a8' then 'Queue View Member'
    else 'Queue View Administrator'
  end,
  role = case
    when id = '00000000-0000-0000-0000-0000000000b8' then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  approved_at = now();

insert into public.sync_jobs (
  id, scope, profile_id, platform, status, trigger_type, attempt_count,
  max_attempts, scheduled_for, started_at, finished_at, last_error_code, payload
)
overriding system value
values
  (99801, 'account', '00000000-0000-0000-0000-0000000000a8', 'codeforces',
    'queued', 'scheduled', 1, 3, now() + interval '2 minutes', null, null,
    'timeout', '{"platforms":["codeforces"]}'::jsonb),
  (99802, 'account', '00000000-0000-0000-0000-0000000000a8', 'atcoder',
    'running', 'manual', 1, 3, now(), now(), null,
    null, '{"platforms":["atcoder"]}'::jsonb),
  (99803, 'account', '00000000-0000-0000-0000-0000000000a8', 'luogu',
    'succeeded', 'scheduled', 1, 3, now(), now(), now(),
    null, '{"platforms":["luogu"]}'::jsonb);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.admin_list_active_sync_jobs(integer,bigint)',
    'EXECUTE'
  ),
  'anonymous visitors cannot call the queue progress RPC'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.admin_list_active_sync_jobs(integer,bigint)',
    'EXECUTE'
  ),
  'authenticated sessions can reach the administrator-checked RPC'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a8', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a8","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select * from public.admin_list_active_sync_jobs() $$,
  '42501',
  'Administrator access required.',
  'ordinary members cannot inspect the synchronization queue'
);

reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b8', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b8","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table visible_active_jobs as
select * from public.admin_list_active_sync_jobs();

select is(
  (select count(*)::integer from visible_active_jobs),
  2,
  'administrators see queued and running jobs only'
);

select is(
  (select string_agg(status::text, ',' order by job_id) from visible_active_jobs),
  'queued,running',
  'active job states retain their queue semantics'
);

select is(
  (select member_name from visible_active_jobs where job_id = 99801),
  'Queue View Member',
  'the queue projection resolves its member label'
);

select is(
  (
    select concat(attempt_count, '/', max_attempts)
    from visible_active_jobs
    where job_id = 99801
  ),
  '1/3',
  'the queue projection exposes bounded attempt progress'
);

select is(
  (
    select count(*)::integer
    from public.admin_list_active_sync_jobs(50, 99802)
  ),
  1,
  'queue pagination uses the job ID cursor'
);

reset role;

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_index as idx
    join pg_catalog.pg_class as relation on relation.oid = idx.indrelid
    join pg_catalog.pg_class as index_relation on index_relation.oid = idx.indexrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'sync_jobs'
      and index_relation.relname = 'sync_jobs_active_admin_list_idx'
      and pg_catalog.pg_get_expr(idx.indpred, idx.indrelid) like '%queued%'
      and pg_catalog.pg_get_expr(idx.indpred, idx.indrelid) like '%running%'
  ),
  1,
  'active queue listing has a matching partial index'
);

select * from finish();

rollback;
