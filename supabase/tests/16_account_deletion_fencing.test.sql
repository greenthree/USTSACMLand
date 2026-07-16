begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

select ok(
  (
    select attribute.attnotnull
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'private.account_deletion_recovery_lease'::regclass
      and attribute.attname = 'target_user_id'
      and not attribute.attisdropped
  ),
  'every recovery lease is bound to one Auth user'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.delete_auth_user_with_recovery_lease(uuid,uuid)',
    'EXECUTE'
  ),
  'the service role may execute the fenced Auth deletion RPC'
);

select ok(
  (
    select proc.prosecdef
      and coalesce(proc.proconfig::text, '') like '%search_path=%'
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'delete_auth_user_with_recovery_lease'
      and pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'p_owner_token uuid, p_user_id uuid'
  ),
  'the fenced Auth deletion RPC is security definer with a fixed search path'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.delete_auth_user_with_recovery_lease(uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.delete_auth_user_with_recovery_lease(uuid,uuid)',
    'EXECUTE'
  ),
  'browser roles cannot execute the fenced Auth deletion RPC'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.acquire_account_deletion_recovery_lease(uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.acquire_account_deletion_recovery_lease(uuid,uuid)',
    'EXECUTE'
  ),
  'the target-bound recovery lease remains service-role-only'
);

select throws_ok(
  $$ select public.delete_auth_user_with_recovery_lease(null, '00000000-0000-0000-0000-0000000000fc') $$,
  '22023',
  'Recovery lease owner and Auth user are required.',
  'the fenced deletion RPC rejects a null owner token'
);

select throws_ok(
  $$ select public.delete_auth_user_with_recovery_lease('10000000-0000-4000-8000-000000000001', null) $$,
  '22023',
  'Recovery lease owner and Auth user are required.',
  'the fenced deletion RPC rejects a null Auth user'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000fc',
  'authenticated',
  'authenticated',
  'fenced-delete-member@example.test',
  'test-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Fenced Delete Member"}'::jsonb,
  now(),
  now(),
  '', '', '', ''
);

select ok(
  not (public.delete_auth_user_with_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000fc'
  ) ->> 'leaseOwned')::boolean,
  'Auth deletion cannot start without an acquired recovery lease'
);

select is(
  (select count(*)::integer from auth.users where id = '00000000-0000-0000-0000-0000000000fc'),
  1,
  'a missing recovery lease preserves the Auth user'
);

select ok(
  public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000fc'
  ),
  'the fenced deletion test acquires the recovery lease'
);

select throws_ok(
  $$
    delete from auth.users
    where id = '00000000-0000-0000-0000-0000000000fc'
  $$,
  '42501',
  'Auth user deletion requires a fenced recovery lease.',
  'a legacy Auth HTTP deletion cannot reuse a target-bound lease without the RPC transaction marker'
);

select ok(
  not (public.delete_auth_user_with_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000fd'
  ) ->> 'leaseOwned')::boolean,
  'the lease owner cannot substitute a different target user'
);

select ok(
  not (public.delete_auth_user_with_recovery_lease(
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-0000000000fc'
  ) ->> 'leaseOwned')::boolean,
  'a non-owner cannot use another deletion request recovery lease'
);

select is(
  (select count(*)::integer from auth.users where id = '00000000-0000-0000-0000-0000000000fc'),
  1,
  'a rejected non-owner deletion preserves the Auth user'
);

update private.account_deletion_recovery_lease
set
  acquired_at = pg_catalog.clock_timestamp() - interval '10 minutes',
  expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where owner_token = '10000000-0000-4000-8000-000000000001';

select ok(
  not (public.delete_auth_user_with_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000fc'
  ) ->> 'leaseOwned')::boolean,
  'an expired lease cannot fence an Auth deletion'
);

select ok(
  public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000fc'
  ),
  'the target can acquire a new lease after the previous lease expires'
);

