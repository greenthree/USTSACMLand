begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

select ok(
  public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000f6'
  ),
  'the first account deletion acquires the global recovery-floor lease'
);

select ok(
  not public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-0000000000f7'
  ),
  'a concurrent account deletion cannot enter the recovery-floor critical section'
);

select ok(
  public.renew_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000f6'
  ),
  'the lease owner can renew before the irreversible Auth deletion'
);

select ok(
  (
    select expires_at
    from private.account_deletion_recovery_lease
    where owner_token = '10000000-0000-4000-8000-000000000001'
  ) > pg_catalog.clock_timestamp() + interval '4 minutes'
  and (
    select expires_at
    from private.account_deletion_recovery_lease
    where owner_token = '10000000-0000-4000-8000-000000000001'
  ) <= pg_catalog.clock_timestamp() + interval '5 minutes',
  'renewal extends the lease by approximately five minutes'
);

select ok(
  not public.renew_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-0000000000f6'
  ),
  'a non-owner cannot renew the recovery-floor lease'
);

select ok(
  not public.renew_account_deletion_recovery_lease(
    null,
    '00000000-0000-0000-0000-0000000000f6'
  ),
  'a null owner token cannot renew the recovery-floor lease'
);

select ok(
  not public.release_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-0000000000f6'
  ),
  'a non-owner cannot release the recovery-floor lease'
);

select ok(
  public.release_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000f6'
  ),
  'the lease owner can release the recovery-floor lease'
);

select ok(
  public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-0000000000f7'
  ),
  'the next account deletion can acquire the released lease'
);

update private.account_deletion_recovery_lease
set
  acquired_at = pg_catalog.clock_timestamp() - interval '10 minutes',
  expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where owner_token = '10000000-0000-4000-8000-000000000002';

select ok(
  not public.renew_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-0000000000f7'
  ),
  'an expired owner cannot revive the recovery-floor lease'
);

select ok(
  public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-0000000000f6'
  ),
  'another deletion can take over an expired recovery-floor lease'
);

select public.release_account_deletion_recovery_lease(
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-0000000000f6'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.acquire_account_deletion_recovery_lease(uuid,uuid)',
    'EXECUTE'
  ),
  'the service role may acquire the account-deletion recovery lease'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.acquire_account_deletion_recovery_lease(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot acquire the account-deletion recovery lease'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.renew_account_deletion_recovery_lease(uuid,uuid)',
    'EXECUTE'
  ),
  'the service role may renew the account-deletion recovery lease'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.renew_account_deletion_recovery_lease(uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.renew_account_deletion_recovery_lease(uuid,uuid)',
    'EXECUTE'
  ),
  'browser roles cannot renew the account-deletion recovery lease'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000f6',
  'authenticated',
  'authenticated',
  'delete-member@example.test',
  'test-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Deletion Fixture Member"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

update public.profiles
set
  full_name = 'Deletion Fixture Member',
  qq = '19999999999',
  major = 'Deletion Fixture Major',
  grade = '24级',
  review_status = 'approved',
  approved_at = now()
where id = '00000000-0000-0000-0000-0000000000f6';

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status, verified_at
)
values (
  '00000000-0000-0000-0000-0000000000f6',
  'codeforces',
  'DeletionFixtureHandle',
  'deletionfixturehandle',
  'verified',
  now()
);

insert into public.sync_jobs (
  id, scope, profile_id, status, trigger_type, started_at, finished_at
)
overriding system value
values (
  99601,
  'member',
  '00000000-0000-0000-0000-0000000000f6',
  'succeeded',
  'manual',
  now(),
  now()
);

insert into public.sync_runs (
  id, job_id, profile_id, platform, status, started_at, finished_at
)
overriding system value
values (
  99602,
  99601,
  '00000000-0000-0000-0000-0000000000f6',
  'codeforces',
  'succeeded',
  now(),
  now()
);

insert into public.platform_stats (
  profile_id, platform, current_rating, max_rating, solved_count,
  status, last_success_at
)
values (
  '00000000-0000-0000-0000-0000000000f6',
  'codeforces',
  1500,
  1600,
  42,
  'fresh',
  now()
);

insert into public.stat_snapshots (
  profile_id, platform, sync_run_id, current_rating, max_rating,
  solved_count, status, source_observed_at
)
values (
  '00000000-0000-0000-0000-0000000000f6',
  'codeforces',
  99602,
  1500,
  1600,
  42,
  'fresh',
  now()
);

