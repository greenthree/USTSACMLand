begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000a9',
    'authenticated', 'authenticated', 'announcement-member@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Announcement Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000b9',
    'authenticated', 'authenticated', 'announcement-admin@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Announcement Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-0000000000a9' then 'Announcement Member'
    else 'Announcement Administrator'
  end,
  role = case
    when id = '00000000-0000-0000-0000-0000000000b9' then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  approved_at = now();

insert into public.announcements (
  id, title, body, status, published_at, created_by, updated_by
)
overriding system value
values (
  99901,
  'Existing announcement',
  'Existing body',
  'published',
  pg_catalog.clock_timestamp() - interval '1 hour',
  '00000000-0000-0000-0000-0000000000b9',
  '00000000-0000-0000-0000-0000000000b9'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.admin_list_announcements(integer,bigint)',
    'EXECUTE'
  ),
  'anonymous visitors cannot call the administrator announcement list'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.admin_upsert_announcement(bigint,text,text,public.announcement_status,timestamptz,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'anonymous visitors cannot call the administrator announcement writer'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.admin_delete_announcement(bigint,timestamptz)',
    'EXECUTE'
  ),
  'anonymous visitors cannot call the administrator announcement deleter'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.admin_list_announcements(integer,bigint)',
    'EXECUTE'
  ),
  'authenticated sessions can reach the administrator-checked announcement RPC'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.announcements', 'SELECT'),
  'browser sessions cannot read the private announcement table directly'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.announcements', 'INSERT'),
  'browser sessions cannot insert announcements directly'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.announcements', 'UPDATE'),
  'browser sessions cannot update announcements directly'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.announcements', 'DELETE'),
  'browser sessions cannot delete announcements directly'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.announcements', 'TRUNCATE'),
  'browser sessions cannot truncate announcements directly'
);

select ok(
  not pg_catalog.has_sequence_privilege(
    'authenticated',
    'public.announcements_id_seq',
    'USAGE'
  ),
  'browser sessions cannot allocate announcement IDs directly'
);

select ok(
  pg_catalog.has_table_privilege('anon', 'public.public_announcements', 'SELECT'),
  'anonymous visitors retain read access to the sanitized public view'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select * from public.admin_list_announcements() $$,
  '42501',
  'Administrator access required.',
  'ordinary members cannot inspect private announcement records'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b9', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b9","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.admin_list_announcements()),
  1,
  'administrators can list existing announcements'
);

select is(
  (
    select announcement_id
    from public.admin_list_announcements(1, null)
  ),
  99901::bigint,
  'administrator announcement pagination returns the newest ID first'
);

select is(
  (
    select count(*)::integer
    from public.admin_list_announcements(1, 99901)
  ),
  0,
  'administrator announcement pagination applies the before-ID cursor'
);

select lives_ok(
  $$
    select *
    from public.admin_upsert_announcement(
      null,
      'Managed draft',
      'Draft body',
      'draft',
      null,
      null,
      null
    )
  $$,
  'administrators can create a draft through the controlled RPC'
);

reset role;

select is(
  (
    select created_by
    from public.announcements
    where title = 'Managed draft'
  ),
  '00000000-0000-0000-0000-0000000000b9'::uuid,
  'the announcement creator is recorded from the authenticated administrator'
);

select is(
  (
    select count(*)::integer
    from public.public_announcements
    where title = 'Managed draft'
  ),
  0,
  'draft announcements are not visible through the public view'
);

create temporary table managed_announcement_version as
select id, updated_at
from public.announcements
where title = 'Managed draft';
grant select on managed_announcement_version to authenticated;

set local role authenticated;

select lives_ok(
  $$
    select *
    from public.admin_upsert_announcement(
      (select id from managed_announcement_version),
      'Managed announcement',
      'Published body',
      'published',
      pg_catalog.clock_timestamp() - interval '1 minute',
      pg_catalog.clock_timestamp() + interval '1 day',
      (select updated_at from managed_announcement_version)
    )
  $$,
  'administrators can publish an existing draft'
);

reset role;

select cmp_ok(
  (
    select updated_at
    from public.announcements
    where title = 'Managed announcement'
  ),
  '>',
  (select updated_at from managed_announcement_version),
  'publishing advances the optimistic-lock version even inside one transaction'
);

select is(
  (
    select count(*)::integer
    from public.public_announcements
    where title = 'Managed announcement'
  ),
  1,
  'a published unexpired announcement appears in the public view'
);

set local role authenticated;

select throws_ok(
  $$
    select *
    from public.admin_upsert_announcement(
      (select id from managed_announcement_version),
      'Stale update',
      'Stale body',
      'published',
      pg_catalog.clock_timestamp() - interval '1 minute',
      null,
      (select updated_at from managed_announcement_version)
    )
  $$,
  '40001',
  'Announcement changed after it was loaded. Refresh and try again.',
  'stale announcement edits are rejected'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select *
    from public.admin_upsert_announcement(
      null,
      'Unauthorized',
      'Unauthorized body',
      'draft',
      null,
      null,
      null
    )
  $$,
  '42501',
  'Administrator access required.',
  'ordinary members cannot create announcements'
);

select throws_ok(
  $$
    select public.admin_delete_announcement(
      (select id from managed_announcement_version),
      (select updated_at from managed_announcement_version)
    )
  $$,
  '42501',
  'Administrator access required.',
  'ordinary members cannot delete announcements'
);

reset role;

select ok(
  (
    select count(*) >= 2
    from public.audit_logs
    where target_table = 'announcements'
      and actor_id = '00000000-0000-0000-0000-0000000000b9'
      and action in ('insert', 'update')
  ),
  'announcement creation and publication are audited'
);

drop table managed_announcement_version;
create temporary table managed_announcement_version as
select id, updated_at
from public.announcements
where title = 'Managed announcement';
grant select on managed_announcement_version to authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b9', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b9","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  public.admin_delete_announcement(
    (select id from managed_announcement_version),
    (select updated_at from managed_announcement_version)
  ),
  true,
  'administrators can delete the current announcement version'
);

reset role;

select is(
  (select count(*)::integer from public.announcements where title = 'Managed announcement'),
  0,
  'the deleted announcement is removed from storage'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where target_table = 'announcements'
      and action = 'delete'
      and actor_id = '00000000-0000-0000-0000-0000000000b9'
  ),
  1,
  'announcement deletion is audited'
);

select * from finish();

rollback;
