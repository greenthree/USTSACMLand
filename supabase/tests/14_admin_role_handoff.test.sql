begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000f1',
    'authenticated', 'authenticated', 'handoff-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Handoff Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000f2',
    'authenticated', 'authenticated', 'handoff-member@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Handoff Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000f3',
    'authenticated', 'authenticated', 'suspended-candidate@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Suspended Candidate"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  qq = case id
    when '00000000-0000-0000-0000-0000000000f1' then '10000000101'
    when '00000000-0000-0000-0000-0000000000f2' then '10000000102'
    else '10000000103'
  end,
  grade = '24级',
  major = '计算机科学与技术',
  role = case
    when id = '00000000-0000-0000-0000-0000000000f1' then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = case
    when id = '00000000-0000-0000-0000-0000000000f3'
      then 'suspended'::public.profile_review_status
    else 'approved'::public.profile_review_status
  end,
  approved_at = case
    when id = '00000000-0000-0000-0000-0000000000f3' then null
    else now()
  end;

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.admin_set_member_role(uuid,public.app_role,timestamptz,text)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'anon',
    'public.admin_set_member_role(uuid,public.app_role,timestamptz,text)',
    'EXECUTE'
  ),
  'only authenticated sessions can reach the controlled role handoff RPC'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select public.admin_set_member_role(
      '00000000-0000-0000-0000-0000000000f2',
      'admin',
      (select updated_at from public.profiles where id = '00000000-0000-0000-0000-0000000000f2'),
      'Self promotion attempt'
    )
  $$,
  '42501',
  'Administrator access required.',
  'a member cannot promote themselves'
);

reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select public.admin_set_member_role(
      '00000000-0000-0000-0000-0000000000f2',
      'admin',
      (select updated_at from public.profiles where id = '00000000-0000-0000-0000-0000000000f2'),
      'Transfer administrator responsibility'
    )
  $$,
  'an active administrator can promote an active member'
);

select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000f2'),
  'admin',
  'the promoted profile receives the administrator role'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where action = 'admin_role_change'
      and target_id = '00000000-0000-0000-0000-0000000000f2'
      and metadata ->> 'reason' = 'Transfer administrator responsibility'
  ),
  'administrator promotion records a bounded audit reason'
);

select throws_ok(
  $$
    select public.admin_set_member_role(
      '00000000-0000-0000-0000-0000000000f2',
      'member',
      (select updated_at - interval '1 second' from public.profiles where id = '00000000-0000-0000-0000-0000000000f2'),
      'Stale administrator change'
    )
  $$,
  '40001',
  'Profile changed after it was loaded. Refresh and try again.',
  'role changes require the latest optimistic-lock timestamp'
);

select lives_ok(
  $$
    select public.admin_set_member_role(
      '00000000-0000-0000-0000-0000000000f1',
      'member',
      (select updated_at from public.profiles where id = '00000000-0000-0000-0000-0000000000f1'),
      'Complete administrator handoff'
    )
  $$,
  'an administrator can demote themselves after another active admin exists'
);

select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000f1'),
  'member',
  'the previous administrator becomes an ordinary member'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where action = 'admin_role_change'
      and target_id = '00000000-0000-0000-0000-0000000000f1'
      and metadata ->> 'reason' = 'Complete administrator handoff'
  ),
  'administrator demotion records its handoff reason'
);

reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select public.admin_set_member_role(
      '00000000-0000-0000-0000-0000000000f2',
      'member',
      (select updated_at from public.profiles where id = '00000000-0000-0000-0000-0000000000f2'),
      'Remove final administrator'
    )
  $$,
  '23514',
  'At least one active administrator must remain.',
  'the final active administrator cannot be demoted'
);

select is(
  (select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000f2'),
  'admin',
  'a rejected last-admin demotion leaves the role unchanged'
);

select throws_ok(
  $$
    select public.admin_set_member_role(
      '00000000-0000-0000-0000-0000000000f3',
      'admin',
      (select updated_at from public.profiles where id = '00000000-0000-0000-0000-0000000000f3'),
      'Suspended candidate promotion'
    )
  $$,
  '22023',
  'Only active profiles can change administrator role.',
  'a suspended profile cannot be promoted'
);

select set_eq(
  $$
    select id::text, role::text, review_status::text
    from public.admin_list_members()
  $$,
  $$
    values
      ('00000000-0000-0000-0000-0000000000f1'::text, 'member'::text, 'approved'::text),
      ('00000000-0000-0000-0000-0000000000f2'::text, 'admin'::text, 'approved'::text),
      ('00000000-0000-0000-0000-0000000000f3'::text, 'member'::text, 'suspended'::text)
  $$,
  'the administrator directory exposes member roles needed for handoff'
);

reset role;

select * from finish();

rollback;