insert into public.audit_logs (
  actor_id, action, target_table, target_id, metadata
)
values (
  '00000000-0000-0000-0000-0000000000f6',
  'manual_note',
  'platform_stats',
  '00000000-0000-0000-0000-0000000000f6',
  '{"profile_id":"00000000-0000-0000-0000-0000000000f6","note":"Deletion Fixture Note"}'::jsonb
);

insert into public.daily_problems (
  id, problem_date, title, source_platform, external_problem_id, source_url,
  difficulty, tags, training_note, estimated_minutes, status, published_at
)
overriding system value
values (
  99605,
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 100,
  'Deleted member learning fixture',
  'Codeforces',
  'CF-99605',
  'https://codeforces.com/problemset/problem/1/A',
  '入门',
  array['lifecycle'],
  'Account-deletion cascade fixture.',
  15,
  'published',
  pg_catalog.clock_timestamp() - interval '100 days'
);

insert into public.daily_problem_completions (problem_id, profile_id)
values (99605, '00000000-0000-0000-0000-0000000000f6');

insert into public.daily_problem_comments (
  id, problem_id, author_id, body
)
overriding system value
values (
  99606,
  99605,
  '00000000-0000-0000-0000-0000000000f6',
  'Deleted member discussion fixture.'
);

do $$
begin
  if not public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000011',
    '00000000-0000-0000-0000-0000000000f6'
  ) then
    raise exception 'Could not acquire the hard-deletion lifecycle test lease';
  end if;
  perform pg_catalog.set_config(
    'app.account_deletion_owner_token',
    '10000000-0000-4000-8000-000000000011',
    true
  );
  perform pg_catalog.set_config(
    'app.account_deletion_target_user_id',
    '00000000-0000-0000-0000-0000000000f6',
    true
  );
end;
$$;

delete from auth.users
where id = '00000000-0000-0000-0000-0000000000f6';

select public.release_account_deletion_recovery_lease(
  '10000000-0000-4000-8000-000000000011',
  '00000000-0000-0000-0000-0000000000f6'
);

select is(
  (select count(*)::integer from auth.users where id = '00000000-0000-0000-0000-0000000000f6'),
  0,
  'hard deletion removes the Auth user'
);

select is(
  (select count(*)::integer from public.profiles where id = '00000000-0000-0000-0000-0000000000f6'),
  0,
  'hard deletion removes the member profile'
);

select is(
  (
    select count(*)::integer
    from public.platform_accounts
    where profile_id = '00000000-0000-0000-0000-0000000000f6'
  ),
  0,
  'hard deletion removes all platform bindings'
);

select is(
  (
    (select count(*) from public.platform_stats where profile_id = '00000000-0000-0000-0000-0000000000f6')
    + (select count(*) from public.stat_snapshots where profile_id = '00000000-0000-0000-0000-0000000000f6')
  )::integer,
  0,
  'hard deletion removes current and historical statistics'
);

select is(
  (
    (select count(*) from public.sync_jobs where profile_id = '00000000-0000-0000-0000-0000000000f6')
    + (select count(*) from public.sync_runs where profile_id = '00000000-0000-0000-0000-0000000000f6')
  )::integer,
  0,
  'hard deletion removes synchronization jobs and runs'
);

select is(
  (
    (select count(*) from public.daily_problem_completions
      where profile_id = '00000000-0000-0000-0000-0000000000f6')
    + (select count(*) from public.daily_problem_comments
      where author_id = '00000000-0000-0000-0000-0000000000f6')
  )::integer,
  0,
  'hard deletion removes personal daily problem completion and discussion identities'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where metadata = '{"anonymized":"account_deletion"}'::jsonb
  ),
  'account deletion keeps an anonymous operational audit event'
);

select ok(
  not exists (
    select 1
    from public.audit_logs as log
    where concat_ws(
      ' ',
      log.actor_id::text,
      log.target_id,
      log.before_data::text,
      log.after_data::text,
      log.metadata::text
    ) similar to '%(00000000-0000-0000-0000-0000000000f6|Deletion Fixture|19999999999|DeletionFixtureHandle)%'
  ),
  'audit rows retain no deleted member identifiers or personal values'
);

