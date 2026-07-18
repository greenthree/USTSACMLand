begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002601',
    'authenticated', 'authenticated', 'daily-life-member@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Daily Lifecycle Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002602',
    'authenticated', 'authenticated', 'daily-life-other@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Daily Lifecycle Other"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002603',
    'authenticated', 'authenticated', 'daily-life-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Daily Lifecycle Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002604',
    'authenticated', 'authenticated', 'daily-life-former-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Daily Former Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-000000002601' then 'Daily Lifecycle Member'
    when '00000000-0000-0000-0000-000000002602' then 'Daily Lifecycle Other'
    when '00000000-0000-0000-0000-000000002603' then 'Daily Lifecycle Administrator'
    else 'Daily Former Administrator'
  end,
  qq = case id
    when '00000000-0000-0000-0000-000000002601' then '12600000001'
    when '00000000-0000-0000-0000-000000002602' then '12600000002'
    when '00000000-0000-0000-0000-000000002603' then '12600000003'
    else '12600000004'
  end,
  grade = '24级',
  major = '软件工程',
  role = case
    when id in (
      '00000000-0000-0000-0000-000000002603',
      '00000000-0000-0000-0000-000000002604'
    ) then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  approved_at = now();

insert into public.daily_problems (
  id, problem_date, title, source_platform, external_problem_id, source_url,
  difficulty, tags, training_note, estimated_minutes, status, published_at,
  created_by, updated_by
)
overriding system value
values (
  26002,
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 2,
  'Discussion lifecycle fixture',
  'Nowcoder',
  'NC-1001',
  'https://ac.nowcoder.com/acm/problem/1001',
  '基础',
  array['discussion'],
  '用于讨论和注销生命周期测试。',
  25,
  'published',
  pg_catalog.clock_timestamp() - interval '2 days',
  '00000000-0000-0000-0000-000000002603',
  '00000000-0000-0000-0000-000000002603'
);

create temporary table created_problem (
  problem_id bigint,
  problem_updated_at timestamptz
) on commit drop;
create temporary table updated_problem (like created_problem) on commit drop;
create temporary table archived_problem (like created_problem) on commit drop;
create temporary table draft_problem (like created_problem) on commit drop;
create temporary table created_comment (
  comment_id bigint,
  created_at timestamptz,
  updated_at timestamptz
) on commit drop;
create temporary table hidden_comment (
  comment_id bigint,
  comment_visible boolean,
  comment_updated_at timestamptz
) on commit drop;
create temporary table restored_comment (like hidden_comment) on commit drop;

grant all on created_problem, updated_problem, archived_problem, draft_problem,
  created_comment, hidden_comment, restored_comment to authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002603', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002603","role":"authenticated"}',
  true
);
set local role authenticated;

insert into created_problem
select *
from public.admin_upsert_daily_problem(
  null,
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 1,
  '  Managed daily problem  ',
  ' Codeforces ',
  ' CF-4A ',
  ' https://codeforces.com/problemset/problem/4/A ',
  ' 入门 ',
  array[' math ', 'implementation', 'math'],
  '  先判断奇偶，再考虑边界。  ',
  null,
  'published',
  null
);

select ok(
  exists (
    select 1
    from public.admin_list_daily_problems(50, null) as problem
    join created_problem as created on created.problem_id = problem.problem_id
    where problem.title = 'Managed daily problem'
      and problem.source_platform = 'Codeforces'
      and problem.external_problem_id = 'CF-4A'
      and problem.tags = array['math', 'implementation']
      and problem.estimated_minutes is null
      and problem.status = 'published'
  ),
  'administrator creation normalizes fields, deduplicates tags, and accepts a null estimate'
);

select ok(
  exists (
    select 1
    from public.read_daily_problem_feed(20, null) as problem
    join created_problem as created on created.problem_id = problem.problem_id
  ),
  'a newly published past-date problem enters the public feed'
);

