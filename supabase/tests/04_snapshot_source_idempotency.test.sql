begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000d4',
  'authenticated',
  'authenticated',
  'snapshot-member@example.test',
  'test-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Snapshot Member"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

update public.profiles
set review_status = 'approved', approved_at = now()
where id = '00000000-0000-0000-0000-0000000000d4';

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status, verified_at
)
values (
  '00000000-0000-0000-0000-0000000000d4',
  'atcoder',
  'snapshot_member',
  'snapshot_member',
  'verified',
  now()
);

insert into public.sync_jobs (
  id, scope, profile_id, status, trigger_type, started_at, finished_at
)
overriding system value
values
  (99001, 'member', '00000000-0000-0000-0000-0000000000d4', 'succeeded', 'manual', now(), now()),
  (99002, 'member', '00000000-0000-0000-0000-0000000000d4', 'succeeded', 'manual', now(), now()),
  (99003, 'member', '00000000-0000-0000-0000-0000000000d4', 'failed', 'manual', now(), now());

insert into public.sync_runs (
  id, job_id, profile_id, platform, status, started_at, finished_at
)
overriding system value
values
  (99101, 99001, '00000000-0000-0000-0000-0000000000d4', 'atcoder', 'succeeded', now(), now()),
  (99102, 99002, '00000000-0000-0000-0000-0000000000d4', 'atcoder', 'succeeded', now(), now()),
  (99103, 99003, '00000000-0000-0000-0000-0000000000d4', 'atcoder', 'failed', now(), now());

insert into public.stat_snapshots (
  profile_id, platform, sync_run_id, current_rating, max_rating,
  solved_count, status, source_observed_at, recorded_at
)
values (
  '00000000-0000-0000-0000-0000000000d4',
  'atcoder',
  99101,
  1500,
  1600,
  100,
  'fresh',
  '2026-07-14T00:00:00Z',
  now()
);

insert into public.stat_snapshots (
  profile_id, platform, sync_run_id, current_rating, max_rating,
  solved_count, status, source_observed_at, recorded_at
)
values (
  '00000000-0000-0000-0000-0000000000d4',
  'atcoder',
  99102,
  1500,
  1600,
  100,
  'fresh',
  '2026-07-14T00:00:00Z',
  now()
)
on conflict (profile_id, platform, source_observed_at) do nothing;

select is(
  (
    select count(*)::integer
    from public.stat_snapshots
    where profile_id = '00000000-0000-0000-0000-0000000000d4'
  ),
  1,
  'repeating the same upstream observation creates one successful snapshot'
);

select is(
  (
    select sync_run_id
    from public.stat_snapshots
    where profile_id = '00000000-0000-0000-0000-0000000000d4'
  ),
  99101::bigint,
  'an idempotent repeat preserves the original snapshot provenance'
);

select throws_ok(
  $$
    insert into public.stat_snapshots (
      profile_id, platform, sync_run_id, current_rating, max_rating,
      solved_count, status, source_observed_at, recorded_at
    ) values (
      '00000000-0000-0000-0000-0000000000d4',
      'atcoder',
      99102,
      1500,
      1600,
      100,
      'fresh',
      '2026-07-14T00:00:00Z',
      now()
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "stat_snapshots_success_source_unique_idx"',
  'the database rejects an unguarded duplicate source snapshot'
);

insert into public.stat_snapshots (
  profile_id, platform, sync_run_id, current_rating, max_rating,
  solved_count, status, source_observed_at, recorded_at
)
values (
  '00000000-0000-0000-0000-0000000000d4',
  'atcoder',
  99103,
  1500,
  1600,
  100,
  'fresh',
  null,
  now()
);

select is(
  (
    select count(*)::integer
    from public.stat_snapshots
    where profile_id = '00000000-0000-0000-0000-0000000000d4'
  ),
  2,
  'a failed run without a new source observation remains independently auditable'
);

select * from finish();

rollback;
