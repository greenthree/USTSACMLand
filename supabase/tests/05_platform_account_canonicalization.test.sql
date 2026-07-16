begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000e5',
    'authenticated',
    'authenticated',
    'canonical-member@example.test',
    'test-password',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Canonical Member"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000e6',
    'authenticated',
    'authenticated',
    'canonical-alias@example.test',
    'test-password',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Canonical Alias"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

update public.profiles
set review_status = 'approved', approved_at = now()
where id = '00000000-0000-0000-0000-0000000000e5';

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status
)
values (
  '00000000-0000-0000-0000-0000000000e5',
  'luogu',
  '000409073',
  'ignored-by-trigger',
  'pending'
);

select is(
  (
    select external_id
    from public.platform_accounts
    where profile_id = '00000000-0000-0000-0000-0000000000e5'
      and platform = 'luogu'
  ),
  '409073',
  'Luogu UIDs are stored without leading zeros'
);

select is(
  (
    select normalized_external_id
    from public.platform_accounts
    where profile_id = '00000000-0000-0000-0000-0000000000e5'
      and platform = 'luogu'
  ),
  '409073',
  'the uniqueness key follows the canonical Luogu UID'
);

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status
)
values (
  '00000000-0000-0000-0000-0000000000e5',
  'nowcoder',
  '00091827364',
  'ignored-by-trigger',
  'verified'
);

select is(
  (
    select external_id
    from public.platform_accounts
    where profile_id = '00000000-0000-0000-0000-0000000000e5'
      and platform = 'nowcoder'
  ),
  '91827364',
  'Nowcoder UIDs are stored without leading zeros'
);

select matches(
  (
    select external_id
    from public.platform_accounts
    where profile_id = '00000000-0000-0000-0000-0000000000e5'
      and platform = 'xcpc_elo'
  ),
  '^auto:[a-f0-9]{32}$',
  'XCPC automatic matching placeholders remain valid'
);

update public.platform_accounts
set external_id = '00091827364'
where profile_id = '00000000-0000-0000-0000-0000000000e5'
  and platform = 'nowcoder';

select is(
  (
    select status::text
    from public.platform_accounts
    where profile_id = '00000000-0000-0000-0000-0000000000e5'
      and platform = 'nowcoder'
  ),
  'verified',
  'an equivalent numeric UID spelling does not invalidate a verified binding'
);

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status
)
values (
  '00000000-0000-0000-0000-0000000000e6',
  'atcoder',
  'valid_atcoder',
  'valid_atcoder',
  'pending'
);

select throws_ok(
  $$
    update public.platform_accounts
    set platform = 'luogu', external_id = '000409073'
    where profile_id = '00000000-0000-0000-0000-0000000000e6'
      and platform = 'atcoder'
  $$,
  '23505',
  'duplicate key value violates unique constraint "platform_accounts_platform_external_unique"',
  'leading zero aliases cannot bypass platform account uniqueness'
);

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status
)
values (
  '00000000-0000-0000-0000-0000000000e5',
  'qoj',
  'temporary-qoj',
  'temporary-qoj',
  'pending'
);

select throws_like(
  $$
    update public.platform_accounts
    set platform = 'luogu', external_id = '123456789012345678901'
    where profile_id = '00000000-0000-0000-0000-0000000000e5'
      and platform = 'qoj'
  $$,
  '%violates check constraint "platform_accounts_external_id_format"%',
  'numeric platform UIDs are limited to the adapter maximum of 20 digits'
);

insert into public.sync_jobs (
  scope, profile_id, platform, dedupe_key, status, trigger_type, payload, started_at
)
values (
  'account',
  '00000000-0000-0000-0000-0000000000e5',
  'nowcoder',
  'member:00000000-0000-0000-0000-0000000000e5',
  'running',
  'account_changed',
  '{"platforms":["nowcoder"]}'::jsonb,
  now()
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e5', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e5","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$
    update public.platform_accounts
    set external_id = '91827365'
    where profile_id = '00000000-0000-0000-0000-0000000000e5'
      and platform = 'nowcoder'
  $$,
  '55000',
  'Platform accounts cannot change while member synchronization is active.',
  'members cannot replace a binding while its synchronization is active'
);

reset role;

select * from finish();

rollback;
