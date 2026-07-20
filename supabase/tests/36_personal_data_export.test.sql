begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_function('public', 'export_own_data', array[]::text[], 'own-data export RPC exists');

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'export_own_data'
      and procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
      and coalesce(procedure.proconfig::text, '') like '%statement_timeout=15s%'
  ),
  'the export boundary is SECURITY DEFINER with a pinned search path and timeout'
);

select ok(
  pg_catalog.has_function_privilege('authenticated', 'public.export_own_data()', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.export_own_data()', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.export_own_data()', 'EXECUTE'),
  'only authenticated browser sessions can invoke the target-free export'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003601',
    'authenticated', 'authenticated', 'export-member-a@example.test', 'a-secret-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Export Member A","theme":"green"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003602',
    'authenticated', 'authenticated', 'export-admin-b@example.test', 'b-secret-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Export Admin B"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-000000003601' then 'Export Member A'
    else 'Export Admin B'
  end,
  qq = case id
    when '00000000-0000-0000-0000-000000003601' then '13600000001'
    else '13600000002'
  end,
  grade = '24级',
  major = '计算机科学与技术',
  role = case
    when id = '00000000-0000-0000-0000-000000003602'
      then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  review_note = case
    when id = '00000000-0000-0000-0000-000000003601' then 'Member A review note'
    else 'Admin B review note'
  end,
  approved_at = now();

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status
)
values
  (
    '00000000-0000-0000-0000-000000003601',
    'codeforces', 'ExportHandleA', 'exporthandlea', 'pending'
  ),
  (
    '00000000-0000-0000-0000-000000003602',
    'atcoder', 'ExportHandleB', 'exporthandleb', 'pending'
  );

insert into public.platform_stats (
  profile_id, platform, current_rating, max_rating, solved_count, status, source_version
)
values
  (
    '00000000-0000-0000-0000-000000003601',
    'codeforces', 1400, 1500, 42, 'unavailable', 'export-test-a'
  ),
  (
    '00000000-0000-0000-0000-000000003602',
    'atcoder', 1200, 1300, 24, 'unavailable', 'export-test-b'
  );

create temporary table export_job_ids (owner text primary key, id bigint not null);

with inserted_job as (
  insert into public.sync_jobs (
    scope, profile_id, platform, status, trigger_type, attempt_count, max_attempts,
    scheduled_for, started_at, finished_at, last_error_code, last_error_message
  ) values (
    'account', '00000000-0000-0000-0000-000000003601', 'codeforces',
    'succeeded', 'scheduled', 1, 3, now(), now(), now(), null, 'Member A sync marker'
  ) returning id
)
insert into export_job_ids (owner, id)
select 'a', id from inserted_job;

with inserted_job as (
  insert into public.sync_jobs (
    scope, profile_id, platform, status, trigger_type, attempt_count, max_attempts,
    scheduled_for, started_at, finished_at, last_error_code, last_error_message
  ) values (
    'account', '00000000-0000-0000-0000-000000003602', 'atcoder',
    'succeeded', 'scheduled', 1, 3, now(), now(), now(), null, 'Admin B sync marker'
  ) returning id
)
insert into export_job_ids (owner, id)
select 'b', id from inserted_job;

create temporary table export_run_ids (owner text primary key, id bigint not null);

with inserted_run as (
  insert into public.sync_runs (
    job_id, profile_id, platform, attempt, status, started_at, finished_at,
    duration_ms, http_status, source_version
  ) values (
    (select id from export_job_ids where owner = 'a'),
    '00000000-0000-0000-0000-000000003601', 'codeforces', 1, 'succeeded',
    now() - interval '1 second', now(), 1000, 200, 'export-test-a'
  ) returning id
)
insert into export_run_ids (owner, id)
select 'a', id from inserted_run;

with inserted_run as (
  insert into public.sync_runs (
    job_id, profile_id, platform, attempt, status, started_at, finished_at,
    duration_ms, http_status, source_version
  ) values (
    (select id from export_job_ids where owner = 'b'),
    '00000000-0000-0000-0000-000000003602', 'atcoder', 1, 'succeeded',
    now() - interval '1 second', now(), 1000, 200, 'export-test-b'
  ) returning id
)
insert into export_run_ids (owner, id)
select 'b', id from inserted_run;

