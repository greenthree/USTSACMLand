begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

select has_table(
  'private',
  'referral_program_config',
  'the private referral program singleton exists'
);

select ok(
  exists (
    select 1
    from private.referral_program_config as config
    where config.singleton
      and config.enabled
      and config.version = 0
      and config.updated_by is null
      and pg_catalog.char_length(config.change_reason) between 3 and 500
  ),
  'the referral program starts enabled with a valid initial version and reason'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'private.referral_program_config'::regclass
  )
    and not exists (
      select 1
      from pg_catalog.pg_policy as policy
      where policy.polrelid = 'private.referral_program_config'::regclass
    ),
  'the singleton has RLS enabled and no browser policy'
);

select ok(
  not pg_catalog.has_table_privilege(
    'anon', 'private.referral_program_config', 'SELECT'
  )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.referral_program_config', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.referral_program_config', 'UPDATE'
    )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.referral_program_config', 'SELECT'
    ),
  'browser and service roles cannot access the private singleton directly'
);

select ok(
  pg_catalog.has_function_privilege(
    'anon', 'public.check_referral_code(text)', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'anon', 'public.validate_referral_code(text)', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.read_own_referral_summary()', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.admin_read_referral_program_config()', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'authenticated',
      'public.admin_update_referral_program_config(boolean,bigint,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.admin_read_referral_program_config()', 'EXECUTE'
    ),
  'public checks and authenticated member or administrator RPCs have narrow grants'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
      and procedure.prosrc like '%for share%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'private.process_profile_referral()'::regprocedure
  )
    and not pg_catalog.has_function_privilege(
      'anon', 'private.process_profile_referral()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated', 'private.process_profile_referral()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role', 'private.process_profile_referral()', 'EXECUTE'
    ),
  'the private registration trigger is pinned, protected, and locks the switch'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004201',
    'authenticated', 'authenticated', 'referral-switch-admin@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Referral Switch Admin"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004202',
    'authenticated', 'authenticated', 'referral-switch-owner@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Referral Switch Owner"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000004203',
    'authenticated', 'authenticated', 'referral-switch-member@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Referral Switch Member"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  role = case
    when id = '00000000-0000-4000-8000-000000004201'
      then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  approved_at = now()
where id in (
  '00000000-0000-4000-8000-000000004201',
  '00000000-0000-4000-8000-000000004202',
  '00000000-0000-4000-8000-000000004203'
);

create temporary table referral_switch_codes as
select inviter_id, code
from private.referral_codes
where inviter_id in (
  '00000000-0000-4000-8000-000000004201',
  '00000000-0000-4000-8000-000000004202',
  '00000000-0000-4000-8000-000000004203'
);
grant select on referral_switch_codes to anon, authenticated;

set local role anon;
create temporary table referral_switch_initial_check as
select *
from public.check_referral_code(
  (select code from referral_switch_codes
   where inviter_id = '00000000-0000-4000-8000-000000004202')
);
create temporary table referral_switch_initial_legacy as
select public.validate_referral_code(
  (select code from referral_switch_codes
   where inviter_id = '00000000-0000-4000-8000-000000004202')
) as available;
reset role;

select ok(
  (
    select check_result.program_enabled and check_result.available
      and (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(check_result))
      ) = 2
      and pg_catalog.to_jsonb(check_result) ? 'program_enabled'
      and pg_catalog.to_jsonb(check_result) ? 'available'
    from referral_switch_initial_check as check_result
  ),
  'the structured anonymous check exposes only global state and availability'
);

select is(
  (select available from referral_switch_initial_legacy),
  true,
  'the compatibility validator remains available while the program is enabled'
);

select ok(
  (select program_enabled and not available from public.check_referral_code(null))
    and (select program_enabled and not available from public.check_referral_code('')),
  'missing referral codes still return a structured unavailable result'
);

update private.webchat_member_access
set total_token_limit = 1000000000
where user_id = '00000000-0000-4000-8000-000000004202';

set local role anon;
create temporary table referral_switch_quota_ceiling_check as
select *
from public.check_referral_code(
  (select code from referral_switch_codes
   where inviter_id = '00000000-0000-4000-8000-000000004202')
);
reset role;

