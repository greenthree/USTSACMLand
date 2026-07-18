begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002501',
    'authenticated', 'authenticated', 'daily-member-a@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Daily Member A"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002502',
    'authenticated', 'authenticated', 'daily-member-b@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Daily Member B"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002503',
    'authenticated', 'authenticated', 'daily-suspended@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Daily Suspended"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002504',
    'authenticated', 'authenticated', 'daily-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Daily Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-000000002501' then 'Daily Member A'
    when '00000000-0000-0000-0000-000000002502' then 'Daily Member B'
    when '00000000-0000-0000-0000-000000002503' then 'Daily Suspended'
    else 'Daily Administrator'
  end,
  qq = case id
    when '00000000-0000-0000-0000-000000002501' then '12500000001'
    when '00000000-0000-0000-0000-000000002502' then '12500000002'
    when '00000000-0000-0000-0000-000000002503' then '12500000003'
    else '12500000004'
  end,
  grade = '24级',
  major = '计算机科学与技术',
  role = case
    when id = '00000000-0000-0000-0000-000000002504'
      then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = case
    when id = '00000000-0000-0000-0000-000000002503'
      then 'suspended'::public.profile_review_status
    else 'approved'::public.profile_review_status
  end,
  approved_at = now();

insert into public.daily_problems (
  id, problem_date, title, source_platform, external_problem_id, source_url,
  difficulty, tags, training_note, estimated_minutes, status, published_at,
  created_by, updated_by
)
overriding system value
values
  (
    25001,
    (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 1,
    'Published fixture', 'Codeforces', 'CF-1A', 'https://codeforces.com/problemset/problem/1/A',
    '入门', array['implementation'], '先独立分析输入输出。', 20, 'published',
    pg_catalog.clock_timestamp() - interval '1 day',
    '00000000-0000-0000-0000-000000002504',
    '00000000-0000-0000-0000-000000002504'
  ),
  (
    25002,
    (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 1,
    'Future fixture', 'AtCoder', 'ABC999_A', 'https://atcoder.jp/contests/abc999/tasks/abc999_a',
    '入门', array['math'], '留到明天。', null, 'published',
    pg_catalog.clock_timestamp(),
    '00000000-0000-0000-0000-000000002504',
    '00000000-0000-0000-0000-000000002504'
  ),
  (
    25003,
    (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 2,
    'Draft fixture', 'QOJ', 'QOJ-1', 'https://qoj.ac/problem/1',
    null, '{}'::text[], '草稿不可见。', 30, 'draft', null,
    '00000000-0000-0000-0000-000000002504',
    '00000000-0000-0000-0000-000000002504'
  );

insert into public.daily_problem_completions (problem_id, profile_id, completed_at)
values (
  25001,
  '00000000-0000-0000-0000-000000002501',
  pg_catalog.clock_timestamp() - interval '2 hours'
);

insert into public.daily_problem_comments (
  id, problem_id, author_id, body, is_visible, hidden_at, hidden_by
)
overriding system value
values
  (
    25011, 25001, '00000000-0000-0000-0000-000000002502',
    'Visible fixture comment.', true, null, null
  ),
  (
    25012, 25001, '00000000-0000-0000-0000-000000002502',
    'Hidden fixture comment.', false, pg_catalog.clock_timestamp(),
    '00000000-0000-0000-0000-000000002504'
  );

create temporary table created_daily_comment (
  comment_id bigint,
  created_at timestamptz,
  updated_at timestamptz
) on commit drop;
grant select, insert on created_daily_comment to authenticated;

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'daily_problems', 'daily_problem_completions', 'daily_problem_comments'
      ])
  ),
  3,
  'the three daily learning base tables exist'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'daily_problems', 'daily_problem_completions', 'daily_problem_comments'
      ])
      and relation.relrowsecurity
  ),
  3,
  'all daily learning base tables enable row level security'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as browser(role_name)
    cross join unnest(array[
      'public.daily_problems',
      'public.daily_problem_completions',
      'public.daily_problem_comments'
    ]) as base_table(table_name)
    where pg_catalog.has_table_privilege(
      browser.role_name,
      base_table.table_name,
      'SELECT,INSERT,UPDATE,DELETE'
    )
  ),
  'browser roles have no direct read or write privilege on daily learning identities'
);

select ok(
  not pg_catalog.has_sequence_privilege('anon', 'public.daily_problems_id_seq', 'USAGE')
    and not pg_catalog.has_sequence_privilege(
      'authenticated', 'public.daily_problem_comments_id_seq', 'USAGE'
    ),
  'browser roles cannot allocate daily learning identities directly'
);