insert into public.stat_snapshots (
  profile_id, platform, sync_run_id, current_rating, max_rating, solved_count, status
)
values
  (
    '00000000-0000-0000-0000-000000003601', 'codeforces',
    (select id from export_run_ids where owner = 'a'), 1400, 1500, 42, 'unavailable'
  ),
  (
    '00000000-0000-0000-0000-000000003602', 'atcoder',
    (select id from export_run_ids where owner = 'b'), 1200, 1300, 24, 'unavailable'
  );

create temporary table export_problem (id bigint primary key);

with inserted_problem as (
  insert into public.daily_problems (
    problem_date, title, source_platform, external_problem_id, source_url,
    difficulty, tags, training_note, estimated_minutes, status, published_at
  )
  values (
    current_date, 'Export Daily Problem', 'Codeforces', 'CF-EXPORT',
    'https://example.test/problem/export', '入门', array['模拟', '实现'],
    'Export training note', 30, 'published', now()
  )
  returning id
)
insert into export_problem (id)
select id from inserted_problem;

insert into public.daily_problem_completions (problem_id, profile_id)
values
  ((select id from export_problem), '00000000-0000-0000-0000-000000003601'),
  ((select id from export_problem), '00000000-0000-0000-0000-000000003602');

insert into public.daily_problem_comments (
  problem_id, author_id, body, is_visible, hidden_at
)
values
  (
    (select id from export_problem), '00000000-0000-0000-0000-000000003601',
    'Member A hidden reflection', false, now()
  ),
  (
    (select id from export_problem), '00000000-0000-0000-0000-000000003602',
    'Admin B visible reflection', true, null
  );

insert into private.webchat_member_access (
  user_id, access_enabled, total_request_limit, total_token_limit,
  pilot_observation_enabled
)
values
  ('00000000-0000-0000-0000-000000003601', true, 20, 200000, false),
  ('00000000-0000-0000-0000-000000003602', true, 30, 300000, true);

insert into private.webchat_daily_usage (
  user_id, usage_date, request_count, input_tokens, output_tokens,
  unknown_tokens, total_tokens, reserved_tokens
)
values
  ('00000000-0000-0000-0000-000000003601', current_date, 2, 1000, 100, 0, 1100, 0),
  ('00000000-0000-0000-0000-000000003602', current_date, 3, 2000, 200, 0, 2200, 0);

insert into private.webchat_requests (
  user_id, request_id, request_fingerprint, owner_token, status, quota_date,
  request_counted, claimed_at, upstream_started_at, lease_expires_at,
  finished_at, reserved_tokens, input_tokens, output_tokens, total_tokens,
  charged_tokens, outcome, cached_input_tokens, cache_write_tokens
)
values
  (
    '00000000-0000-0000-0000-000000003601', 'export-request-a', repeat('a', 64),
    '36010000-0000-4000-8000-000000000001', 'finished', current_date, true,
    now() - interval '2 seconds', now() - interval '1 second', null, now(),
    5000, 1000, 100, 1100, 1100, 'completed', 512, 0
  ),
  (
    '00000000-0000-0000-0000-000000003602', 'export-request-b', repeat('b', 64),
    '36020000-0000-4000-8000-000000000001', 'finished', current_date, true,
    now() - interval '2 seconds', now() - interval '1 second', null, now(),
    5000, 2000, 200, 2200, 2200, 'completed', 1024, 0
  );

insert into private.webchat_conversations (
  id, user_id, title, message_count, content_bytes
)
values
  (
    '36010000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000003601', 'Member A private chat', 1, 128
  ),
  (
    '36020000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000003602', 'Admin B private chat', 1, 128
  );

insert into private.webchat_messages (
  conversation_id, id, position, format, content, content_bytes
)
values
  (
    '36010000-0000-4000-8000-000000000002', 'message-a', 1, 'ai-sdk/v6',
    '{"role":"user","parts":[{"type":"text","text":"Member A private prompt"}]}'::jsonb,
    96
  ),
  (
    '36020000-0000-4000-8000-000000000002', 'message-b', 1, 'ai-sdk/v6',
    '{"role":"user","parts":[{"type":"text","text":"Admin B private prompt"}]}'::jsonb,
    96
  );

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003601', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003601","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table member_a_export as
select public.export_own_data() as payload;