select ok(
  (
    select program_enabled and not available
    from referral_switch_quota_ceiling_check
  ),
  'the public check rejects a code whose next reward would exceed the quota ceiling'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000004202',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004202","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table referral_switch_quota_ceiling_summary as
select * from public.read_own_referral_summary();
reset role;

select ok(
  (
    select program_enabled and not available
    from referral_switch_quota_ceiling_summary
  ),
  'the inviter summary uses the same reward-capacity rule as the public check'
);

update private.webchat_member_access
set total_token_limit = 5000000
where user_id = '00000000-0000-4000-8000-000000004202';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000004210',
  'authenticated', 'authenticated', 'referral-switch-before@example.test',
  'test-password', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  pg_catalog.jsonb_build_object(
    'full_name', 'Referral Before Pause',
    'referral_code', code
  ),
  now(), now(), '', '', '', ''
from referral_switch_codes
where inviter_id = '00000000-0000-4000-8000-000000004202';

select ok(
  exists (
    select 1 from private.referral_bindings
    where invitee_id = '00000000-0000-4000-8000-000000004210'
      and inviter_id = '00000000-0000-4000-8000-000000004202'
  )
    and (
      select reward_count = 1
      from private.referral_codes
      where inviter_id = '00000000-0000-4000-8000-000000004202'
    )
    and (
      select total_token_limit = 6000000
      from private.webchat_member_access
      where user_id = '00000000-0000-4000-8000-000000004202'
    ),
  'an enabled registration still binds and grants one reward'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000004203',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004203","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$select * from public.admin_read_referral_program_config()$$,
  '42501',
  'Administrator access required.',
  'an ordinary member cannot read the global switch'
);

select throws_ok(
  $$select * from public.admin_update_referral_program_config(false, 0, 'member write')$$,
  '42501',
  'Administrator access required.',
  'an ordinary member cannot update the global switch'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000004201',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004201","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table referral_switch_initial_admin_read as
select * from public.admin_read_referral_program_config();

select ok(
  exists (
    select 1 from referral_switch_initial_admin_read
    where enabled
      and version = 0
      and updated_at is not null
      and updated_by_label = 'System'
      and pg_catalog.char_length(reason) between 3 and 500
  ),
  'the administrator reads the initial switch without an internal actor identifier'
);

select throws_ok(
  $$select * from public.admin_update_referral_program_config(false, 0, 'no')$$,
  '22023',
  'Referral program change reason must contain 3 to 500 characters.',
  'the administrator must provide at least three reason characters'
);

select throws_ok(
  $$select * from public.admin_update_referral_program_config(false, 0, repeat('x', 501))$$,
  '22023',
  'Referral program change reason must contain 3 to 500 characters.',
  'the administrator cannot provide more than five hundred reason characters'
);

select throws_ok(
  $$select * from public.admin_update_referral_program_config(false, 0, E'\t\n\r')$$,
  '22023',
  'Referral program change reason must contain 3 to 500 characters.',
  'the administrator cannot submit a whitespace-only audit reason'
);

create temporary table referral_switch_disabled_result as
select *
from public.admin_update_referral_program_config(
  false,
  0,
  E'  Pause\t referral\n rewards  '
);

select ok(
  exists (
    select 1 from referral_switch_disabled_result
    where not enabled
      and version = 1
      and updated_at is not null
      and updated_by_label = 'Referral Switch Admin'
      and reason = 'Pause referral rewards'
  ),
  'an administrator disables the program with a normalized audited reason'
);

create temporary table referral_switch_lost_response_retry as
select *
from public.admin_update_referral_program_config(
  false,
  0,
  'Pause referral rewards'
);

select ok(
  exists (
    select 1
    from referral_switch_lost_response_retry as retried
    join referral_switch_disabled_result as original using (enabled, version, updated_at)
    where retried.reason = original.reason
      and retried.updated_by_label = original.updated_by_label
  ),
  'a one-version exact-state retry reconciles a lost successful response'
);

select throws_ok(
  $$
    select *
    from public.admin_update_referral_program_config(
      false,
      0,
      'Different reason from another request'
    )
  $$,
  '40001',
  'Referral program configuration changed after it was loaded.',
  'same-state stale writes with a different reason are not mistaken for lost responses'
);

select throws_ok(
  $$
    select *
    from public.admin_update_referral_program_config(
      true,
      0,
      'stale opposite request'
    )
  $$,
  '40001',
  'Referral program configuration changed after it was loaded.',
  'a stale request for a different state reports an optimistic-lock conflict'
);

reset role;

set local role anon;
create temporary table referral_switch_disabled_valid_check as
select *
from public.check_referral_code(
  (select code from referral_switch_codes
   where inviter_id = '00000000-0000-4000-8000-000000004202')
);
create temporary table referral_switch_disabled_malformed_check as
select * from public.check_referral_code('INVALID');
create temporary table referral_switch_disabled_legacy as
select public.validate_referral_code(
  (select code from referral_switch_codes
   where inviter_id = '00000000-0000-4000-8000-000000004202')
) as available;
reset role;

select ok(
  (
    select not program_enabled and not available
    from referral_switch_disabled_valid_check
  ) and (
    select not program_enabled and not available
    from referral_switch_disabled_malformed_check
  ),
  'disabled structured checks reject both valid and malformed codes without identity data'
);

select is(
  (select available from referral_switch_disabled_legacy),
  false,
  'the compatibility validator is false while the program is disabled'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000004202',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004202","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table referral_switch_disabled_summary as
select * from public.read_own_referral_summary();
create temporary table referral_switch_disabled_export as
select public.export_own_referral_data() as payload;
reset role;

select ok(
  exists (
    select 1 from referral_switch_disabled_summary
    where not program_enabled
      and code is null
      and reward_count = 1
      and remaining_rewards = 9
      and reward_tokens = 1000000
      and not available
  ),
  'the disabled member summary hides the code but preserves historical rewards'
);

select ok(
  (
    select payload -> 'programEnabled' = 'false'::jsonb
      and payload -> 'code' = 'null'::jsonb
      and (payload ->> 'rewardCount')::integer = 1
      and (payload ->> 'rewardTokens')::bigint = 1000000
    from referral_switch_disabled_export
  ),
  'the personal export reports disabled state and retains historical reward totals'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  fixture.id,
  'authenticated', 'authenticated', fixture.email,
  'test-password', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'full_name', fixture.full_name,
    'referral_code', fixture.referral_code
  )),
  now(), now(), '', '', '', ''
from (
  values
    (
      '00000000-0000-4000-8000-000000004211'::uuid,
      'referral-switch-disabled-valid@example.test'::text,
      'Disabled Valid Code'::text,
      (select code from referral_switch_codes
       where inviter_id = '00000000-0000-4000-8000-000000004202')
    ),
    (
      '00000000-0000-4000-8000-000000004212'::uuid,
      'referral-switch-disabled-malformed@example.test'::text,
      'Disabled Malformed Code'::text,
      'INVALID'::text
    ),
    (
      '00000000-0000-4000-8000-000000004213'::uuid,
      'referral-switch-disabled-no-code@example.test'::text,
      'Disabled Without Code'::text,
      null::text
    )
) as fixture(id, email, full_name, referral_code);

select ok(
  (
    select pg_catalog.count(*) = 3
    from auth.users
    where id in (
      '00000000-0000-4000-8000-000000004211',
      '00000000-0000-4000-8000-000000004212',
      '00000000-0000-4000-8000-000000004213'
    )
  ) and (
    select pg_catalog.count(*) = 3
    from private.referral_codes
    where inviter_id in (
      '00000000-0000-4000-8000-000000004211',
      '00000000-0000-4000-8000-000000004212',
      '00000000-0000-4000-8000-000000004213'
    )
  ),
  'disabled registration accepts valid, malformed, and absent metadata and creates own codes'
);

select ok(
  not exists (
    select 1 from private.referral_bindings
    where invitee_id in (
      '00000000-0000-4000-8000-000000004211',
      '00000000-0000-4000-8000-000000004212',
      '00000000-0000-4000-8000-000000004213'
    )
  )
    and (
      select reward_count = 1
      from private.referral_codes
      where inviter_id = '00000000-0000-4000-8000-000000004202'
    )
    and (
      select total_token_limit = 6000000
      from private.webchat_member_access
      where user_id = '00000000-0000-4000-8000-000000004202'
    ),
  'disabled registrations create no bindings, rewards, or quota changes'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000004201',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004201","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table referral_switch_reenabled_result as
select *
from public.admin_update_referral_program_config(
  true,
  1,
  'Resume referral rewards'
);
reset role;

select ok(
  exists (
    select 1 from referral_switch_reenabled_result
    where enabled
      and version = 2
      and updated_by_label = 'Referral Switch Admin'
      and reason = 'Resume referral rewards'
  ),
  'an administrator re-enables the program at the next version'
);

select ok(
  not exists (
    select 1 from private.referral_bindings
    where invitee_id in (
      '00000000-0000-4000-8000-000000004211',
      '00000000-0000-4000-8000-000000004212',
      '00000000-0000-4000-8000-000000004213'
    )
  )
    and (
      select reward_count = 1
      from private.referral_codes
      where inviter_id = '00000000-0000-4000-8000-000000004202'
    ),
  're-enabling does not backfill bindings or rewards from the disabled period'
);

set local role anon;
create temporary table referral_switch_reenabled_check as
select *
from public.check_referral_code(
  (select code from referral_switch_codes
   where inviter_id = '00000000-0000-4000-8000-000000004202')
);
reset role;

select ok(
  (
    select program_enabled and available
    from referral_switch_reenabled_check
  ),
  'a valid code becomes available again after the global switch reopens'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000004214',
  'authenticated', 'authenticated', 'referral-switch-after@example.test',
  'test-password', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  pg_catalog.jsonb_build_object(
    'full_name', 'Referral After Resume',
    'referral_code', code
  ),
  now(), now(), '', '', '', ''
from referral_switch_codes
where inviter_id = '00000000-0000-4000-8000-000000004202';

select ok(
  exists (
    select 1 from private.referral_bindings
    where invitee_id = '00000000-0000-4000-8000-000000004214'
      and inviter_id = '00000000-0000-4000-8000-000000004202'
  )
    and (
      select reward_count = 2
      from private.referral_codes
      where inviter_id = '00000000-0000-4000-8000-000000004202'
    )
    and (
      select total_token_limit = 7000000
      from private.webchat_member_access
      where user_id = '00000000-0000-4000-8000-000000004202'
    ),
  'registrations after re-enable bind and reward normally'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000004201',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000004201","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table referral_switch_final_admin_read as
select * from public.admin_read_referral_program_config();
create temporary table referral_switch_admin_audit as
select * from public.admin_list_audit_logs(100, null)
where target_table = 'referral_program_config';
reset role;

select ok(
  exists (
    select 1 from referral_switch_final_admin_read
    where enabled
      and version = 2
      and updated_by_label = 'Referral Switch Admin'
      and reason = 'Resume referral rewards'
  ),
  'the administrator read returns the current version, label, and reason'
);

select is(
  (select pg_catalog.count(*)::integer from referral_switch_admin_audit),
  2,
  'disable and re-enable write one audit each while a lost-response retry writes none'
);

select ok(
  (
    select pg_catalog.bool_and(
      target_id = 'global'
        and target_label = 'Referral program'
        and details ? 'before_enabled'
        and details ? 'after_enabled'
        and details ? 'reason'
        and (
          select pg_catalog.count(*)
          from pg_catalog.jsonb_object_keys(details)
        ) = 3
        and details::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}'
    )
    from referral_switch_admin_audit
  ),
  'the administrator audit projection exposes only before, after, and reason'
);

select ok(
  exists (
    select 1 from public.admin_rate_limit_buckets
    where actor_id = '00000000-0000-4000-8000-000000004201'
      and action_key = 'referral_program.write'
      and request_count = 3
  ),
  'successful switch calls consume the dedicated administrator rate limit'
);

select ok(
  (
    select pg_catalog.count(*) = 2
      and pg_catalog.bool_and(
        not coalesce(before_data, '{}'::jsonb) ? 'updated_by'
          and not coalesce(after_data, '{}'::jsonb) ? 'updated_by'
          and (
            select pg_catalog.count(*)
            from pg_catalog.jsonb_object_keys(metadata)
          ) = 1
          and metadata ? 'reason'
      )
    from public.audit_logs
    where target_table = 'referral_program_config'
  ),
  'raw switch audits contain no configuration or updater identifier payload'
);

select * from finish();

rollback;