select ok(
  exists (
    select 1
    from public.audit_logs as log
    join created_problem as created on log.target_id = created.problem_id::text
    where log.target_table = 'daily_problems'
      and log.action = 'insert'
      and log.actor_id = '00000000-0000-0000-0000-000000002603'
  ),
  'daily problem creation is audited with the administrator identity'
);

insert into updated_problem
select *
from public.admin_upsert_daily_problem(
  (select problem_id from created_problem),
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 1,
  'Managed daily problem v2',
  'Codeforces',
  'CF-4A',
  'https://codeforces.com/problemset/problem/4/A',
  '入门',
  array['math', 'implementation'],
  '补充证明为什么 2 不是可拆分答案。',
  30,
  'published',
  (select problem_updated_at from created_problem)
);

select ok(
  (
    select updated.problem_updated_at > created.problem_updated_at
    from updated_problem as updated
    cross join created_problem as created
  ),
  'a valid optimistic update advances the monotonic version timestamp'
);

select throws_ok(
  $$
    select *
    from public.admin_upsert_daily_problem(
      (select problem_id from created_problem),
      (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 1,
      'Stale overwrite',
      'Codeforces',
      'CF-4A',
      'https://codeforces.com/problemset/problem/4/A',
      '入门',
      array['math'],
      '不应保存。',
      20,
      'published',
      (select problem_updated_at from created_problem)
    )
  $$,
  'PT409',
  'Daily problem changed after it was loaded. Refresh and try again.',
  'stale administrator writes return HTTP 409 semantics'
);

select throws_ok(
  $$
    select public.admin_delete_daily_problem(
      (select problem_id from updated_problem),
      (select problem_updated_at from updated_problem)
    )
  $$,
  '22023',
  'Published daily problems cannot be deleted; archive them instead.',
  'a published daily problem cannot be physically deleted'
);

insert into archived_problem
select *
from public.admin_upsert_daily_problem(
  (select problem_id from updated_problem),
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 1,
  'Managed daily problem v2',
  'Codeforces',
  'CF-4A',
  'https://codeforces.com/problemset/problem/4/A',
  '入门',
  array['math', 'implementation'],
  '补充证明为什么 2 不是可拆分答案。',
  30,
  'archived',
  (select problem_updated_at from updated_problem)
);

select ok(
  exists (
    select 1
    from public.admin_list_daily_problems(50, null) as problem
    join archived_problem as archived on archived.problem_id = problem.problem_id
    where problem.status = 'archived' and problem.archived_at is not null
  ),
  'published content remains stored when an administrator archives it'
);

select ok(
  not exists (
    select 1
    from public.read_daily_problem_feed(20, null) as problem
    join archived_problem as archived on archived.problem_id = problem.problem_id
  ),
  'archived content leaves the public feed'
);

select throws_ok(
  $$
    select *
    from public.admin_upsert_daily_problem(
      null,
      (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 20,
      'Unsafe URL fixture',
      'Example',
      'EX-1',
      'https://user:password@example.test/problem/1',
      null,
      '{}'::text[],
      '此请求必须失败。',
      null,
      'draft',
      null
    )
  $$,
  '22023',
  'Daily problem source URL must be an HTTPS URL.',
  'administrator writes reject HTTPS URLs containing authority userinfo'
);

insert into draft_problem
select *
from public.admin_upsert_daily_problem(
  null,
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 10,
  'Deletable draft',
  'AtCoder',
  'ABC001_A',
  'https://atcoder.jp/contests/abc001/tasks/abc001_1',
  null,
  '{}'::text[],
  '尚未发布，可物理删除。',
  null,
  'draft',
  null
);

select ok(
  public.admin_delete_daily_problem(
    (select problem_id from draft_problem),
    (select problem_updated_at from draft_problem)
  ),
  'a never-published draft can be physically deleted'
);

select ok(
  exists (
    select 1
    from public.audit_logs as log
    join draft_problem as draft on log.target_id = draft.problem_id::text
    where log.target_table = 'daily_problems' and log.action = 'delete'
  ),
  'draft deletion is audited'
);

reset role;

insert into public.admin_rate_limit_buckets (
  actor_id, action_key, window_started_at, request_count
)
values (
  '00000000-0000-0000-0000-000000002603',
  'daily_problem.write',
  pg_catalog.clock_timestamp(),
  30
)
on conflict (actor_id, action_key) do update
set
  window_started_at = excluded.window_started_at,
  request_count = excluded.request_count;

set local role authenticated;

select throws_ok(
  $$ select public.admin_delete_daily_problem(26002, now()) $$,
  'PT429',
  'admin_rate_limited',
  'daily problem administrator writes return HTTP 429 after quota exhaustion'
);

reset role;
delete from public.admin_rate_limit_buckets
where actor_id = '00000000-0000-0000-0000-000000002603'
  and action_key = 'daily_problem.write';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002601', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated"}',
  true
);
set local role authenticated;

insert into created_comment
select *
from public.create_daily_problem_comment(
  26002,
  'Lifecycle moderation comment.'
);

select ok(
  exists (
    select 1
    from public.list_daily_problem_comments(26002, 50, null) as comment
    join created_comment as created on created.comment_id = comment.comment_id
    where comment.author_id = '00000000-0000-0000-0000-000000002601'
  ),
  'member discussion creation derives and returns the authenticated author'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002603', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002603","role":"authenticated"}',
  true
);
set local role authenticated;

insert into hidden_comment
select *
from public.admin_set_daily_problem_comment_visibility(
  (select comment_id from created_comment),
  false,
  'Off-topic moderation fixture.',
  (select updated_at from created_comment)
);

select ok(
  (select not comment_visible from hidden_comment),
  'an administrator can hide a member comment'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002601', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002601","role":"authenticated"}',
  true
);
set local role authenticated;

select ok(
  not exists (
    select 1
    from public.list_daily_problem_comments(26002, 50, null) as comment
    join created_comment as created on created.comment_id = comment.comment_id
  ),
  'hidden comments disappear from the member discussion view'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002603', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002603","role":"authenticated"}',
  true
);
set local role authenticated;

select ok(
  exists (
    select 1
    from public.list_daily_problem_comments(26002, 50, null) as comment
    join created_comment as created on created.comment_id = comment.comment_id
    where comment.visibility = 'hidden'
  ),
  'administrators retain access to hidden comments for restoration'
);

select throws_ok(
  $$
    select *
    from public.admin_set_daily_problem_comment_visibility(
      (select comment_id from created_comment),
      true,
      'Stale restore fixture.',
      (select updated_at from created_comment)
    )
  $$,
  'PT409',
  'Comment changed after it was loaded. Refresh and try again.',
  'stale comment moderation returns HTTP 409 semantics'
);

insert into restored_comment
select *
from public.admin_set_daily_problem_comment_visibility(
  (select comment_id from hidden_comment),
  true,
  'Restored after review.',
  (select comment_updated_at from hidden_comment)
);

select ok(
  (select comment_visible from restored_comment),
  'an administrator can restore a hidden member comment'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs as log
    join created_comment as created on log.target_id = created.comment_id::text
    where log.target_table = 'daily_problem_comments'
      and log.action in ('hide', 'restore')
      and log.actor_id = '00000000-0000-0000-0000-000000002603'
      and log.metadata ->> 'reason' in (
        'Off-topic moderation fixture.',
        'Restored after review.'
      )
  ),
  2,
  'comment hide and restore operations are both audited'
);

