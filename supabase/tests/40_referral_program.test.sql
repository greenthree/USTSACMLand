begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

select has_table('private', 'referral_codes', 'private referral code table exists');
select has_table('private', 'referral_bindings', 'private referral binding table exists');

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'private.referral_codes'::regclass
  ) and (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'private.referral_bindings'::regclass
  ),
  'both private referral tables enable RLS'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'private.referral_codes', 'SELECT')
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.referral_codes', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.referral_bindings', 'SELECT'
    ),
  'browser roles cannot read private referral rows directly'
);

select ok(
  pg_catalog.has_function_privilege(
    'anon', 'public.validate_referral_code(text)', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.read_own_referral_summary()', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.read_own_referral_summary()', 'EXECUTE'
    ),
  'anonymous users can only check availability while members can read only their own summary'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004001',
    'authenticated', 'authenticated', 'referral-owner@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Referral Owner"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004002',
    'authenticated', 'authenticated', 'suspended-owner@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Suspended Owner"}'::jsonb,
    now(), now(), '', '', '', ''
  );

create temporary table referral_test_codes as
select inviter_id, code
from private.referral_codes
where inviter_id in (
  '00000000-0000-4000-8000-000000004001',
  '00000000-0000-4000-8000-000000004002'
);
grant select on referral_test_codes to anon;

select is(
  (select count(*)::integer from referral_test_codes),
  2,
  'every new profile receives a referral code'
);

select ok(
  (
    select count(*) = count(distinct code)
      and bool_and(code ~ '^[A-F0-9]{16}$')
    from referral_test_codes
  ),
  'generated codes are unique and contain no member identifiers'
);

set local role anon;
create temporary table referral_available_before as
select public.validate_referral_code(
  (select code from referral_test_codes
   where inviter_id = '00000000-0000-4000-8000-000000004001')
) as available;
reset role;

select is(
  (select available from referral_available_before),
  true,
  'an active owner code is available to registration'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000004101',
  'authenticated', 'authenticated', 'referral-invitee-1@example.test', 'test-password', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  pg_catalog.jsonb_build_object(
    'full_name', 'Referral Invitee 1',
    'referral_code', code
  ),
  now(), now(), '', '', '', ''
from referral_test_codes
where inviter_id = '00000000-0000-4000-8000-000000004001';

select ok(
  exists (
    select 1 from private.referral_bindings
    where invitee_id = '00000000-0000-4000-8000-000000004101'
      and inviter_id = '00000000-0000-4000-8000-000000004001'
      and reward_tokens = 1000000
  ),
  'registration metadata creates exactly one binding'
);

select is(
  (
    select reward_count::integer from private.referral_codes
    where inviter_id = '00000000-0000-4000-8000-000000004001'
  ),
  1,
  'the first valid binding increments the reward counter once'
);

select is(
  (
    select total_token_limit from private.webchat_member_access
    where user_id = '00000000-0000-4000-8000-000000004001'
  ),
  6000000::bigint,
  'the first valid binding adds exactly one million tokens to the lifetime ceiling'
);

select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'referral_reward_granted'
      and target_table = 'referral_bindings'
      and target_id = '00000000-0000-4000-8000-000000004001'
  ),
  'a successful reward writes an administrator audit event'
);

select throws_ok(
  $sql$
    insert into private.referral_bindings (invitee_id, inviter_id)
    values (
      '00000000-0000-4000-8000-000000004101',
      '00000000-0000-4000-8000-000000004002'
    )
  $sql$,
  '23505',
  null,
  'an invitee cannot be bound twice'
);

select throws_ok(
  $sql$
    insert into private.referral_bindings (invitee_id, inviter_id)
    values (
      '00000000-0000-4000-8000-000000004001',
      '00000000-0000-4000-8000-000000004001'
    )
  $sql$,
  '23514',
  null,
  'the database rejects self-referral'
);

select lives_ok(
  $test$
    do $body$
    declare
      owner_code text := (
        select code from private.referral_codes
        where inviter_id = '00000000-0000-4000-8000-000000004001'
      );
      invitation_number integer;
      next_user_id uuid;
    begin
      for invitation_number in 2..10 loop
        next_user_id := (
          '00000000-0000-4000-8000-'
          || pg_catalog.lpad((4100 + invitation_number)::text, 12, '0')
        )::uuid;
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, email_change, email_change_token_new, recovery_token
        ) values (
          '00000000-0000-0000-0000-000000000000',
          next_user_id,
          'authenticated', 'authenticated',
          'referral-invitee-' || invitation_number || '@example.test',
          'test-password', now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          pg_catalog.jsonb_build_object(
            'full_name', 'Referral Invitee ' || invitation_number,
            'referral_code', owner_code
          ),
          now(), now(), '', '', '', ''
        );
      end loop;
    end
    $body$
  $test$,
  'the second through tenth invitation complete successfully'
);

select is(
  (
    select reward_count::integer from private.referral_codes
    where inviter_id = '00000000-0000-4000-8000-000000004001'
  ),
  10,
  'the owner stops at ten lifetime referral rewards'
);

