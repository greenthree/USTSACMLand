begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000001a1',
    'authenticated', 'authenticated', 'rpc-member@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"RPC Matrix Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000001b2',
    'authenticated', 'authenticated', 'rpc-suspended@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"RPC Matrix Suspended"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  qq = case id
    when '00000000-0000-0000-0000-0000000001a1' then '15555550001'
    else '15555550002'
  end,
  full_name = case id
    when '00000000-0000-0000-0000-0000000001a1' then 'RPC Matrix Member'
    else 'RPC Matrix Suspended'
  end,
  grade = '24级',
  major = '计算机科学与技术',
  role = 'member',
  review_status = case id
    when '00000000-0000-0000-0000-0000000001a1'
      then 'approved'::public.profile_review_status
    else 'suspended'::public.profile_review_status
  end,
  approved_at = now();

insert into public.platform_accounts (
  id, profile_id, platform, external_id, normalized_external_id, status, updated_at
)
overriding system value
values (
  99901,
  '00000000-0000-0000-0000-0000000001a1',
  'codeforces',
  'RpcMatrixMember',
  'rpcmatrixmember',
  'verified',
  now()
);

insert into public.announcements (
  id, title, body, status, created_at, updated_at
)
overriding system value
values (
  99902,
  'RPC matrix fixture',
  'Authorization matrix fixture.',
  'draft',
  now(),
  now()
);

create temporary table admin_rpc_matrix (
  signature regprocedure primary key,
  statement text not null
) on commit drop;

