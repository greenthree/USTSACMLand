begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'webchat_member_access'
      and column_name = 'pilot_observation_enabled'
      and column_default = 'false'
  )
    and pg_catalog.to_regclass('private.webchat_pilot_observation_state') is not null
    and pg_catalog.to_regclass('private.webchat_member_access_pilot_roster_idx') is not null,
  'formal pilot enrollment and its private observation clock are installed'
);

select ok(
  (
    select pg_catalog.count(*) = 4
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
      and procedure.proname = any(array[
        'admin_get_webchat_member_policy',
        'admin_update_webchat_member_policy',
        'touch_webchat_pilot_observation_state',
        'touch_webchat_pilot_observation_for_profile'
      ])
      and procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
  ),
  'new policy and trigger functions are SECURITY DEFINER with pinned search paths'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.admin_get_webchat_member_policy(uuid)', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'authenticated',
      'public.admin_update_webchat_member_policy(uuid,boolean,boolean,integer,bigint,bigint,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.admin_get_webchat_member_policy(uuid)', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'public.admin_update_webchat_member_policy(uuid,boolean,boolean,integer,bigint,bigint,text)',
      'EXECUTE'
    ),
  'only authenticated administrator sessions can reach the new policy boundary'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) as actor(role_name)
    cross join unnest(array[
      'private.webchat_member_access',
      'private.webchat_pilot_observation_state'
    ]) as resource(table_name)
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as access(privilege_name)
    where pg_catalog.has_table_privilege(
      actor.role_name, resource.table_name, access.privilege_name
    )
  ),
  'browser and Edge roles retain no direct access to pilot policy or clock tables'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  ('00000000-0000-0000-0000-0000000035' || pg_catalog.lpad(member_no::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pilot-roster-' || member_no::text || '@example.test',
  'test-password', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  pg_catalog.jsonb_build_object('full_name', 'Pilot Roster ' || member_no::text),
  now(), now(), '', '', '', ''
from pg_catalog.generate_series(1, 7) as member(member_no);

update public.profiles
set
  full_name = 'Pilot Roster ' || right(id::text, 2),
  qq = '135000000' || right(id::text, 2),
  role = case
    when id = '00000000-0000-0000-0000-000000003507'
      then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved'::public.profile_review_status,
  approved_at = now()
where id between
  '00000000-0000-0000-0000-000000003501' and
  '00000000-0000-0000-0000-000000003507';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003507', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003507","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table default_policy as
select * from public.admin_get_webchat_member_policy(
  '00000000-0000-0000-0000-000000003501'
);

select * from public.admin_update_webchat_member_policy(
  '00000000-0000-0000-0000-000000003501',
  true, false, 20, 100000, 0, 'Authorize without formal observation'
);

create temporary table authorized_only as
select * from public.admin_get_webchat_member_policy(
  '00000000-0000-0000-0000-000000003501'
);

reset role;

select ok(
  exists (
    select 1 from default_policy
    where not access_enabled
      and not pilot_observation_enabled
      and version = 0
  ),
  'an unconfigured account is denied and excluded from observation by default'
);

select ok(
  exists (
    select 1 from authorized_only
    where access_enabled
      and not pilot_observation_enabled
      and version = 1
  ),
  'AI access can be granted without enrolling the account in formal observation'
);

set local role authenticated;

select * from public.admin_update_webchat_member_policy(
  '00000000-0000-0000-0000-000000003501',
  true, true, 20, 100000, 1, 'Enroll first formal pilot member'
);
select * from public.admin_update_webchat_member_policy(
  '00000000-0000-0000-0000-000000003502',
  true, true, 20, 100000, 0, 'Enroll second formal pilot member'
);
select * from public.admin_update_webchat_member_policy(
  '00000000-0000-0000-0000-000000003503',
  true, true, 20, 100000, 0, 'Enroll third formal pilot member'
);
select * from public.admin_update_webchat_member_policy(
  '00000000-0000-0000-0000-000000003504',
  true, true, 20, 100000, 0, 'Enroll fourth formal pilot member'
);
select * from public.admin_update_webchat_member_policy(
  '00000000-0000-0000-0000-000000003505',
  true, true, 20, 100000, 0, 'Enroll fifth formal pilot member'
);

reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from private.webchat_member_access
    where pilot_observation_enabled and access_enabled
  ),
  5,
  'five independently selected accounts form the maximum formal pilot roster'
);

select ok(
  exists (
    select 1 from public.audit_logs
    where target_id = '00000000-0000-0000-0000-000000003501'
      and after_data ->> 'accessEnabled' = 'true'
      and after_data ->> 'pilotObservationEnabled' = 'true'
      and metadata -> 'changedFields' ? 'pilotObservationEnabled'
      and pg_catalog.concat(before_data, after_data, metadata)
        !~* 'pilot-roster-1@example|Pilot Roster 01'
  ),
  'formal enrollment is audited without member identity or content'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.admin_update_webchat_member_policy(uuid,boolean,boolean,integer,bigint,bigint,text)'::regprocedure
    ),
    'pg_advisory_xact_lock'
  ) > 0,
  'the five-member ceiling is serialized by a transaction advisory lock'
);

reset role;
update public.profiles
set review_status = 'suspended'::public.profile_review_status
where id = '00000000-0000-0000-0000-000000003505';
set local role authenticated;