select is(
  (
    select total_token_limit from private.webchat_member_access
    where user_id = '00000000-0000-4000-8000-000000004001'
  ),
  15000000::bigint,
  'ten invitations add no more than ten million tokens'
);

select throws_ok(
  pg_catalog.format(
    $sql$
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        '00000000-0000-4000-8000-000000004111',
        'authenticated', 'authenticated', 'referral-invitee-11@example.test',
        'test-password', now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', 'Referral Invitee 11', 'referral_code', %L),
        now(), now(), '', '', '', ''
      )
    $sql$,
    (select code from private.referral_codes
     where inviter_id = '00000000-0000-4000-8000-000000004001')
  ),
  '22023',
  'Referral code is invalid or unavailable.',
  'the eleventh registration is rejected before any reward can be issued'
);

select ok(
  not exists (
    select 1 from auth.users where id = '00000000-0000-4000-8000-000000004111'
  )
    and not exists (
      select 1 from public.profiles where id = '00000000-0000-4000-8000-000000004111'
    ),
  'a rejected referral rolls back the whole auth and profile registration statement'
);

set local role anon;
create temporary table referral_available_after_limit as
select public.validate_referral_code(
  (select code from referral_test_codes
   where inviter_id = '00000000-0000-4000-8000-000000004001')
) as available;
reset role;

select is(
  (select available from referral_available_after_limit),
  false,
  'a code becomes unavailable after ten rewards'
);

update public.profiles
set review_status = 'suspended', approved_at = null
where id = '00000000-0000-4000-8000-000000004002';

set local role anon;
create temporary table suspended_referral_available as
select public.validate_referral_code(
  (select code from referral_test_codes
   where inviter_id = '00000000-0000-4000-8000-000000004002')
) as available;
reset role;

select is(
  (select available from suspended_referral_available),
  false,
  'a suspended inviter cannot accept new bindings'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004001","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table own_referral_summary as
select * from public.read_own_referral_summary();
create temporary table own_referral_export as
select public.export_own_referral_data() as payload;
reset role;

select ok(
  exists (
    select 1 from own_referral_summary
    where reward_count = 10
      and remaining_rewards = 0
      and reward_tokens = 10000000
      and not available
  ),
  'a member sees only their aggregate reward status'
);

select ok(
  (
    select payload ->> 'code' is not null
      and (payload ->> 'rewardCount')::integer = 10
      and (payload ->> 'rewardTokens')::bigint = 10000000
    from own_referral_export
  ),
  'personal export contains the own referral summary without invited identities'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

do $$
declare
  owner_token constant uuid := '10000000-0000-4000-8000-000000004101';
  target_user constant uuid := '00000000-0000-4000-8000-000000004101';
  deletion_result jsonb;
begin
  if not public.acquire_account_deletion_recovery_lease(owner_token, target_user) then
    raise exception 'Referral deletion fixture could not acquire its recovery lease.';
  end if;

  deletion_result := public.delete_auth_user_with_recovery_lease(owner_token, target_user);
  if not coalesce((deletion_result ->> 'deleted')::boolean, false) then
    raise exception 'Referral deletion fixture did not delete its Auth user.';
  end if;
end
$$;

select ok(
  exists (
    select 1 from private.referral_bindings
    where inviter_id = '00000000-0000-4000-8000-000000004001'
      and invitee_id is null
      and invitee_deleted_at is not null
  ),
  'deleting an invitee anonymizes but retains the binding'
);

select ok(
  (
    select reward_count = 10 from private.referral_codes
    where inviter_id = '00000000-0000-4000-8000-000000004001'
  ) and (
    select total_token_limit = 15000000 from private.webchat_member_access
    where user_id = '00000000-0000-4000-8000-000000004001'
  ),
  'invitee deletion does not reclaim rewards or reward count'
);

select throws_ok(
  $sql$
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-4000-8000-000000004120',
      'authenticated', 'authenticated', 'invalid-referral@example.test',
      'test-password', now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Invalid Referral","referral_code":"INVALID"}'::jsonb,
      now(), now(), '', '', '', ''
    )
  $sql$,
  '22023',
  'Referral code is invalid or unavailable.',
  'malformed referral metadata fails closed'
);

select ok(
  not exists (
    select 1 from auth.users where id = '00000000-0000-4000-8000-000000004120'
  ),
  'invalid referral failure leaves no partial auth account'
);

update public.profiles
set role = 'admin'
where id = '00000000-0000-4000-8000-000000004001';

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000004001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004001","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table referral_admin_audit as
select * from public.admin_list_audit_logs(100, null)
where target_table = 'referral_bindings';
reset role;

select ok(
  exists (
    select 1 from referral_admin_audit
    where action = 'referral_reward_granted'
      and details ? 'reward_tokens'
      and details ? 'reward_count'
      and details ? 'max_rewards'
      and not details ? 'binding_id'
  ),
  'administrators receive only the allowlisted referral reward audit summary'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'private.process_profile_referral()'::regprocedure
  ),
  'the registration trigger is SECURITY DEFINER with a pinned search path'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'private.process_profile_referral()', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'service_role', 'private.process_profile_referral()', 'EXECUTE'
    ),
  'application roles cannot invoke the private reward trigger directly'
);

select * from finish();

rollback;