reset role;

insert into public.daily_problem_completions (problem_id, profile_id)
values (26002, '00000000-0000-0000-0000-000000002601');

select is(
  (
    (select count(*) from public.daily_problem_completions
      where profile_id = '00000000-0000-0000-0000-000000002601')
    + (select count(*) from public.daily_problem_comments
      where author_id = '00000000-0000-0000-0000-000000002601')
  )::integer,
  2,
  'the member has one completion and one discussion row before deletion'
);

do $$
begin
  if not public.acquire_account_deletion_recovery_lease(
    '26000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000002601'
  ) then
    raise exception 'Could not acquire member deletion lifecycle lease';
  end if;
  perform pg_catalog.set_config(
    'app.account_deletion_owner_token',
    '26000000-0000-4000-8000-000000000001',
    true
  );
  perform pg_catalog.set_config(
    'app.account_deletion_target_user_id',
    '00000000-0000-0000-0000-000000002601',
    true
  );
end;
$$;

delete from auth.users
where id = '00000000-0000-0000-0000-000000002601';

select public.release_account_deletion_recovery_lease(
  '26000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000002601'
);

select is(
  (
    (select count(*) from public.daily_problem_completions
      where profile_id = '00000000-0000-0000-0000-000000002601')
    + (select count(*) from public.daily_problem_comments
      where author_id = '00000000-0000-0000-0000-000000002601')
  )::integer,
  0,
  'account deletion cascades member completion and discussion identities'
);