select throws_ok(
  $$
    select * from public.admin_update_webchat_member_policy(
      '00000000-0000-0000-0000-000000003506',
      true, true, 20, 100000, 0, 'Attempt sixth formal pilot member'
    )
  $$,
  '22023',
  'Formal WebChat pilot roster cannot exceed 5 members.',
  'a sixth formal pilot member is rejected atomically'
);

reset role;
update public.profiles
set review_status = 'approved'::public.profile_review_status
where id = '00000000-0000-0000-0000-000000003505';

select is(
  (
    select pg_catalog.count(*)::integer
    from private.webchat_member_access
    where pilot_observation_enabled and access_enabled
  ),
  5,
  'a suspended formal member keeps its slot and restoration cannot create a six-member roster'
);

set local role authenticated;

select throws_ok(
  $$
    select * from public.admin_update_webchat_member_policy(
      '00000000-0000-0000-0000-000000003506',
      false, true, 20, 100000, 0, 'Attempt observation without access'
    )
  $$,
  '22023',
  'Formal pilot members must retain WebChat access.',
  'formal observation cannot be enabled without AI access'
);

create temporary table five_member_observation as
select * from public.admin_read_webchat_pilot_observation();

select * from public.admin_update_webchat_member_policy(
  '00000000-0000-0000-0000-000000003501',
  true, false, 20, 100000, 2, 'Remove from formal observation only'
);

create temporary table removed_policy as
select * from public.admin_get_webchat_member_policy(
  '00000000-0000-0000-0000-000000003501'
);
create temporary table four_member_observation as
select * from public.admin_read_webchat_pilot_observation();

reset role;

select ok(
  exists (
    select 1 from five_member_observation
    where enabled_members = 5
      and observation_status = 'awaiting_member_activity'
  ),
  'observation counts only the independently selected formal roster'
);

select ok(
  exists (
    select 1 from removed_policy
    where access_enabled
      and not pilot_observation_enabled
      and version = 3
  )
    and exists (
      select 1 from four_member_observation
      where enabled_members = 4
        and observation_hours = 0
    ),
  'removing a member preserves AI access and restarts the formal observation clock'
);

select pg_sleep(0.01);
select roster_changed_at as clock_before_quota_change
into temporary table pilot_clock_before_quota
from private.webchat_pilot_observation_state where singleton;

set local role authenticated;
select * from public.admin_update_webchat_member_access(
  '00000000-0000-0000-0000-000000003502',
  true, 25, 100000, 1, 'Change quota through compatibility RPC'
);
reset role;

select ok(
  exists (
    select 1 from private.webchat_member_access
    where user_id = '00000000-0000-0000-0000-000000003502'
      and access_enabled
      and pilot_observation_enabled
      and total_request_limit = 25
      and version = 2
  )
    and (
      select roster_changed_at from private.webchat_pilot_observation_state where singleton
    ) > (select clock_before_quota_change from pilot_clock_before_quota),
  'the compatibility access RPC preserves enrollment and resets the clock for quota changes'
);

select roster_changed_at as clock_before_noop
into temporary table pilot_clock_before_noop
from private.webchat_pilot_observation_state where singleton;

update private.webchat_member_access
set total_request_limit = total_request_limit
where user_id = '00000000-0000-0000-0000-000000003502';

select is(
  (
    select roster_changed_at from private.webchat_pilot_observation_state where singleton
  ),
  (select clock_before_noop from pilot_clock_before_noop),
  'a write that changes no pilot policy field does not restart the observation clock'
);

set local role authenticated;
select * from public.admin_update_webchat_member_access(
  '00000000-0000-0000-0000-000000003502',
  false, 25, 100000, 2, 'Disable access through compatibility RPC'
);
reset role;

select ok(
  exists (
    select 1 from private.webchat_member_access
    where user_id = '00000000-0000-0000-0000-000000003502'
      and not access_enabled
      and not pilot_observation_enabled
      and version = 3
  ),
  'disabling access through the compatibility RPC also removes formal enrollment'
);

select throws_like(
  $$
    update private.webchat_member_access
    set access_enabled = false
    where user_id = '00000000-0000-0000-0000-000000003503'
  $$,
  '%webchat_member_access_pilot_requires_access%',
  'the table constraint blocks inconsistent direct policy writes'
);

select pg_sleep(0.01);
select roster_changed_at as clock_before_suspension
into temporary table pilot_clock_before_suspension
from private.webchat_pilot_observation_state where singleton;

update public.profiles
set review_status = 'suspended'::public.profile_review_status
where id = '00000000-0000-0000-0000-000000003504';

select ok(
  (
    select roster_changed_at from private.webchat_pilot_observation_state where singleton
  ) > (select clock_before_suspension from pilot_clock_before_suspension),
  'suspending an enrolled profile restarts the observation clock'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003501', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003501","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select * from public.admin_get_webchat_member_policy(
    '00000000-0000-0000-0000-000000003501'
  ) $$,
  '42501',
  'Administrator access required.',
  'ordinary members cannot inspect formal pilot enrollment'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_member_policy(
      '00000000-0000-0000-0000-000000003501',
      true, true, 20, 100000, 3, 'Unauthorized roster change'
    )
  $$,
  '42501',
  'Administrator access required.',
  'ordinary members cannot change formal pilot enrollment'
);

reset role;

select * from finish();

rollback;
