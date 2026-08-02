begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-0000000000a1',
  'authenticated', 'authenticated', 'avatar-member@example.test', 'test-password', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Avatar Member"}'::jsonb,
  now(), now(), '', '', '', ''
);

update public.profiles
set
  full_name = 'Avatar Member',
  qq = '12345678',
  grade = '24级',
  major = '计算机科学与技术',
  review_status = 'approved',
  is_public = true
where id = '00000000-0000-4000-8000-0000000000a1';

select is(
  (select public from storage.buckets where id = 'member-avatars'),
  false,
  'member avatar bucket is private and cannot preserve stale public URLs'
);

select is(
  (select file_size_limit from storage.buckets where id = 'member-avatars'),
  1048576::bigint,
  'member avatar bucket has a one MiB object limit'
);

select ok(
  (select allowed_mime_types = array['image/webp']::text[]
   from storage.buckets where id = 'member-avatars'),
  'member avatar bucket accepts only normalized WebP files'
);

select ok(
  (select relrowsecurity
   from pg_catalog.pg_class as relation
   join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'private' and relation.relname = 'member_avatar_cache'),
  'private avatar cache enables RLS'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'private.member_avatar_cache', 'SELECT')
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.member_avatar_cache', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.member_avatar_cache', 'SELECT'
    ),
  'avatar cache rows are unavailable outside controlled functions'
);

select is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'public_members'
     and column_name = any(array['avatar_path', 'avatar_updated_at'])),
  2,
  'public member view exposes opaque avatar cache fields'
);

select is(
  (select count(*)::integer
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'public_members'
     and column_name = 'qq'),
  0,
  'public member view still excludes QQ'
);

select ok(
  (
    select pg_catalog.bool_and(
      pg_catalog.has_function_privilege('service_role', signature, 'EXECUTE')
        and not pg_catalog.has_function_privilege('authenticated', signature, 'EXECUTE')
        and not pg_catalog.has_function_privilege('anon', signature, 'EXECUTE')
    )
    from pg_catalog.unnest(array[
      'public.begin_member_avatar_sync(uuid,uuid)',
      'public.renew_member_avatar_sync(uuid,uuid)',
      'public.complete_member_avatar_sync(uuid,uuid,text,text,text)',
      'public.complete_member_avatar_removal(uuid,uuid)',
      'public.fail_member_avatar_sync(uuid,uuid)',
      'public.prepare_member_avatar_account_deletion(uuid)',
      'public.cancel_member_avatar_account_deletion(uuid)'
    ]) as signature
  ),
  'only the service role can execute every avatar lifecycle RPC'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = 'storage.objects'::regclass
      and trigger.tgname = 'objects_require_live_member_avatar_lease'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
  ),
  'Storage writes require a live versioned member-avatar lease'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname like '%member_avatar%'
      and (
        not procedure.prosecdef
        or coalesce(procedure.proconfig::text, '') not like '%search_path=%'
      )
  ),
  'all public avatar functions are SECURITY DEFINER with a pinned search path'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select is(
  (
    select target.qq
    from public.begin_member_avatar_sync(
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000b2'
    ) as target
  ),
  '12345678',
  'service reservation can read QQ without exposing it publicly'
);

select throws_ok(
  $$
    select * from public.begin_member_avatar_sync(
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000c3'
    )
  $$,
  '55006',
  'Avatar synchronization is already active.',
  'a live avatar synchronization lease serializes writes'
);

select is(
  public.fail_member_avatar_sync(
    '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-4000-8000-0000000000b2'
  ),
  true,
  'the lease owner can release a failed synchronization'
);

create temporary table avatar_reservation as
select *
from public.begin_member_avatar_sync(
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000d4'
);

select matches(
  (select object_key from avatar_reservation),
  '^member/00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000d4\.webp$',
  'each synchronization receives an owner-token-scoped object key'
);

select matches(
  (select source_qq_sha256 from avatar_reservation),
  '^[a-f0-9]{64}$',
  'the reservation carries a one-way QQ source fingerprint'
);

insert into storage.objects (id, bucket_id, name, metadata)
values (
  '50000000-0000-4000-8000-000000000001',
  'member-avatars',
  (select object_key from avatar_reservation),
  '{"mimetype":"image/webp"}'::jsonb
);

select ok(
  public.complete_member_avatar_sync(
    '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-4000-8000-0000000000d4',
    (select object_key from avatar_reservation),
    pg_catalog.repeat('a', 64),
    (select source_qq_sha256 from avatar_reservation)
  ) is not null,
  'the current lease commits its normalized versioned object'
);

select ok(
  exists (
    select 1 from storage.objects as object
    where object.id = '50000000-0000-4000-8000-000000000001'
      and object.owner = '00000000-0000-4000-8000-0000000000a1'
      and object.owner_id = '00000000-0000-4000-8000-0000000000a1'
  ),
  'committing the cache assigns deletion-fenced Storage ownership'
);

select throws_ok(
  $$
    select * from public.begin_member_avatar_sync(
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000e5'
    )
  $$,
  '55006',
  'Avatar synchronization is cooling down.',
  'a recent unchanged QQ avatar cannot consume another conversion'
);

select is(
  (
    select deletion.ready
    from public.prepare_member_avatar_account_deletion(
      '00000000-0000-4000-8000-0000000000a1'
    ) as deletion
  ),
  true,
  'account deletion freezes avatar writes when no synchronization is active'
);

select throws_ok(
  $$
    select * from public.begin_member_avatar_sync(
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000c3'
    )
  $$,
  '55000',
  'Avatar synchronization is frozen for account deletion.',
  'a frozen account cannot start a new avatar write'
);

select throws_ok(
  $$
    insert into storage.objects (id, bucket_id, name, metadata)
    values (
      '50000000-0000-4000-8000-000000000002',
      'member-avatars',
      'member/00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000f6.webp',
      '{"mimetype":"image/webp"}'::jsonb
    )
  $$,
  '55000',
  'Member avatar upload lease is unavailable.',
  'an expired request cannot upload after account deletion freezes the profile'
);

reset role;

select is(
  (select avatar_path from public.public_members
   where id = '00000000-0000-4000-8000-0000000000a1'),
  'member/00000000-0000-4000-8000-0000000000a1/00000000-0000-4000-8000-0000000000d4.webp',
  'public members expose only the current opaque private object path'
);

update public.profiles
set is_public = false
where id = '00000000-0000-4000-8000-0000000000a1';

select is(
  (select count(*)::integer from public.public_members
   where id = '00000000-0000-4000-8000-0000000000a1'),
  0,
  'withdrawing public visibility immediately removes avatar discovery'
);

update public.profiles
set is_public = true, review_status = 'suspended'
where id = '00000000-0000-4000-8000-0000000000a1';

select is(
  (select count(*)::integer from public.public_members
   where id = '00000000-0000-4000-8000-0000000000a1'),
  0,
  'suspension immediately removes avatar discovery'
);

select * from finish();

rollback;
