begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_function(
  'public',
  'admin_read_webchat_pilot_observation',
  array[]::text[],
  'the administrator pilot observation function exists'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'public.admin_read_webchat_pilot_observation()'::regprocedure
  ),
  'the pilot observation function is SECURITY DEFINER with a pinned search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.admin_read_webchat_pilot_observation()', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.admin_read_webchat_pilot_observation()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role', 'public.admin_read_webchat_pilot_observation()', 'EXECUTE'
    ),
  'only authenticated administrators can reach the pilot observation boundary'
);

select ok(
  pg_catalog.lower(
    pg_catalog.pg_get_functiondef(
      'public.admin_read_webchat_pilot_observation()'::regprocedure
    )
  ) !~ '(request_id|request_fingerprint|message_body|response_body|api_key|base_url|full_name|email|qq)',
  'the pilot observation function does not select identities, content, or credentials'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'private.webchat_requests', 'SELECT')
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.webchat_member_access', 'SELECT'
    )
    and not pg_catalog.has_table_privilege('service_role', 'private.webchat_requests', 'SELECT'),
  'pilot observation does not reopen direct private table reads'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003401',
    'authenticated', 'authenticated', 'pilot-health-one@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Health One"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003402',
    'authenticated', 'authenticated', 'pilot-health-two@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Health Two"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003403',
    'authenticated', 'authenticated', 'pilot-health-three@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Health Three"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003404',
    'authenticated', 'authenticated', 'pilot-health-four@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Health Four"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003405',
    'authenticated', 'authenticated', 'pilot-health-disabled@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Health Disabled"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003406',
    'authenticated', 'authenticated', 'pilot-health-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Health Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = coalesce(full_name, 'Pilot Health'),
  qq = '1340000000' || right(id::text, 1),
  role = case
    when id = '00000000-0000-0000-0000-000000003406'
      then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved'::public.profile_review_status,
  approved_at = now()
where id in (
  '00000000-0000-0000-0000-000000003401',
  '00000000-0000-0000-0000-000000003402',
  '00000000-0000-0000-0000-000000003403',
  '00000000-0000-0000-0000-000000003404',
  '00000000-0000-0000-0000-000000003405',
  '00000000-0000-0000-0000-000000003406'
);

insert into private.webchat_member_access (
  user_id, access_enabled, pilot_observation_enabled,
  total_request_limit, total_token_limit, version, updated_by
)
values
  (
    '00000000-0000-0000-0000-000000003401', true, true, 100, 100000, 1,
    '00000000-0000-0000-0000-000000003406'
  ),
  (
    '00000000-0000-0000-0000-000000003402', true, true, 100, 100000, 1,
    '00000000-0000-0000-0000-000000003406'
  ),
  (
    '00000000-0000-0000-0000-000000003403', true, false, 100, 100000, 1,
    '00000000-0000-0000-0000-000000003406'
  ),
  (
    '00000000-0000-0000-0000-000000003404', true, false, 100, 100000, 1,
    '00000000-0000-0000-0000-000000003406'
  ),
  (
    '00000000-0000-0000-0000-000000003405', false, false, 100, 100000, 1,
    '00000000-0000-0000-0000-000000003406'
  );

update private.webchat_pilot_observation_state
set roster_changed_at = pg_catalog.statement_timestamp() - interval '8 days'
where singleton;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003406', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003406","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table invalid_cohort as
select * from public.admin_read_webchat_pilot_observation();

reset role;

select ok(
  exists (
    select 1 from invalid_cohort
    where enabled_members = 2
      and active_members = 0
      and observation_status = 'cohort_size_invalid'
  ),
  'a cohort outside the required 3-5 member range is not ready for observation'
);

update private.webchat_member_access
set pilot_observation_enabled = true
where user_id in (
  '00000000-0000-0000-0000-000000003403',
  '00000000-0000-0000-0000-000000003404'
);

update private.webchat_pilot_observation_state
set roster_changed_at = pg_catalog.statement_timestamp() - interval '8 days'
where singleton;

insert into private.webchat_requests (
  user_id, request_id, request_fingerprint, owner_token, status, quota_date,
  claimed_at, upstream_started_at, finished_at, reserved_tokens,
  input_tokens, output_tokens, total_tokens, charged_tokens,
  cached_input_tokens, cache_write_tokens, outcome
)
values
  (
    '00000000-0000-0000-0000-000000003401', 'pilot-health-success-one', repeat('a', 64),
    '34000000-0000-4000-8000-000000000001', 'finished',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    pg_catalog.statement_timestamp() - interval '7 days',
    pg_catalog.statement_timestamp() - interval '7 days' + interval '1 second',
    pg_catalog.statement_timestamp() - interval '7 days' + interval '2 seconds',
    3000, 2000, 10, 2010, 2010, 1536, 0, 'completed'
  ),
  (
    '00000000-0000-0000-0000-000000003402', 'pilot-health-success-two', repeat('b', 64),
    '34000000-0000-4000-8000-000000000002', 'finished',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    pg_catalog.statement_timestamp() - interval '6 days',
    pg_catalog.statement_timestamp() - interval '6 days' + interval '1 second',
    pg_catalog.statement_timestamp() - interval '6 days' + interval '2 seconds',
    2000, 900, 10, 910, 910, 0, 0, 'completed'
  ),
  (
    '00000000-0000-0000-0000-000000003403', 'pilot-health-incomplete', repeat('c', 64),
    '34000000-0000-4000-8000-000000000003', 'finished',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    pg_catalog.statement_timestamp() - interval '5 days',
    pg_catalog.statement_timestamp() - interval '5 days' + interval '1 second',
    pg_catalog.statement_timestamp() - interval '5 days' + interval '2 seconds',
    2000, 1500, 20, 1520, 1520, 1024, 0, 'incomplete_max_output_tokens'
  ),
  (
    '00000000-0000-0000-0000-000000003404', 'pilot-health-success-four', repeat('d', 64),
    '34000000-0000-4000-8000-000000000004', 'finished',
    (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
    pg_catalog.statement_timestamp() - interval '4 days',
    pg_catalog.statement_timestamp() - interval '4 days' + interval '1 second',
    pg_catalog.statement_timestamp() - interval '4 days' + interval '2 seconds',
    2000, 1200, 10, 1210, 1210, null, null, 'completed'
  );

set local role authenticated;
create temporary table ready_observation as
select * from public.admin_read_webchat_pilot_observation();
reset role;

select set_eq(
  $$
    select distinct fields.key
    from ready_observation as observation
    cross join lateral pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(observation)) as fields(key)
  $$,
  $$ values
    ('checked_at'), ('cohort_started_at'), ('observation_hours'), ('enabled_members'),
    ('active_members'), ('observed_requests'), ('successful_requests'),
    ('incomplete_requests'), ('failed_requests'), ('unknown_usage_requests'),
    ('active_generation_count'), ('cache_eligible_requests'), ('cache_hit_requests'),
    ('last_request_at'), ('observation_status')
  $$,
  'the observation boundary exposes only the documented aggregate fields'
);