select ok(
  pg_catalog.has_function_privilege(
    'anon', 'public.read_daily_problem_feed(integer,date)', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.read_daily_problem_feed(integer,date)', 'EXECUTE'
    ),
  'the sanitized daily problem feed is public'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.set_own_daily_problem_completion(bigint,boolean)', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.create_daily_problem_comment(bigint,text)', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'authenticated',
      'public.delete_own_daily_problem_comment(bigint,timestamptz)',
      'EXECUTE'
    ),
  'authenticated sessions can reach identity-derived member writers'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.list_daily_problem_comments(bigint,integer,bigint)', 'EXECUTE'
  ),
  'anonymous visitors cannot read daily problem discussion'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.admin_list_daily_problems(integer,bigint)', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.admin_list_daily_problems(integer,bigint)', 'EXECUTE'
    ),
  'only authenticated sessions can reach the administrator-checked daily problem API'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'require_daily_problem_member',
        'read_daily_problem_feed',
        'set_own_daily_problem_completion',
        'list_daily_problem_comments',
        'create_daily_problem_comment',
        'delete_own_daily_problem_comment',
        'admin_list_daily_problems',
        'admin_upsert_daily_problem',
        'admin_delete_daily_problem',
        'admin_set_daily_problem_comment_visibility'
      ])
      and (
        not procedure.prosecdef
        or coalesce(procedure.proconfig::text, '') not like '%search_path=%'
      )
  ),
  'all callable daily problem functions are SECURITY DEFINER with a pinned search path'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select is(
  (select count(*)::integer from public.read_daily_problem_feed(20, null)),
  1,
  'anonymous feed exposes only published problems whose Beijing date has arrived'
);

select ok(
  exists (
    select 1
    from public.read_daily_problem_feed(20, null)
    where problem_id = 25001
      and completion_count = 1
      and comment_count = 1
  ),
  'public aggregates include completion and visible discussion counts without identities'
);

select ok(
  (select my_completed_at is null from public.read_daily_problem_feed(20, null)),
  'anonymous feed never reveals a personal completion timestamp'
);

select ok(
  not exists (
    select 1
    from public.read_daily_problem_feed(20, null)
    where problem_id in (25002, 25003)
  ),
  'future and draft problems are absent from the public feed'
);

select throws_like(
  $$ select * from public.list_daily_problem_comments(25001, 50, null) $$,
  '%permission denied%',
  'anonymous visitors cannot invoke the discussion reader'
);

select throws_like(
  $$ select * from public.set_own_daily_problem_completion(25001, true) $$,
  '%permission denied%',
  'anonymous visitors cannot create completion identities'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002501', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002501","role":"authenticated"}',
  true
);
set local role authenticated;

select ok(
  (select my_completed_at is not null from public.read_daily_problem_feed(20, null)),
  'an approved member sees only their own completion timestamp'
);

select is(
  (
    select completed_at
    from public.set_own_daily_problem_completion(25001, true)
  ),
  (
    select completed_at
    from public.set_own_daily_problem_completion(25001, true)
  ),
  'repeating completion preserves the original timestamp'
);

select ok(
  (select completion_count = 1 from public.read_daily_problem_feed(20, null)),
  'completion is idempotent at the database boundary'
);

select ok(
  (select completed_at is null from public.set_own_daily_problem_completion(25001, false)),
  'clearing completion returns a null completion timestamp'
);

select ok(
  (select completion_count = 0 from public.read_daily_problem_feed(20, null)),
  'clearing completion removes the caller-owned record'
);

select throws_ok(
  $$ select * from public.set_own_daily_problem_completion(25002, true) $$,
  'P0002',
  'Daily problem is not available.',
  'members cannot complete a future problem'
);

insert into created_daily_comment
select * from public.create_daily_problem_comment(25001, '  My derived-author comment.  ');

select ok(
  exists (
    select 1
    from public.list_daily_problem_comments(25001, 50, null) as comment
    join created_daily_comment as created on created.comment_id = comment.comment_id
    where comment.author_id = '00000000-0000-0000-0000-000000002501'
      and comment.body = 'My derived-author comment.'
  ),
  'comment creation derives the author from auth.uid and normalizes the body'
);

select is(
  (
    select count(*)::integer
    from public.list_daily_problem_comments(25001, 50, null)
  ),
  2,
  'approved members see visible flat discussion rows'
);

select ok(
  not exists (
    select 1
    from public.list_daily_problem_comments(25001, 50, null)
    where comment_id = 25012
  ),
  'hidden discussion is excluded from an ordinary member view'
);

select throws_ok(
  $$
    select public.delete_own_daily_problem_comment(
      25011,
      (
        select updated_at
        from public.list_daily_problem_comments(25001, 50, null)
        where comment_id = 25011
      )
    )
  $$,
  '42501',
  'Only the comment author can delete this comment.',
  'a member cannot delete another author comment'
);

select throws_like(
  $$
    insert into public.daily_problem_comments (problem_id, author_id, body)
    values (
      25001,
      '00000000-0000-0000-0000-000000002502',
      'Forged author'
    )
  $$,
  '%permission denied%',
  'members cannot bypass the RPC to forge a comment author'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002503', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002503","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select * from public.set_own_daily_problem_completion(25001, true) $$,
  '42501',
  'Approved member access required.',
  'a suspended member cannot write completion records'
);

select throws_ok(
  $$ select * from public.list_daily_problem_comments(25001, 50, null) $$,
  '42501',
  'Approved member access required.',
  'a suspended member cannot read member discussion'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002504', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002504","role":"authenticated"}',
  true
);
set local role authenticated;

select ok(
  exists (
    select 1
    from public.list_daily_problem_comments(25001, 50, null)
    where comment_id = 25012 and visibility = 'hidden'
  ),
  'an approved administrator can inspect hidden comments for restoration'
);

select is(
  (select count(*)::integer from public.admin_list_daily_problems(50, null)),
  3,
  'an approved administrator can list draft, future, and published problems'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002501', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002501","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select * from public.admin_list_daily_problems(50, null) $$,
  '42501',
  'Administrator access required.',
  'an ordinary member cannot use the administrator daily problem API'
);

reset role;

select * from finish();

rollback;
