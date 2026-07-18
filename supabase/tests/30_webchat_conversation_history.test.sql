begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002901',
    'authenticated', 'authenticated', 'history-member-a@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"History Member A"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002902',
    'authenticated', 'authenticated', 'history-member-b@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"History Member B"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002903',
    'authenticated', 'authenticated', 'history-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"History Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-000000002901' then 'History Member A'
    when '00000000-0000-0000-0000-000000002902' then 'History Member B'
    else 'History Administrator'
  end,
  qq = case id
    when '00000000-0000-0000-0000-000000002901' then '12900000001'
    when '00000000-0000-0000-0000-000000002902' then '12900000002'
    else '12900000003'
  end,
  grade = '24级',
  major = '计算机科学与技术',
  role = case
    when id = '00000000-0000-0000-0000-000000002903'
      then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  approved_at = now();

select has_table('private', 'webchat_conversations', 'private conversation table exists');
select has_table('private', 'webchat_messages', 'private message table exists');
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'private'
      and tablename = 'webchat_conversations'
      and indexname = 'webchat_conversations_user_activity_idx'
  ),
  'history list has a user/activity cursor index'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'private.webchat_conversations', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'private.webchat_messages', 'SELECT')
    and not pg_catalog.has_table_privilege('service_role', 'private.webchat_messages', 'SELECT'),
  'browsers and the Edge service cannot read transcript tables directly'
);

select ok(
  (
    select pg_catalog.bool_and(class.relrowsecurity)
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'private'
      and class.relname in ('webchat_conversations', 'webchat_messages')
  ),
  'both private history tables keep row-level security enabled'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.list_own_webchat_conversations(integer,timestamptz,uuid)',
    'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'authenticated',
      'public.load_own_webchat_messages(uuid)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.load_own_webchat_messages(uuid)',
      'EXECUTE'
    ),
  'only authenticated callers receive own-history RPC access'
);

select is(
  (select count(*)::integer from cron.job where jobname = 'webchat-history-retention'),
  1,
  'one automatic WebChat history retention job is scheduled'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002901', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table history_a_first as
select * from public.create_own_webchat_conversation();

select public.upsert_own_webchat_message(
  (select id from history_a_first),
  'history-user-1',
  null,
  'ai-sdk/v6',
  '{"role":"user","parts":[{"type":"text","text":"请解释二分答案"}]}'::jsonb
);
select public.upsert_own_webchat_message(
  (select id from history_a_first),
  'history-assistant-1',
  'history-user-1',
  'ai-sdk/v6',
  '{"role":"assistant","parts":[{"type":"text","text":"先确认单调性。"}]}'::jsonb
);
select public.rename_own_webchat_conversation(
  (select id from history_a_first),
  '二分答案边界'
);

create temporary table history_a_second as
select * from public.create_own_webchat_conversation();

reset role;
select ok(
  exists (
    select 1
    from private.webchat_conversations
    where id = (select id from history_a_first)
      and user_id = '00000000-0000-0000-0000-000000002901'
      and title = '二分答案边界'
      and message_count = 2
      and content_bytes > 0
  ),
  'message upserts update bounded conversation metadata and title'
);
set local role authenticated;

select results_eq(
  $$
    select id, parent_id
    from public.load_own_webchat_messages((select id from history_a_first))
    order by position
  $$,
  $$ values
    ('history-user-1'::text, null::text),
    ('history-assistant-1'::text, 'history-user-1'::text)
  $$,
  'the owner loads the linear AI SDK message repository in order'
);

select is(
  (
    select count(*)::integer
    from public.list_own_webchat_conversations(31, null, null)
  ),
  2,
  'the owner history list contains both own conversations'
);

select throws_ok(
  $$
    select public.upsert_own_webchat_message(
      (select id from history_a_first),
      'history-orphan',
      'missing-parent',
      'ai-sdk/v6',
      '{"role":"user","parts":[{"type":"text","text":"orphan"}]}'::jsonb
    )
  $$,
  '23503',
  'Stored WebChat parent message was not found.',
  'orphaned message chains are rejected'
);

select public.set_own_webchat_conversation_archived((select id from history_a_second), true);

select is(
  (
    select status
    from public.get_own_webchat_conversation((select id from history_a_second))
  ),
  'archived',
  'owners can archive their own conversation metadata'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002902', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002902","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table history_b_first as
select * from public.create_own_webchat_conversation();

select ok(
  not exists (
    select 1
    from public.get_own_webchat_conversation((select id from history_a_first))
  ),
  'another member cannot discover conversation metadata by UUID'
);

select throws_ok(
  $$ select public.rename_own_webchat_conversation(
    (select id from history_a_first),
    '越权标题'
  ) $$,
  'P0002',
  'Conversation not found.',
  'another member cannot mutate a conversation by UUID'
);

select is(
  (select count(*)::integer from public.list_own_webchat_conversations(31, null, null)),
  1,
  'another member list remains isolated to their own history'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002903', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002903","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select * from public.load_own_webchat_messages((select id from history_a_first)) $$,
  'P0002',
  'Conversation not found.',
  'administrators cannot read a member transcript through own-history RPCs'
);

reset role;

insert into private.webchat_conversations (
  id, user_id, title, last_message_at, created_at, updated_at
)
values (
  '29000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000002902',
  'Expired conversation',
  pg_catalog.clock_timestamp() - interval '181 days',
  pg_catalog.clock_timestamp() - interval '181 days',
  pg_catalog.clock_timestamp() - interval '181 days'
);

set local role service_role;
select is(
  public.purge_expired_webchat_conversations(),
  1,
  'the service-only retention job purges conversations after 180 days'
);
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002901', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002901","role":"authenticated"}',
  true
);
set local role authenticated;

select public.delete_own_webchat_conversation((select id from history_a_first));

reset role;
select ok(
  not exists (
    select 1 from private.webchat_messages
    where conversation_id = (select id from history_a_first)
  ),
  'deleting an owned conversation cascades all stored messages'
);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_like(
  $$ select * from public.list_own_webchat_conversations(31, null, null) $$,
  '%permission denied%',
  'anonymous visitors cannot list private WebChat history'
);

reset role;

select * from finish();

rollback;