select ok(
  not exists (
    select 1
    from public.audit_logs
    where metadata = '{"anonymized":"account_deletion"}'::jsonb
      and (
        actor_id is not null
        or target_id is not null
        or before_data is not null
        or after_data is not null
      )
  ),
  'anonymized audit events retain only action, table, timestamp, and marker'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000f7',
  'authenticated',
  'authenticated',
  'active-sync-delete@example.test',
  'test-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Active Sync Delete Fixture"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

insert into public.sync_jobs (
  id, scope, profile_id, status, trigger_type
)
overriding system value
values (
  99603,
  'member',
  '00000000-0000-0000-0000-0000000000f7',
  'queued',
  'manual'
);

insert into public.audit_logs (
  action, target_table, target_id, metadata
)
values (
  'active_sync_delete_fixture',
  'profiles',
  '00000000-0000-0000-0000-0000000000f7',
  '{"profile_id":"00000000-0000-0000-0000-0000000000f7"}'::jsonb
);

do $$
begin
  if not public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000012',
    '00000000-0000-0000-0000-0000000000f7'
  ) then
    raise exception 'Could not acquire the active-sync guard test lease';
  end if;
  perform pg_catalog.set_config(
    'app.account_deletion_owner_token',
    '10000000-0000-4000-8000-000000000012',
    true
  );
  perform pg_catalog.set_config(
    'app.account_deletion_target_user_id',
    '00000000-0000-0000-0000-0000000000f7',
    true
  );
end;
$$;

select throws_ok(
  $$
    delete from auth.users
    where id = '00000000-0000-0000-0000-0000000000f7'
  $$,
  '55006',
  'Account synchronization is active.',
  'database deletion fails closed when synchronization becomes active'
);

select public.release_account_deletion_recovery_lease(
  '10000000-0000-4000-8000-000000000012',
  '00000000-0000-0000-0000-0000000000f7'
);

select is(
  (
    (select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000f7')
    + (select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000f7')
    + (select count(*) from public.sync_jobs where id = 99603)
  )::integer,
  3,
  'a rejected deletion preserves the Auth user, profile, and active job'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where action = 'active_sync_delete_fixture'
      and target_id = '00000000-0000-0000-0000-0000000000f7'
      and metadata = '{"profile_id":"00000000-0000-0000-0000-0000000000f7"}'::jsonb
  ),
  1,
  'a rejected deletion does not partially anonymize the active member audit trail'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000fa',
    'authenticated',
    'authenticated',
    'former-admin@example.test',
    'test-password',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Former Administrator"}'::jsonb,
    now(),
    now(),
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000fb',
    'authenticated',
    'authenticated',
    'approved-member@example.test',
    'test-password',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Approved Member"}'::jsonb,
    now(),
    now(),
    '', '', '', ''
  );

update public.profiles
set
  full_name = 'Former Administrator',
  qq = '18888888888',
  major = 'Computer Science',
  grade = '22级',
  role = 'admin',
  review_status = 'approved'
where id = '00000000-0000-0000-0000-0000000000fa';

update public.profiles
set
  full_name = 'Approved Member',
  qq = '17777777777',
  major = 'Software Engineering',
  grade = '23级',
  review_status = 'approved',
  approved_by = '00000000-0000-0000-0000-0000000000fa'
where id = '00000000-0000-0000-0000-0000000000fb';

insert into public.announcements (
  id, title, body, status, created_by, updated_by
)
overriding system value
values (
  99604,
  'Former administrator fixture',
  'Audit foreign-key cleanup fixture.',
  'draft',
  '00000000-0000-0000-0000-0000000000fa',
  '00000000-0000-0000-0000-0000000000fa'
);

insert into public.daily_problems (
  id, problem_date, title, source_platform, external_problem_id, source_url,
  difficulty, tags, training_note, estimated_minutes, status, published_at,
  created_by, updated_by
)
overriding system value
values (
  99607,
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 101,
  'Former administrator daily problem fixture',
  'Luogu',
  'P1000',
  'https://www.luogu.com.cn/problem/P1000',
  '入门',
  array['lifecycle'],
  'Former administrator Auth-reference fixture.',
  10,
  'published',
  pg_catalog.clock_timestamp() - interval '101 days',
  '00000000-0000-0000-0000-0000000000fa',
  '00000000-0000-0000-0000-0000000000fa'
);

insert into public.daily_problem_comments (
  id, problem_id, author_id, body, is_visible, hidden_at, hidden_by
)
overriding system value
values (
  99608,
  99607,
  '00000000-0000-0000-0000-0000000000fb',
  'Former administrator moderation reference fixture.',
  false,
  pg_catalog.clock_timestamp(),
  '00000000-0000-0000-0000-0000000000fa'
);

insert into public.audit_logs (
  actor_id, action, target_table, target_id, metadata
)
values (
  '00000000-0000-0000-0000-0000000000fa',
  'admin_delete_guard_fixture',
  'profiles',
  '00000000-0000-0000-0000-0000000000fa',
  '{"profile_id":"00000000-0000-0000-0000-0000000000fa"}'::jsonb
);

do $$
begin
  if not public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000013',
    '00000000-0000-0000-0000-0000000000fa'
  ) then
    raise exception 'Could not acquire the administrator guard test lease';
  end if;
  perform pg_catalog.set_config(
    'app.account_deletion_owner_token',
    '10000000-0000-4000-8000-000000000013',
    true
  );
  perform pg_catalog.set_config(
    'app.account_deletion_target_user_id',
    '00000000-0000-0000-0000-0000000000fa',
    true
  );
