begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select ok(
  (
    select pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
    from pg_catalog.pg_attrdef as default_value
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = default_value.adrelid
      and attribute.attnum = default_value.adnum
    where default_value.adrelid = 'private.webchat_member_access'::regclass
      and attribute.attname = 'access_enabled'
  ) ~ '^true$'
    and (
      select pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
      from pg_catalog.pg_attrdef as default_value
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = default_value.adrelid
        and attribute.attnum = default_value.adnum
      where default_value.adrelid = 'private.webchat_member_access'::regclass
        and attribute.attname = 'total_request_limit'
    ) ~ '^10000(?:::integer)?$'
    and (
      select pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
      from pg_catalog.pg_attrdef as default_value
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = default_value.adrelid
        and attribute.attnum = default_value.adnum
      where default_value.adrelid = 'private.webchat_member_access'::regclass
        and attribute.attname = 'total_token_limit'
    ) ~ '^5000000(?:::bigint)?$',
  'member AI access columns use the requested enabled and lifetime quota defaults'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger_definition
    where trigger_definition.tgrelid = 'public.profiles'::regclass
      and trigger_definition.tgname = 'profiles_create_default_webchat_member_access'
      and not trigger_definition.tgisinternal
      and trigger_definition.tgenabled = 'O'
      and (trigger_definition.tgtype & 1) = 1
      and (trigger_definition.tgtype & 2) = 0
      and (trigger_definition.tgtype & 4) = 4
  ),
  'an enabled row-level AFTER INSERT profile trigger creates default AI access'
);

select ok(
  (
    select procedure.prosecdef
      and coalesce(procedure.proconfig::text, '') like '%search_path=%'
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'private.create_default_webchat_member_access()'::regprocedure
  ),
  'the profile trigger function is SECURITY DEFINER with a pinned search path'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'private.create_default_webchat_member_access()', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'authenticated', 'private.create_default_webchat_member_access()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role', 'private.create_default_webchat_member_access()', 'EXECUTE'
    ),
  'application roles cannot invoke the private trigger function directly'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.profiles as profile
    left join private.webchat_member_access as access on access.user_id = profile.id
    where access.user_id is null
  ),
  0,
  'the migration backfills an explicit AI access row for every existing profile'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003901',
    'authenticated', 'authenticated', 'default-ai-member@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Default AI Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003902',
    'authenticated', 'authenticated', 'default-ai-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Default AI Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003903',
    'authenticated', 'authenticated', 'default-ai-suspended@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Default AI Suspended"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  role = case
    when id = '00000000-0000-0000-0000-000000003902'
      then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = case
    when id = '00000000-0000-0000-0000-000000003903'
      then 'suspended'::public.profile_review_status
    else 'approved'::public.profile_review_status
  end,
  approved_at = case
    when id = '00000000-0000-0000-0000-000000003903' then null
    else now()
  end
where id in (
  '00000000-0000-0000-0000-000000003901',
  '00000000-0000-0000-0000-000000003902',
  '00000000-0000-0000-0000-000000003903'
);

select ok(
  exists (
    select 1 from private.webchat_member_access
    where user_id = '00000000-0000-0000-0000-000000003901'
      and access_enabled
      and total_request_limit = 10000
      and total_token_limit = 5000000
      and version = 1
      and updated_at is not null
      and updated_by is null
  ),
  'a newly registered member receives enabled AI access and the requested limits'
);

select ok(
  exists (
    select 1 from private.webchat_member_access
    where user_id = '00000000-0000-0000-0000-000000003902'
      and access_enabled
      and total_request_limit = 10000
      and total_token_limit = 5000000
      and version = 1
  ),
  'an administrator receives the same default AI access policy'
);

select ok(
  exists (
    select 1 from private.webchat_member_access
    where user_id = '00000000-0000-0000-0000-000000003903'
      and access_enabled
      and total_request_limit = 10000
      and total_token_limit = 5000000
  ),
  'a suspended profile retains its stored enabled default policy'
);

set local role service_role;
create temporary table default_member_runtime as
select * from public.read_webchat_member_runtime_access(
  '00000000-0000-0000-0000-000000003901'
);
create temporary table suspended_member_runtime as
select * from public.read_webchat_member_runtime_access(
  '00000000-0000-0000-0000-000000003903'
);
reset role;

select ok(
  exists (
    select 1 from default_member_runtime
    where account_eligible
      and access_enabled
      and total_request_limit = 10000
      and total_token_limit = 5000000
      and version = 1
  ),
  'service runtime accepts the explicit default policy for an active member'
);

select ok(
  exists (
    select 1 from suspended_member_runtime
    where not account_eligible
      and access_enabled
      and total_request_limit = 10000
      and total_token_limit = 5000000
  ),
  'account suspension still blocks runtime eligibility despite the stored switch'
);

delete from private.webchat_member_access
where user_id = '00000000-0000-0000-0000-000000003901';

update private.webchat_relay_config
set
  requests_enabled = true,
  global_daily_request_limit = 300,
  global_daily_token_limit = 1000000
where singleton;

set local role service_role;
create temporary table missing_member_runtime as
select * from public.read_webchat_member_runtime_access(
  '00000000-0000-0000-0000-000000003901'
);

create temporary table missing_member_claim as
select * from public.claim_authorized_webchat_request(
  '00000000-0000-0000-0000-000000003901',
  'missing-default-row',
  repeat('d', 64),
  '39010000-0000-4000-8000-000000000001',
  3,
  100,
  180
);
reset role;

select ok(
  exists (
    select 1 from missing_member_runtime
    where account_eligible
      and access_enabled
      and total_request_limit = 10000
      and total_token_limit = 5000000
      and version = 0
  ),
  'a missing row reports the configured defaults without materializing policy'
);

select is(
  (select decision from missing_member_claim),
  'member_access_denied',
  'paid request admission remains fail closed when the private row is missing'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003902', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003902","role":"authenticated"}',
  true
);
set local role authenticated;
create temporary table missing_member_admin_view as
select * from public.admin_get_webchat_member_access(
  '00000000-0000-0000-0000-000000003901'
);
reset role;

select ok(
  exists (
    select 1 from missing_member_admin_view
    where access_enabled
      and total_request_limit = 10000
      and total_token_limit = 5000000
      and version = 0
      and updated_at is null
  ),
  'administrator fallback values match the configured defaults for a missing row'
);

select ok(
  not pg_catalog.has_table_privilege(
    'anon', 'private.webchat_member_access', 'SELECT'
  )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.webchat_member_access', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.webchat_member_access', 'SELECT'
    ),
  'default access does not expose the private policy table to application roles'
);

select * from finish();

rollback;
