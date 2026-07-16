begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000a1',
    'authenticated', 'authenticated', 'member-a@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Member A"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000b2',
    'authenticated', 'authenticated', 'member-b@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Member B"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000c3',
    'authenticated', 'authenticated', 'admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  qq = case id
    when '00000000-0000-0000-0000-0000000000a1' then '10000000001'
    when '00000000-0000-0000-0000-0000000000b2' then '10000000002'
    else '10000000003'
  end,
  grade = '24级',
  major = '计算机科学与技术',
  role = case
    when id = '00000000-0000-0000-0000-0000000000c3' then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  approved_at = now();

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status
)
values (
  '00000000-0000-0000-0000-0000000000a1',
  'codeforces',
  'MemberA',
  'membera',
  'verified'
);

insert into public.platform_stats (
  profile_id, platform, solved_count, status, last_success_at
)
values (
  '00000000-0000-0000-0000-0000000000a1', 'codeforces', 10, 'fresh', now()
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.profiles),
  1,
  'a member can select only their own private profile'
);

select is(
  (select full_name from public.profiles),
  'Member A',
  'the visible private profile belongs to the authenticated member'
);

update public.profiles
set full_name = 'Hijacked Member B'
where id = '00000000-0000-0000-0000-0000000000b2';

reset role;

select is(
  (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  'Member B',
  'a member cannot update another member profile'
);

set local role authenticated;

select throws_like(
  $$
    update public.profiles
    set role = 'admin'
    where id = '00000000-0000-0000-0000-0000000000a1'
  $$,
  '%permission denied%',
  'a member cannot promote their own role'
);

select throws_like(
  $$
    insert into public.platform_accounts (
      profile_id, platform, external_id, normalized_external_id
    )
    values (
      '00000000-0000-0000-0000-0000000000b2', 'atcoder', 'member_b', 'member_b'
    )
  $$,
  '%row-level security policy%',
  'a member cannot bind an account to another profile'
);

update public.platform_accounts
set external_id = 'xcpc_deadbeefdeadbeef'
where profile_id = '00000000-0000-0000-0000-0000000000a1'
  and platform = 'xcpc_elo';

reset role;

select ok(
  not exists (
    select 1
    from public.platform_accounts
    where profile_id = '00000000-0000-0000-0000-0000000000a1'
      and platform = 'xcpc_elo'
      and external_id = 'xcpc_deadbeefdeadbeef'
  ),
  'a member cannot modify their automatic XCPC ELO account'
);

set local role authenticated;

select throws_like(
  $$
    insert into public.platform_stats (profile_id, platform, solved_count, status)
    values ('00000000-0000-0000-0000-0000000000a1', 'codeforces', 999, 'fresh')
  $$,
  '%permission denied%',
  'a member cannot write platform statistics directly'
);

reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}',
  true
);
set local role authenticated;

select public.admin_set_member_suspension(
  '00000000-0000-0000-0000-0000000000a1',
  true,
  (select updated_at from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'RLS suspension fixture'
);

reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}',
  true
);

set local role authenticated;

update public.profiles
set full_name = 'Suspended Edit'
where id = '00000000-0000-0000-0000-0000000000a1';

reset role;

select is(
  (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'Member A',
  'a suspended member cannot edit their profile'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.profiles),
  3,
  'an administrator can read all private profiles'
);

update public.profiles
set full_name = 'Direct Administrator Edit'
where id = '00000000-0000-0000-0000-0000000000b2';

reset role;

select is(
  (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  'Member B',
  'an administrator cannot bypass the member management RPC with a direct update'
);

set local role authenticated;

select public.admin_update_member_profile(
  '00000000-0000-0000-0000-0000000000b2',
  'Member B Updated',
  '10000000002',
  '24级',
  '软件工程',
  true,
  (select updated_at from public.profiles where id = '00000000-0000-0000-0000-0000000000b2')
);

reset role;

select is(
  (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  'Member B Updated',
  'an administrator can update a member through the controlled RPC'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select public.admin_update_member_profile(
      '00000000-0000-0000-0000-0000000000b2',
      'Forbidden Update',
      '10000000002',
      '24级',
      '软件工程',
      true,
      now()
    )
  $$,
  '42501',
  'Administrator access required.',
  'a member cannot call the administrator profile update RPC'
);

reset role;

select throws_ok(
  $$
    update public.profiles
    set qq = '10000000001'
    where id = '00000000-0000-0000-0000-0000000000b2'
  $$,
  '23505',
  'QQ numbers cannot be shared by two member profiles'
);

select throws_ok(
  $$
    insert into public.platform_accounts (
      profile_id, platform, external_id, normalized_external_id, status
    ) values (
      '00000000-0000-0000-0000-0000000000b2',
      'codeforces',
      'MEMBERA',
      'membera',
      'verified'
    )
  $$,
  '23505',
  'one normalized platform account cannot be bound to two members'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_like(
  $$ select * from public.profiles $$,
  '%permission denied%',
  'anonymous visitors cannot read private profiles'
);

select throws_like(
  $$ select * from public.platform_accounts $$,
  '%permission denied%',
  'anonymous visitors cannot read private platform bindings'
);

select is(
  (select count(*)::integer from public.public_members),
  2,
  'anonymous visitors can read only complete, public, active members'
);

select is(
  (select count(*)::integer from public.public_platform_accounts),
  0,
  'public platform bindings exclude a suspended member'
);

select is(
  (select count(*)::integer from public.public_platform_stats),
  0,
  'public statistics exclude a suspended member'
);

select is(
  (select count(*)::integer from public.public_stat_snapshots),
  0,
  'anonymous visitors can query the public snapshot view'
);

select is(
  (select count(*)::integer from public.public_announcements),
  0,
  'anonymous visitors can query the public announcement view'
);

reset role;

update public.profiles
set is_public = false
where id = '00000000-0000-0000-0000-0000000000b2';

update public.profiles
set major = null
where id = '00000000-0000-0000-0000-0000000000c3';

set local role anon;

select is(
  (select count(*)::integer from public.public_members),
  0,
  'anonymous member view excludes private and incomplete profiles'
);

reset role;

select * from finish();

rollback;
