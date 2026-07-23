begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

select ok(
  pg_catalog.to_regprocedure(
    'private.require_live_auth_user_for_storage_ownership()'
  ) is not null,
  'the Storage ownership write fence function exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = 'storage.objects'::regclass
      and trigger.tgname = 'objects_require_live_auth_owner'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
  ),
  'Storage ownership writes lock a live Auth owner'
);

select ok(
  pg_catalog.to_regprocedure(
    'private.require_empty_storage_before_auth_user_deletion()'
  ) is not null,
  'the Storage ownership fence function exists'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'private.require_empty_storage_before_auth_user_deletion()',
    'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'private.require_empty_storage_before_auth_user_deletion()',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'private.require_empty_storage_before_auth_user_deletion()',
      'EXECUTE'
    ),
  'no API role can invoke the private Storage fence directly'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = 'auth.users'::regclass
      and trigger.tgname = 'auth_users_5_require_empty_storage'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
  ),
  'Auth deletion runs the Storage ownership fence after the recovery fence'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000004801',
  'authenticated', 'authenticated', 'storage-fence@example.test', 'test-password',
  pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Storage Fence Member"}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), '', '', '', ''
);

update public.profiles
set review_status = 'approved', role = 'member'::public.app_role
where id = '00000000-0000-4000-8000-000000004801';

insert into storage.buckets (id, name, public)
values ('account-deletion-storage-fence', 'account-deletion-storage-fence', false);

insert into storage.objects (id, bucket_id, name, owner_id, metadata)
values (
  '48000000-0000-4000-8000-000000000000',
  'account-deletion-storage-fence',
  'third-party-owner.webp',
  'external-jwt-subject',
  '{"mimetype":"image/webp"}'::jsonb
);

select is(
  (
    select owner_id
    from storage.objects
    where id = '48000000-0000-4000-8000-000000000000'
  ),
  'external-jwt-subject',
  'non-UUID third-party JWT ownership remains compatible with Supabase Storage'
);

insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata)
values
  (
    '48000000-0000-4000-8000-000000000001',
    'account-deletion-storage-fence',
    'owner-column.webp',
    '00000000-0000-4000-8000-000000004801',
    null,
    '{"mimetype":"image/webp"}'::jsonb
  ),
  (
    '48000000-0000-4000-8000-000000000002',
    'account-deletion-storage-fence',
    'owner-id-column.webp',
    null,
    '00000000-0000-4000-8000-000000004801',
    '{"mimetype":"image/webp"}'::jsonb
  );

select throws_ok(
  $$
    delete from auth.users
    where id = '00000000-0000-4000-8000-000000004801'
  $$,
  '42501',
  'Auth user deletion requires a fenced recovery lease.',
  'the recovery fence rejects an unfenced caller before Storage ownership can be probed'
);

select ok(
  public.acquire_account_deletion_recovery_lease(
    '48000000-0000-4000-8000-000000000099',
    '00000000-0000-4000-8000-000000004801'
  ),
  'the Storage fence fixture acquires the normal recovery lease'
);

set local role service_role;
create temporary table first_storage_deletion_attempt as
select public.delete_auth_user_with_recovery_lease(
  '48000000-0000-4000-8000-000000000099',
  '00000000-0000-4000-8000-000000004801'
) as result;
reset role;

select ok(
  (
    select (result ->> 'leaseOwned')::boolean
      and not (result ->> 'deleted')::boolean
    from first_storage_deletion_attempt
  ),
  'an object recorded through the UUID owner column blocks fenced deletion'
);

select ok(
  exists (
    select 1 from auth.users
    where id = '00000000-0000-4000-8000-000000004801'
  )
    and exists (
      select 1 from public.profiles
      where id = '00000000-0000-4000-8000-000000004801'
    )
    and exists (
      select 1 from private.account_deletion_recovery_lease
      where target_user_id = '00000000-0000-4000-8000-000000004801'
    ),
  'a blocked attempt preserves Auth, Profile, and the retryable recovery lease'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from storage.objects
    where owner = '00000000-0000-4000-8000-000000004801'
      or owner_id = '00000000-0000-4000-8000-000000004801'
  ),
  2,
  'a blocked deletion does not mutate either owned Storage object'
);

-- Storage protects its catalog from direct deletion. Inside this rollback-only
-- database test, replica mode models an object already removed through the
-- Storage API before its catalog row disappears.
set local session_replication_role = 'replica';
delete from storage.objects
where id = '48000000-0000-4000-8000-000000000001';
set local session_replication_role = 'origin';

set local role service_role;
create temporary table second_storage_deletion_attempt as
select public.delete_auth_user_with_recovery_lease(
  '48000000-0000-4000-8000-000000000099',
  '00000000-0000-4000-8000-000000004801'
) as result;
reset role;

select ok(
  (
    select (result ->> 'leaseOwned')::boolean
      and not (result ->> 'deleted')::boolean
    from second_storage_deletion_attempt
  ),
  'an object recorded only through the text owner_id column also blocks deletion'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from auth.users
    where id = '00000000-0000-4000-8000-000000004801'
  ),
  1,
  'the second controlled refusal still preserves the Auth user'
);

set local session_replication_role = 'replica';
delete from storage.objects
where id = '48000000-0000-4000-8000-000000000002';
set local session_replication_role = 'origin';

set local role service_role;
create temporary table final_storage_deletion_attempt as
select public.delete_auth_user_with_recovery_lease(
  '48000000-0000-4000-8000-000000000099',
  '00000000-0000-4000-8000-000000004801'
) as result;
reset role;

select ok(
  (
    select (result ->> 'leaseOwned')::boolean
      and (result ->> 'deleted')::boolean
    from final_storage_deletion_attempt
  ),
  'the same fenced deletion succeeds after every owned object is removed'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from auth.users
    where id = '00000000-0000-4000-8000-000000004801'
  ),
  0,
  'successful retry removes the Auth user'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.profiles
    where id = '00000000-0000-4000-8000-000000004801'
  ),
  0,
  'successful retry cascades the member Profile'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.account_deletion_recovery_lease
    where target_user_id = '00000000-0000-4000-8000-000000004801'
  ),
  0,
  'successful retry consumes the recovery lease'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from storage.objects
    where owner = '00000000-0000-4000-8000-000000004801'
      or owner_id = '00000000-0000-4000-8000-000000004801'
  ),
  0,
  'no owned Storage object remains after the explicit cleanup'
);

select throws_ok(
  $$
    insert into storage.objects (id, bucket_id, name, owner_id, metadata)
    values (
      '48000000-0000-4000-8000-000000000003',
      'account-deletion-storage-fence',
      'deleted-owner.webp',
      '00000000-0000-4000-8000-000000004801',
      '{"mimetype":"image/webp"}'::jsonb
    )
  $$,
  '23503',
  'Storage object ownership requires a live Auth user.',
  'a new object cannot be attached to an Auth user after deletion'
);

select * from finish();

rollback;