select is(
  (select payload ->> 'schemaVersion' from member_a_export),
  '1',
  'the export is explicitly versioned'
);

select ok(
  (select payload #>> '{account,email}' = 'export-member-a@example.test'
    and payload #>> '{profile,qq}' = '13600000001'
    and payload #>> '{profile,reviewNote}' = 'Member A review note'
   from member_a_export),
  'the caller receives own Auth and profile fields'
);

select ok(
  (select payload @> '{"platformAccounts":[{"externalId":"ExportHandleA"}]}'::jsonb
    and payload::text not like '%ExportHandleB%'
    and not pg_catalog.jsonb_path_exists(
      payload,
      '$.platformAccounts[*].normalizedExternalId'
    )
   from member_a_export),
  'platform bindings are isolated and omit canonicalization internals'
);

select ok(
  (select pg_catalog.jsonb_array_length(payload -> 'platformStats') = 1
    and payload #>> '{platformStats,0,solvedCount}' = '42'
    and pg_catalog.jsonb_array_length(payload -> 'statSnapshots') = 1
   from member_a_export),
  'own current statistics and historical snapshots are exported'
);

select ok(
  (select pg_catalog.jsonb_array_length(payload -> 'syncHistory') = 1
    and payload #>> '{syncHistory,0,lastErrorMessage}' = 'Member A sync marker'
    and payload::text not like '%Admin B sync marker%'
   from member_a_export),
  'synchronization history remains scoped to the caller'
);

select ok(
  (select pg_catalog.jsonb_array_length(payload #> '{dailyProblem,completions}') = 1
    and payload #>> '{dailyProblem,completions,0,title}' = 'Export Daily Problem'
    and pg_catalog.jsonb_array_length(payload #> '{dailyProblem,comments}') = 1
   from member_a_export),
  'own daily-problem completions and comments are included'
);

select ok(
  (select payload #>> '{dailyProblem,comments,0,body}' = 'Member A hidden reflection'
    and payload #>> '{dailyProblem,comments,0,isVisible}' = 'false'
    and payload::text not like '%Admin B visible reflection%'
   from member_a_export),
  'the author receives an own hidden comment without another author content'
);

select ok(
  (select payload #>> '{webchat,access,totalRequestLimit}' = '20'
    and payload #>> '{webchat,dailyUsage,0,totalTokens}' = '1100'
   from member_a_export),
  'own WebChat access limits and aggregate usage are included'
);

select ok(
  (select payload #>> '{webchat,conversations,0,title}' = 'Member A private chat'
    and payload::text like '%Member A private prompt%'
    and payload::text not like '%Admin B private prompt%'
   from member_a_export),
  'private WebChat history is exported only for its owner'
);

select ok(
  (select payload #>> '{webchat,requests,0,requestId}' = 'export-request-a'
    and payload #>> '{webchat,requests,0,cachedInputTokens}' = '512'
    and payload::text not like '%export-request-b%'
   from member_a_export),
  'own bounded WebChat request ledger is exported without cross-user rows'
);

select ok(
  (select payload::text not like '%encrypted_password%'
    and payload::text not like '%a-secret-password%'
    and payload::text not like '%request_fingerprint%'
    and payload::text not like '%owner_token%'
    and payload::text not like '%approved_by%'
    and payload::text not like '%updated_by%'
    and payload::text not like '%hidden_by%'
   from member_a_export),
  'passwords, internal request credentials, and administrator identifiers are excluded'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003602', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003602","role":"authenticated"}',
  true
);
set local role authenticated;

select ok(
  public.export_own_data() #>> '{account,email}' = 'export-admin-b@example.test'
    and public.export_own_data()::text not like '%Member A private prompt%'
    and public.export_own_data()::text not like '%ExportHandleA%',
  'an administrator still receives only their own export'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_like(
  $$ select public.export_own_data() $$,
  '%permission denied%',
  'anonymous visitors cannot invoke the personal export'
);

reset role;

select * from finish();

rollback;
