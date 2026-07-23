begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

update private.referral_program_config
set reopen_allowed = true
where singleton;

update private.referral_program_config
set enabled = true, version = version + 1, updated_at = pg_catalog.clock_timestamp()
where singleton;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000004301',
  'authenticated', 'authenticated', 'confirmed-referral-owner@example.test',
  'test-password', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Confirmed Referral Owner"}'::jsonb,
  now(), now(), '', '', '', ''
);

create temporary table confirmed_referral_owner_code as
select code
from private.referral_codes
where inviter_id = '00000000-0000-4000-8000-000000004301';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000004302',
  'authenticated', 'authenticated', 'pending-referral-invitee@example.test',
  'test-password', null,
  '{"provider":"email","providers":["email"]}'::jsonb,
  pg_catalog.jsonb_build_object(
    'full_name', 'Pending Referral Invitee',
    'referral_code', code
  ),
  now(), now(), '', '', '', ''
from confirmed_referral_owner_code;

select ok(
  exists (
    select 1 from public.profiles
    where id = '00000000-0000-4000-8000-000000004302'
  ),
  'an unconfirmed invitee can register normally'
);

select ok(
  not exists (
    select 1 from private.referral_bindings
    where invitee_id = '00000000-0000-4000-8000-000000004302'
  ),
  'registration does not bind an unconfirmed invitee'
);

select is(
  (
    select reward_count::integer from private.referral_codes
    where inviter_id = '00000000-0000-4000-8000-000000004301'
  ),
  0,
  'registration does not increment rewards before confirmation'
);

select is(
  (
    select total_token_limit from private.webchat_member_access
    where user_id = '00000000-0000-4000-8000-000000004301'
  ),
  5000000::bigint,
  'registration does not grant tokens before confirmation'
);

update auth.users
set email_confirmed_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
where id = '00000000-0000-4000-8000-000000004302';

select ok(
  exists (
    select 1 from private.referral_bindings
    where invitee_id = '00000000-0000-4000-8000-000000004302'
      and inviter_id = '00000000-0000-4000-8000-000000004301'
  ),
  'the first email confirmation creates the referral binding'
);

select is(
  (
    select reward_count::integer from private.referral_codes
    where inviter_id = '00000000-0000-4000-8000-000000004301'
  ),
  1,
  'the first email confirmation increments the reward count once'
);

select is(
  (
    select total_token_limit from private.webchat_member_access
    where user_id = '00000000-0000-4000-8000-000000004301'
  ),
  6000000::bigint,
  'the first email confirmation grants one million tokens'
);

select is(
  (
    select count(*)::integer from public.audit_logs
    where actor_id = '00000000-0000-4000-8000-000000004302'
      and action = 'referral_reward_granted'
  ),
  1,
  'the confirmed reward creates exactly one audit event'
);

update auth.users
set email_confirmed_at = email_confirmed_at + interval '1 second',
    updated_at = pg_catalog.clock_timestamp()
where id = '00000000-0000-4000-8000-000000004302';

select is(
  (
    select reward_count::integer from private.referral_codes
    where inviter_id = '00000000-0000-4000-8000-000000004301'
  ),
  1,
  'later confirmation timestamp writes remain idempotent'
);

update private.referral_program_config
set enabled = false, version = version + 1, updated_at = pg_catalog.clock_timestamp()
where singleton;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000004303',
  'authenticated', 'authenticated', 'paused-referral-invitee@example.test',
  'test-password', null,
  '{"provider":"email","providers":["email"]}'::jsonb,
  pg_catalog.jsonb_build_object(
    'full_name', 'Paused Referral Invitee',
    'referral_code', code
  ),
  now(), now(), '', '', '', ''
from confirmed_referral_owner_code;

select lives_ok(
  $sql$
    update auth.users
    set email_confirmed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where id = '00000000-0000-4000-8000-000000004303'
  $sql$,
  'email confirmation remains available while the referral program is paused'
);

select ok(
  not exists (
    select 1 from private.referral_bindings
    where invitee_id = '00000000-0000-4000-8000-000000004303'
  ),
  'a paused confirmation does not create a referral binding'
);

select is(
  (
    select reward_count::integer from private.referral_codes
    where inviter_id = '00000000-0000-4000-8000-000000004301'
  ),
  1,
  'a paused confirmation does not increment rewards'
);

update private.referral_program_config
set enabled = true, version = version + 1, updated_at = pg_catalog.clock_timestamp()
where singleton;

select throws_ok(
  $sql$
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-4000-8000-000000004304',
      'authenticated', 'authenticated', 'invalid-pending-referral@example.test',
      'test-password', null,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Invalid Pending Referral","referral_code":"INVALID"}'::jsonb,
      now(), now(), '', '', '', ''
    )
  $sql$,
  '22023',
  'Referral code is invalid or unavailable.',
  'registration still rejects an invalid referral before confirmation'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000004305',
  'authenticated', 'authenticated', 'immediately-confirmed-referral@example.test',
  'test-password', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  pg_catalog.jsonb_build_object(
    'full_name', 'Immediately Confirmed Referral',
    'referral_code', code
  ),
  now(), now(), '', '', '', ''
from confirmed_referral_owner_code;

select ok(
  exists (
    select 1 from private.referral_bindings
    where invitee_id = '00000000-0000-4000-8000-000000004305'
  ),
  'an already-confirmed registration receives its reward atomically'
);

select is(
  (
    select reward_count::integer from private.referral_codes
    where inviter_id = '00000000-0000-4000-8000-000000004301'
  ),
  2,
  'confirmed and auto-confirmed invitees produce two total rewards'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = 'auth.users'::regclass
      and trigger.tgname = 'auth_users_z_process_confirmed_referral'
      and not trigger.tgisinternal
  ),
  'Auth installs the email-confirmation referral trigger'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'private.process_profile_referral()', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'service_role', 'private.process_profile_referral()', 'EXECUTE'
    ),
  'browser and service roles cannot invoke the private trigger directly'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'private.process_profile_referral()'::regprocedure
  ),
  'the shared registration and confirmation trigger remains hardened'
);

select * from finish();

rollback;