insert into admin_rpc_matrix (signature, statement)
values
  (
    'public.admin_get_overview()'::regprocedure,
    'select * from public.admin_get_overview()'
  ),
  (
    'public.admin_get_member_detail(uuid)'::regprocedure,
    $$select * from public.admin_get_member_detail(
      '00000000-0000-0000-0000-0000000001a1'
    )$$
  ),
  (
    'public.admin_get_source_health(integer)'::regprocedure,
    'select * from public.admin_get_source_health(168)'
  ),
  (
    'public.admin_list_audit_logs(integer,bigint)'::regprocedure,
    'select * from public.admin_list_audit_logs(50, null)'
  ),
  (
    'public.admin_list_platform_accounts()'::regprocedure,
    'select * from public.admin_list_platform_accounts()'
  ),
  (
    'public.admin_list_members()'::regprocedure,
    'select * from public.admin_list_members()'
  ),
  (
    'public.admin_list_announcements(integer,bigint)'::regprocedure,
    'select * from public.admin_list_announcements(50, null)'
  ),
  (
    'public.admin_list_member_activity(uuid,integer)'::regprocedure,
    $$select * from public.admin_list_member_activity(
      '00000000-0000-0000-0000-0000000001a1', 20
    )$$
  ),
  (
    'public.admin_list_active_sync_jobs(integer,bigint)'::regprocedure,
    'select * from public.admin_list_active_sync_jobs(50, null)'
  ),
  (
    'public.admin_list_sync_runs(integer,bigint)'::regprocedure,
    'select * from public.admin_list_sync_runs(50, null)'
  ),
  (
    'public.admin_set_platform_account_status(bigint,public.account_verification_status,text,timestamptz)'::regprocedure,
    $$select public.admin_set_platform_account_status(
      99901,
      'invalid'::public.account_verification_status,
      'authorization fixture',
      now()
    )$$
  ),
  (
    'public.admin_set_member_suspension(uuid,boolean,timestamptz,text)'::regprocedure,
    $$select public.admin_set_member_suspension(
      '00000000-0000-0000-0000-0000000001a1',
      true,
      now(),
      'authorization fixture'
    )$$
  ),
  (
    'public.admin_set_member_role(uuid,public.app_role,timestamptz,text)'::regprocedure,
    $$select public.admin_set_member_role(
      '00000000-0000-0000-0000-0000000001a1',
      'admin'::public.app_role,
      now(),
      'authorization fixture'
    )$$
  ),
  (
    'public.admin_set_manual_platform_stats(uuid,public.platform_name,numeric,numeric,integer,timestamptz,text,timestamptz)'::regprocedure,
    $$select * from public.admin_set_manual_platform_stats(
      '00000000-0000-0000-0000-0000000001a1',
      'codeforces'::public.platform_name,
      1500,
      1600,
      42,
      now(),
      'authorization fixture',
      null
    )$$
  ),
  (
    'public.admin_update_member_profile(uuid,text,text,text,text,boolean,timestamptz)'::regprocedure,
    $$select public.admin_update_member_profile(
      '00000000-0000-0000-0000-0000000001a1',
      'RPC Matrix Member',
      '15555550001',
      '24级',
      '计算机科学与技术',
      true,
      now()
    )$$
  ),
  (
    'public.admin_unbind_member_platform_account(uuid,public.platform_name,timestamptz)'::regprocedure,
    $$select public.admin_unbind_member_platform_account(
      '00000000-0000-0000-0000-0000000001a1',
      'codeforces'::public.platform_name,
      now()
    )$$
  ),
  (
    'public.admin_delete_announcement(bigint,timestamptz)'::regprocedure,
    'select public.admin_delete_announcement(99902, now())'
  ),
  (
    'public.admin_upsert_announcement(bigint,text,text,public.announcement_status,timestamptz,timestamptz,timestamptz)'::regprocedure,
    $$select * from public.admin_upsert_announcement(
      null,
      'Authorization fixture',
      'Authorization fixture body.',
      'draft'::public.announcement_status,
      null,
      null,
      null
    )$$
  ),
  (
    'public.admin_upsert_member_platform_account(uuid,public.platform_name,text,timestamptz)'::regprocedure,
    $$select * from public.admin_upsert_member_platform_account(
      '00000000-0000-0000-0000-0000000001a1',
      'atcoder'::public.platform_name,
      'rpc_matrix_member',
      null
    )$$
  ),
  (
    'public.admin_list_daily_problems(integer,bigint)'::regprocedure,
    'select * from public.admin_list_daily_problems(50, null)'
  ),
  (
    'public.admin_upsert_daily_problem(bigint,date,text,text,text,text,text,text[],text,integer,public.daily_problem_status,timestamptz)'::regprocedure,
    $$select * from public.admin_upsert_daily_problem(
      null,
      current_date,
      'Authorization fixture',
      'Codeforces',
      'CF-1A',
      'https://codeforces.com/problemset/problem/1/A',
      '入门',
      array['implementation'],
      'Authorization fixture.',
      20,
      'draft'::public.daily_problem_status,
      null
    )$$
  ),
  (
    'public.admin_delete_daily_problem(bigint,timestamptz)'::regprocedure,
    'select public.admin_delete_daily_problem(99903, now())'
  ),
  (
    'public.admin_set_daily_problem_comment_visibility(bigint,boolean,text,timestamptz)'::regprocedure,
    $$select * from public.admin_set_daily_problem_comment_visibility(
      99904,
      false,
      'authorization fixture',
      now()
    )$$
  ),
  (
    'public.admin_get_webchat_member_access(uuid)'::regprocedure,
    $$select * from public.admin_get_webchat_member_access(
      '00000000-0000-0000-0000-0000000001a1'
    )$$
  ),
  (
    'public.admin_list_webchat_pilot_members()'::regprocedure,
    'select * from public.admin_list_webchat_pilot_members()'
  ),
  (
    'public.admin_read_webchat_cache_summary()'::regprocedure,
    'select * from public.admin_read_webchat_cache_summary()'
  ),
  (
    'public.admin_update_webchat_member_access(uuid,boolean,integer,bigint,bigint,text)'::regprocedure,
    $$select * from public.admin_update_webchat_member_access(
      '00000000-0000-0000-0000-0000000001a1',
      false,
      30,
      100000,
      0,
      'authorization fixture'
    )$$
  );

create temporary table admin_rpc_internal_matrix (
  signature regprocedure primary key
) on commit drop;