select is(
  (select enabled_members from ready_observation),
  4,
  'disabled access rows are excluded from the formal pilot cohort'
);

select is(
  (select cohort_started_at from ready_observation),
  (
    select state.roster_changed_at
    from private.webchat_pilot_observation_state as state
    where state.singleton
  ),
  'the observation clock uses the dedicated formal-roster state'
);

select ok(
  exists (
    select 1 from ready_observation
    where enabled_members = 4
      and active_members = 4
      and observation_hours >= 168
      and observed_requests = 4
      and successful_requests = 3
      and incomplete_requests = 1
      and failed_requests = 0
      and unknown_usage_requests = 0
      and active_generation_count = 0
      and cache_eligible_requests = 2
      and cache_hit_requests = 2
      and last_request_at is not null
      and observation_status = 'ready_for_review'
  ),
  'a healthy 3-5 member cohort becomes ready after seven continuous days and full activity'
);

insert into private.webchat_requests (
  user_id, request_id, request_fingerprint, owner_token, status, quota_date,
  claimed_at, upstream_started_at, finished_at, reserved_tokens,
  charged_tokens, outcome
)
values (
  '00000000-0000-0000-0000-000000003401', 'pilot-health-failure', repeat('e', 64),
  '34000000-0000-4000-8000-000000000005', 'finished',
  (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
  pg_catalog.statement_timestamp() - interval '1 hour',
  pg_catalog.statement_timestamp() - interval '59 minutes',
  pg_catalog.statement_timestamp() - interval '58 minutes',
  5000, 5000, 'upstream_http_error'
);

set local role authenticated;
create temporary table failed_observation as
select * from public.admin_read_webchat_pilot_observation();
reset role;

select ok(
  exists (
    select 1 from failed_observation
    where failed_requests = 1
      and unknown_usage_requests = 1
      and observation_status = 'needs_review'
  ),
  'failed requests with unknown usage require administrator review'
);

delete from private.webchat_requests where request_id = 'pilot-health-failure';

insert into private.webchat_requests (
  user_id, request_id, request_fingerprint, owner_token, status, quota_date,
  claimed_at, lease_expires_at, reserved_tokens
)
values (
  '00000000-0000-0000-0000-000000003401', 'pilot-health-active', repeat('f', 64),
  '34000000-0000-4000-8000-000000000006', 'claimed',
  (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date,
  pg_catalog.statement_timestamp() - interval '1 minute',
  pg_catalog.statement_timestamp() + interval '4 minutes',
  2000
);

set local role authenticated;
create temporary table active_observation as
select * from public.admin_read_webchat_pilot_observation();
reset role;

select ok(
  exists (
    select 1 from active_observation
    where active_generation_count = 1
      and observation_status = 'active_requests'
  ),
  'an unexpired generation is reported without reading its request identifier'
);

delete from private.webchat_requests where request_id = 'pilot-health-active';

update private.webchat_member_access
set total_request_limit = total_request_limit + 1
where user_id = '00000000-0000-0000-0000-000000003404';

set local role authenticated;
create temporary table restarted_observation as
select * from public.admin_read_webchat_pilot_observation();
reset role;

select ok(
  exists (
    select 1 from restarted_observation
    where observation_hours = 0
      and active_members = 0
      and observed_requests = 0
      and observation_status = 'awaiting_member_activity'
  ),
  'changing an enabled cohort access row restarts the observation clock and request window'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003401', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003401","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select * from public.admin_read_webchat_pilot_observation() $$,
  '42501',
  'Administrator access required.',
  'ordinary members cannot read the pilot observation summary'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_ok(
  $$ select * from public.admin_read_webchat_pilot_observation() $$,
  '42501',
  'permission denied for function admin_read_webchat_pilot_observation',
  'anonymous visitors cannot execute the pilot observation function'
);

reset role;

select ok(
  not exists (
    select 1 from ready_observation
    where cohort_started_at is null or checked_at < cohort_started_at
  ),
  'the summary exposes a monotonic content-free observation interval'
);

select * from finish();

rollback;