end;
$$;

select throws_ok(
  $$
    delete from auth.users
    where id = '00000000-0000-0000-0000-0000000000fa'
  $$,
  '42501',
  'Administrator profiles must be demoted before account deletion.',
  'a current administrator cannot be deleted through the Auth cascade'
);

select public.release_account_deletion_recovery_lease(
  '10000000-0000-4000-8000-000000000013',
  '00000000-0000-0000-0000-0000000000fa'
);

select is(
  (
    (select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000fa')
    + (select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000fa')
  )::integer,
  2,
  'a rejected administrator deletion preserves both Auth user and profile'
);

select ok(
  (
    select role = 'admin'
    from public.profiles
    where id = '00000000-0000-0000-0000-0000000000fa'
  )
  and (
    select created_by = '00000000-0000-0000-0000-0000000000fa'
      and updated_by = '00000000-0000-0000-0000-0000000000fa'
    from public.announcements
    where id = 99604
  )
  and (
    select approved_by = '00000000-0000-0000-0000-0000000000fa'
    from public.profiles
    where id = '00000000-0000-0000-0000-0000000000fb'
  )
  and (
    select created_by = '00000000-0000-0000-0000-0000000000fa'
      and updated_by = '00000000-0000-0000-0000-0000000000fa'
    from public.daily_problems
    where id = 99607
  )
  and (
    select hidden_by = '00000000-0000-0000-0000-0000000000fa'
    from public.daily_problem_comments
    where id = 99608
  )
  and exists (
    select 1
    from public.audit_logs
    where action = 'admin_delete_guard_fixture'
      and actor_id = '00000000-0000-0000-0000-0000000000fa'
      and target_id = '00000000-0000-0000-0000-0000000000fa'
      and metadata = '{"profile_id":"00000000-0000-0000-0000-0000000000fa"}'::jsonb
  ),
  'a rejected administrator deletion rolls back preparatory Auth-reference and audit scrubbing'
);

update public.profiles
set role = 'member'
where id = '00000000-0000-0000-0000-0000000000fa';

do $$
begin
  if not public.acquire_account_deletion_recovery_lease(
    '10000000-0000-4000-8000-000000000014',
    '00000000-0000-0000-0000-0000000000fa'
  ) then
    raise exception 'Could not acquire the former-administrator deletion test lease';
  end if;
  perform pg_catalog.set_config(
    'app.account_deletion_owner_token',
    '10000000-0000-4000-8000-000000000014',
    true
  );
  perform pg_catalog.set_config(
    'app.account_deletion_target_user_id',
    '00000000-0000-0000-0000-0000000000fa',
    true
  );
end;
$$;

delete from auth.users
where id = '00000000-0000-0000-0000-0000000000fa';

select public.release_account_deletion_recovery_lease(
  '10000000-0000-4000-8000-000000000014',
  '00000000-0000-0000-0000-0000000000fa'
);

select is(
  (
    (select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000fa')
    + (select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000fa')
  )::integer,
  0,
  'a downgraded former administrator can be deleted after handover'
);

select ok(
  (
    select created_by is null and updated_by is null
    from public.announcements
    where id = 99604
  )
  and (
    select approved_by is null
    from public.profiles
    where id = '00000000-0000-0000-0000-0000000000fb'
  )
  and (
    select created_by is null and updated_by is null
    from public.daily_problems
    where id = 99607
  )
  and (
    select hidden_by is null
    from public.daily_problem_comments
    where id = 99608
  ),
  'Auth foreign keys owned by a deleted former administrator are cleared across learning content'
);

select ok(
  not exists (
    select 1
    from public.audit_logs as log
    where concat_ws(
      ' ',
      log.actor_id::text,
      log.target_id,
      log.before_data::text,
      log.after_data::text,
      log.metadata::text
    ) similar to '%(00000000-0000-0000-0000-0000000000fa|Former Administrator|18888888888)%'
  ),
  'former-administrator UUID and personal fields are removed from cross-table audit rows'
);

select ok(
  public.is_trusted_profile_management_actor('supabase_auth_admin'::name, null)
  and not public.is_trusted_profile_management_actor('authenticator'::name, 'authenticated'),
  'Supabase Auth cleanup is trusted without granting the browser authentication role'
);

select * from finish();

rollback;