insert into admin_rpc_internal_matrix (signature)
values
  (
    'public.admin_set_member_suspension_unlimited(uuid,boolean,timestamptz,text)'::regprocedure
  ),
  (
    'public.admin_update_member_profile_unlimited(uuid,text,text,text,text,boolean,timestamptz)'::regprocedure
  ),
  (
    'public.admin_set_platform_account_status_unlimited(bigint,public.account_verification_status,text,timestamptz)'::regprocedure
  ),
  (
    'public.admin_upsert_member_platform_account_unlimited(uuid,public.platform_name,text,timestamptz)'::regprocedure
  ),
  (
    'public.admin_unbind_member_platform_account_unlimited(uuid,public.platform_name,timestamptz)'::regprocedure
  ),
  (
    'public.admin_set_manual_platform_stats_unlimited(uuid,public.platform_name,numeric,numeric,integer,timestamptz,text,timestamptz)'::regprocedure
  ),
  (
    'public.admin_upsert_announcement_unlimited(bigint,text,text,public.announcement_status,timestamptz,timestamptz,timestamptz)'::regprocedure
  ),
  (
    'public.admin_delete_announcement_unlimited(bigint,timestamptz)'::regprocedure
  ),
  (
    'public.admin_update_webchat_relay_config(uuid,text,text,text,bigint,text,boolean,integer,bigint)'::regprocedure
  );

create temporary table admin_rpc_matrix_results (
  actor_kind text not null,
  signature regprocedure not null,
  denied boolean not null
) on commit drop;

create function pg_temp.admin_rpc_denied(statement text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  execute statement;
  return false;
exception
  when insufficient_privilege then
    return sqlerrm = 'Administrator access required.';
  when others then
    return false;
end;
$$;

grant select on admin_rpc_matrix to authenticated;
grant insert on admin_rpc_matrix_results to authenticated;
grant execute on function pg_temp.admin_rpc_denied(text) to authenticated;

select set_eq(
  $$
    select proc.oid::regprocedure::text
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname like 'admin_%'
  $$,
  $$
    select signature::text from admin_rpc_matrix
    union all
    select signature::text from admin_rpc_internal_matrix
  $$,
  'the authorization manifest covers every administrator function'
);

select ok(
  not exists (
    select 1
    from admin_rpc_matrix
    where not pg_catalog.has_function_privilege(
      'authenticated', signature::oid, 'EXECUTE'
    )
      or pg_catalog.has_function_privilege('anon', signature::oid, 'EXECUTE')
  ),
  'authenticated users can reach every front-door administrator RPC while anonymous users cannot'
);

select ok(
  not exists (
    select 1
    from admin_rpc_internal_matrix
    where pg_catalog.has_function_privilege('authenticated', signature::oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', signature::oid, 'EXECUTE')
  ),
  'browser roles cannot execute administrator unlimited implementation functions'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-0000000001a1',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000001a1","role":"authenticated"}',
  true
);
set local role authenticated;

insert into admin_rpc_matrix_results (actor_kind, signature, denied)
select 'member', signature, pg_temp.admin_rpc_denied(statement)
from admin_rpc_matrix;

reset role;

select is(
  coalesce(
    (
      select pg_catalog.array_agg(signature::text order by signature::text)
      from admin_rpc_matrix_results
      where actor_kind = 'member' and not denied
    ),
    array[]::text[]
  ),
  array[]::text[],
  'an ordinary member receives the fixed administrator denial from every exposed admin RPC'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-0000000001b2',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000001b2","role":"authenticated"}',
  true
);
set local role authenticated;

insert into admin_rpc_matrix_results (actor_kind, signature, denied)
select 'suspended', signature, pg_temp.admin_rpc_denied(statement)
from admin_rpc_matrix;

reset role;

select is(
  coalesce(
    (
      select pg_catalog.array_agg(signature::text order by signature::text)
      from admin_rpc_matrix_results
      where actor_kind = 'suspended' and not denied
    ),
    array[]::text[]
  ),
  array[]::text[],
  'a suspended member receives the fixed administrator denial from every exposed admin RPC'
);

select * from finish();

rollback;