insert into public.daily_problems (
  id, problem_date, title, source_platform, external_problem_id, source_url,
  difficulty, tags, training_note, estimated_minutes, status, published_at,
  created_by, updated_by
)
overriding system value
values (
  26003,
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 3,
  'Former administrator reference fixture',
  'Luogu',
  'P1000',
  'https://www.luogu.com.cn/problem/P1000',
  '入门',
  array['output'],
  '用于管理员注销匿名化测试。',
  10,
  'published',
  pg_catalog.clock_timestamp() - interval '3 days',
  '00000000-0000-0000-0000-000000002604',
  '00000000-0000-0000-0000-000000002604'
);

insert into public.daily_problem_comments (
  id, problem_id, author_id, body, is_visible, hidden_at, hidden_by
)
overriding system value
values (
  26004,
  26003,
  '00000000-0000-0000-0000-000000002602',
  'Former administrator moderation fixture.',
  false,
  pg_catalog.clock_timestamp(),
  '00000000-0000-0000-0000-000000002604'
);

insert into public.audit_logs (
  actor_id, action, target_table, target_id, before_data, after_data, metadata
)
values (
  '00000000-0000-0000-0000-000000002604',
  'daily_problem_admin_fixture',
  'daily_problems',
  '26003',
  pg_catalog.jsonb_build_object(
    'created_by', '00000000-0000-0000-0000-000000002604'
  ),
  pg_catalog.jsonb_build_object(
    'updated_by', '00000000-0000-0000-0000-000000002604'
  ),
  pg_catalog.jsonb_build_object(
    'moderator_id', '00000000-0000-0000-0000-000000002604'
  )
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000002603', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000002603","role":"authenticated"}',
  true
);

update public.profiles
set role = 'member'
where id = '00000000-0000-0000-0000-000000002604';

do $$
begin
  if not public.acquire_account_deletion_recovery_lease(
    '26000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000002604'
  ) then
    raise exception 'Could not acquire former administrator deletion lifecycle lease';
  end if;
  perform pg_catalog.set_config(
    'app.account_deletion_owner_token',
    '26000000-0000-4000-8000-000000000002',
    true
  );
  perform pg_catalog.set_config(
    'app.account_deletion_target_user_id',
    '00000000-0000-0000-0000-000000002604',
    true
  );
end;
$$;

delete from auth.users
where id = '00000000-0000-0000-0000-000000002604';

select public.release_account_deletion_recovery_lease(
  '26000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000002604'
);

select ok(
  (
    select created_by is null and updated_by is null
    from public.daily_problems
    where id = 26003
  )
    and (
      select hidden_by is null
      from public.daily_problem_comments
      where id = 26004
    ),
  'former administrator Auth references are cleared without deleting learning content'
);

select ok(
  not exists (
    select 1
    from public.audit_logs as log
    where concat_ws(
      ' ',
      log.actor_id::text,
      log.target_id,
      log.before_data::text,
      log.after_data::text,
      log.metadata::text
    ) like '%00000000-0000-0000-0000-000000002604%'
  ),
  'former administrator UUID is not reintroduced into audit rows during deletion cleanup'
);

select * from finish();

rollback;