select ok(
  (public.delete_auth_user_with_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000fc'
  ) ->> 'deleted')::boolean,
  'the lease owner atomically deletes the Auth user'
);

select is(
  (
    (select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000fc')
    + (select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000fc')
  )::integer,
  0,
  'the fenced Auth deletion commits the profile cascade in the same transaction'
);

select ok(
  not exists (select 1 from private.account_deletion_recovery_lease),
  'successful Auth deletion releases the target-bound lease in the same transaction'
);

select ok(
  not (public.delete_auth_user_with_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000fc'
  ) ->> 'leaseOwned')::boolean
  and not (public.delete_auth_user_with_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000fc'
  ) ->> 'deleted')::boolean,
  'repeating a committed deletion cannot reuse the consumed lease'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000fb',
  'authenticated',
  'authenticated',
  'fenced-delete-missing-profile@example.test',
  'test-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Fenced Delete Missing Profile"}'::jsonb,
  now(),
  now(),
  '', '', '', ''
);

delete from public.profiles
where id = '00000000-0000-0000-0000-0000000000fb';

select ok(
  public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-0000000000fb'
  ),
  'the missing-profile guard fixture acquires its target-bound lease'
);

select ok(
  (public.delete_auth_user_with_recovery_lease(
    '10000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-0000000000fb'
  ) ->> 'leaseOwned')::boolean
  and not (public.delete_auth_user_with_recovery_lease(
    '10000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-0000000000fb'
  ) ->> 'deleted')::boolean,
  'the final RPC refuses an Auth user without a live Profile'
);

select is(
  (select count(*)::integer from auth.users where id = '00000000-0000-0000-0000-0000000000fb'),
  1,
  'a missing Profile rejection preserves the Auth user'
);

select ok(
  public.release_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-0000000000fb'
  ),
  'the missing Profile rejection leaves a releasable lease'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000fd',
  'authenticated',
  'authenticated',
  'fenced-delete-admin@example.test',
  'test-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Fenced Delete Administrator"}'::jsonb,
  now(),
  now(),
  '', '', '', ''
);

update public.profiles
set role = 'admin'
where id = '00000000-0000-0000-0000-0000000000fd';

select ok(
  public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-0000000000fd'
  ),
  'the administrator guard fixture acquires its target-bound lease'
);

select ok(
  not (public.delete_auth_user_with_recovery_lease(
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-0000000000fd'
  ) ->> 'deleted')::boolean,
  'the final RPC refuses to delete a current administrator'
);

select is(
  (
    (select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000fd')
    + (select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000fd')
  )::integer,
  2,
  'a rejected administrator deletion preserves Auth and profile rows'
);

select ok(
  public.release_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-0000000000fd'
  ),
  'the administrator rejection leaves a releasable lease'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000fe',
  'authenticated',
  'authenticated',
  'fenced-delete-active-sync@example.test',
  'test-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Fenced Delete Active Sync"}'::jsonb,
  now(),
  now(),
  '', '', '', ''
);

insert into public.sync_jobs (
  id, scope, profile_id, status, trigger_type
)
overriding system value
values (
  99618,
  'member',
  '00000000-0000-0000-0000-0000000000fe',
  'queued',
  'manual'
);

select ok(
  public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-0000000000fe'
  ),
  'the active-sync guard fixture acquires its target-bound lease'
);

select ok(
  not (public.delete_auth_user_with_recovery_lease(
    '10000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-0000000000fe'
  ) ->> 'deleted')::boolean,
  'the final RPC refuses deletion while synchronization is queued'
);

select is(
  (
    (select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000fe')
    + (select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000fe')
    + (select count(*) from public.sync_jobs where id = 99618)
  )::integer,
  3,
  'a rejected active-sync deletion preserves Auth, profile, and job rows'
);

select ok(
  public.release_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-0000000000fe'
  ),
  'the active-sync rejection leaves a releasable lease'
);

select * from finish();

rollback;
