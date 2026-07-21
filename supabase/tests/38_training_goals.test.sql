begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003801',
    'authenticated', 'authenticated', 'goal-member-a@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Goal Member A"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003802',
    'authenticated', 'authenticated', 'goal-member-b@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Goal Member B"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003803',
    'authenticated', 'authenticated', 'goal-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Goal Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000003804',
    'authenticated', 'authenticated', 'goal-suspended@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Goal Suspended"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  full_name = case id
    when '00000000-0000-0000-0000-000000003801' then 'Goal Member A'
    when '00000000-0000-0000-0000-000000003802' then 'Goal Member B'
    when '00000000-0000-0000-0000-000000003803' then 'Goal Administrator'
    else 'Goal Suspended'
  end,
  qq = case id
    when '00000000-0000-0000-0000-000000003801' then '13800000001'
    when '00000000-0000-0000-0000-000000003802' then '13800000002'
    when '00000000-0000-0000-0000-000000003803' then '13800000003'
    else '13800000004'
  end,
  grade = '24级',
  major = '计算机科学与技术',
  role = case
    when id = '00000000-0000-0000-0000-000000003803'
      then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = case
    when id = '00000000-0000-0000-0000-000000003804'
      then 'suspended'::public.profile_review_status
    else 'approved'::public.profile_review_status
  end,
  approved_at = now();

insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status, verified_at
)
values
  (
    '00000000-0000-0000-0000-000000003801',
    'codeforces', 'GoalMemberA', 'goalmembera', 'verified', now()
  ),
  (
    '00000000-0000-0000-0000-000000003801',
    'atcoder', 'GoalMemberA', 'goalmembera', 'verified', now()
  );

create or replace function pg_temp.record_training_snapshot(
  target_profile_id uuid,
  target_platform public.platform_name,
  target_run_status public.sync_run_status,
  target_rating integer,
  target_solved integer,
  target_recorded_at timestamptz
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  saved_job_id bigint;
  saved_run_id bigint;
begin
  insert into public.sync_jobs (
    scope, profile_id, platform, status, trigger_type, attempt_count,
    max_attempts, scheduled_for, started_at, finished_at
  ) values (
    'account', target_profile_id, target_platform,
    case
      when target_run_status = 'succeeded' then 'succeeded'::public.sync_job_status
      else 'failed'::public.sync_job_status
    end,
    'manual', 1, 2, target_recorded_at, target_recorded_at, target_recorded_at
  ) returning id into saved_job_id;

  insert into public.sync_runs (
    job_id, profile_id, platform, attempt, status, started_at, finished_at,
    source_version
  ) values (
    saved_job_id, target_profile_id, target_platform, 1, target_run_status,
    target_recorded_at - interval '1 second', target_recorded_at,
    'training-goal-test'
  ) returning id into saved_run_id;

  insert into public.stat_snapshots (
    profile_id, platform, sync_run_id, current_rating, max_rating,
    solved_count, status, recorded_at
  ) values (
    target_profile_id, target_platform, saved_run_id, target_rating,
    target_rating, target_solved, 'fresh', target_recorded_at
  );

  return saved_run_id;
end;
$$;

select pg_temp.record_training_snapshot(
  '00000000-0000-0000-0000-000000003801',
  'codeforces', 'succeeded', 1400, 100, now() - interval '3 hours'
);
select pg_temp.record_training_snapshot(
  '00000000-0000-0000-0000-000000003801',
  'atcoder', 'succeeded', 900, 30, now() - interval '3 hours'
);
select pg_temp.record_training_snapshot(
  '00000000-0000-0000-0000-000000003801',
  'codeforces', 'failed', 1, 1, now() - interval '2 hours'
);

create temporary table training_goal_ids (
  label text primary key,
  goal_id bigint not null
) on commit drop;
grant select, insert on training_goal_ids to authenticated;

select has_table('public', 'training_goals', 'private training goals table exists');

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.training_goals'::regclass
  ),
  'training goals enable row level security'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.training_goals'::regclass
      and constraint_record.contype = 'f'
      and constraint_record.confrelid = 'public.profiles'::regclass
      and constraint_record.confdeltype = 'c'
  ),
  'training goals are deleted with their member profile'
);

select ok(
  pg_catalog.has_table_privilege('authenticated', 'public.training_goals', 'SELECT')
    and not pg_catalog.has_table_privilege(
      'authenticated', 'public.training_goals', 'INSERT,UPDATE,DELETE'
    ),
  'browser sessions can read through RLS but cannot forge goal baselines or lifecycle fields'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.list_own_training_goals()', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'authenticated',
      'public.create_own_training_goal(text,public.training_goal_metric,public.platform_name,integer,date)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.export_own_training_goals()', 'EXECUTE'
    ),
  'authenticated sessions can reach only target-free or identity-derived goal RPCs'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.list_own_training_goals()', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.create_own_training_goal(text,public.training_goal_metric,public.platform_name,integer,date)',
      'EXECUTE'
    ),
  'anonymous visitors cannot invoke private training goal RPCs'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'require_training_goal_member',
        'compute_training_goal_progress',
        'list_own_training_goals',
        'create_own_training_goal',
        'update_own_training_goal',
        'complete_own_training_goal',
        'archive_own_training_goal',
        'export_own_training_goals'
      ])
      and (
        not procedure.prosecdef
        or coalesce(procedure.proconfig::text, '') not like '%search_path=%'
      )
  ),
  'all private goal helpers and RPCs are SECURITY DEFINER with pinned search paths'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003801', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003801","role":"authenticated"}',
  true
);
set local role authenticated;

insert into training_goal_ids (label, goal_id)
select 'total', goal_id
from public.create_own_training_goal(
  '暑假累计完成 50 题',
  'total_solved',
  null,
  50,
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 30
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'baseline', goal.baseline_value,
      'target', goal.target_value,
      'components', goal.baseline_components
    )
    from public.training_goals as goal
    join training_goal_ids as saved on saved.goal_id = goal.id and saved.label = 'total'
  ),
  '{"baseline":130,"target":180,"components":{"atcoder":30,"codeforces":100}}'::jsonb,
  'total solved creation freezes successful per-platform baselines and converts the requested increase to an absolute target'
);

select is(
  (
    select baseline_value
    from public.training_goals as goal
    join training_goal_ids as saved on saved.goal_id = goal.id and saved.label = 'total'
  ),
  130,
  'a newer snapshot attached to a failed run cannot replace the successful baseline'
);

select is(
  (select count(*)::integer from public.list_own_training_goals()),
  1,
  'the member lists only their own goal'
);

select ok(
  exists (
    select 1
    from public.list_own_training_goals()
    where lifecycle_status = 'active'
      and data_available
      and current_value = 130
      and progress_value = 0
      and progress_percent = 0
  ),
  'a newly created goal starts at zero progress from its immutable baseline'
);

select is(
  (select count(*)::integer from public.training_goals),
  1,
  'the self-select RLS policy exposes the caller own base row'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003802', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003802","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.training_goals),
  0,
  'another ordinary member cannot read the goal base row'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003803', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003803","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.training_goals),
  0,
  'administrator role does not bypass member-owned goal RLS'
);

select is(
  (select count(*)::integer from public.list_own_training_goals()),
  0,
  'administrator goal RPC remains bound to the administrator own identity'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003804', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003804","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select * from public.list_own_training_goals() $$,
  '42501',
  'Approved member access required.',
  'a suspended member cannot read training goals'
);

reset role;

select pg_temp.record_training_snapshot(
  '00000000-0000-0000-0000-000000003801',
  'codeforces', 'succeeded', 1450, 115, now() - interval '50 minutes'
);
select pg_temp.record_training_snapshot(
  '00000000-0000-0000-0000-000000003801',
  'atcoder', 'succeeded', 950, 35, now() - interval '49 minutes'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003801', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000003801","role":"authenticated"}',
  true
);
set local role authenticated;

select ok(
  exists (
    select 1
    from public.list_own_training_goals()
    where current_value = 150
      and progress_value = 20
      and progress_percent = 40
      and not regressed
  ),
  'newer successful snapshots advance total solved progress across the frozen platform set'
);

reset role;
select pg_temp.record_training_snapshot(
  '00000000-0000-0000-0000-000000003801',
  'codeforces', 'failed', 0, 0, now() - interval '40 minutes'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003801', true);
set local role authenticated;

select is(
  (select current_value from public.list_own_training_goals()),
  150::bigint,
  'a later failed run cannot advance or roll back goal progress'
);

reset role;
select pg_temp.record_training_snapshot(
  '00000000-0000-0000-0000-000000003801',
  'codeforces', 'succeeded', 1350, 90, now() - interval '30 minutes'
);
select pg_temp.record_training_snapshot(
  '00000000-0000-0000-0000-000000003801',
  'atcoder', 'succeeded', 940, 35, now() - interval '29 minutes'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003801', true);
set local role authenticated;

select ok(
  exists (
    select 1
    from public.list_own_training_goals()
    where current_value = 125
      and progress_value = 0
      and progress_percent = 0
      and regressed
      and data_message like '%低于创建目标时的基线%'
  ),
  'a successful solved-count regression is explicit and never becomes negative progress'
);

select *
from public.update_own_training_goal(
  (select goal_id from training_goal_ids where label = 'total'),
  '暑假稳定完成 50 题',
  180,
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 35,
  (
    select goal.updated_at
    from public.training_goals as goal
    join training_goal_ids as saved on saved.goal_id = goal.id and saved.label = 'total'
  )
);

select ok(
  exists (
    select 1
    from public.training_goals as goal
    join training_goal_ids as saved on saved.goal_id = goal.id and saved.label = 'total'
    where goal.title = '暑假稳定完成 50 题'
      and goal.baseline_value = 130
      and goal.baseline_components = '{"atcoder":30,"codeforces":100}'::jsonb
      and goal.start_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
  ),
  'editing changes presentation and target fields without rewriting the baseline or start date'
);

select throws_ok(
  $$
    select *
    from public.update_own_training_goal(
      (select goal_id from training_goal_ids where label = 'total'),
      'stale edit',
      180,
      (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 35,
      '2000-01-01T00:00:00Z'::timestamptz
    )
  $$,
  'PT409',
  'Training goal changed after it was loaded. Refresh and try again.',
  'stale goal edits fail with an optimistic conflict'
);

reset role;
delete from public.platform_accounts
where profile_id = '00000000-0000-0000-0000-000000003801'
  and platform = 'atcoder';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003801', true);
set local role authenticated;

select ok(
  exists (
    select 1
    from public.list_own_training_goals()
    where not data_available
      and current_value is null
      and data_message like '%缺少可用的成功同步数据%'
  ),
  'removing a tracked platform makes progress unavailable instead of treating the platform as zero'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '{}', true);
insert into public.platform_accounts (
  profile_id, platform, external_id, normalized_external_id, status, verified_at
)
values (
  '00000000-0000-0000-0000-000000003801',
  'atcoder', 'GoalMemberA', 'goalmembera', 'verified', now()
);
select pg_temp.record_training_snapshot(
  '00000000-0000-0000-0000-000000003801',
  'codeforces', 'succeeded', 1500, 145, now() - interval '10 minutes'
);
select pg_temp.record_training_snapshot(
  '00000000-0000-0000-0000-000000003801',
  'atcoder', 'succeeded', 960, 35, now() - interval '9 minutes'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000003801', true);
set local role authenticated;

select ok(
  exists (
    select 1
    from public.list_own_training_goals()
    where data_available and current_value = 180 and progress_percent = 100
  ),
  'successful snapshots for every tracked platform restore availability and reach the target'
);

select *
from public.complete_own_training_goal(
  (select goal_id from training_goal_ids where label = 'total'),
  (
    select goal.updated_at
    from public.training_goals as goal
    join training_goal_ids as saved on saved.goal_id = goal.id and saved.label = 'total'
  )
);

select ok(
  exists (
    select 1
    from public.list_own_training_goals()
    where lifecycle_status = 'completed' and completed_at is not null
  ),
  'a reached active goal can be explicitly completed and retained in history'
);

select throws_ok(
  $$
    select *
    from public.complete_own_training_goal(
      (select goal_id from training_goal_ids where label = 'total'),
      (
        select goal.updated_at
        from public.training_goals as goal
        join training_goal_ids as saved on saved.goal_id = goal.id and saved.label = 'total'
      )
    )
  $$,
  '55000',
  'Only an active, unexpired goal can be completed.',
  'a completed goal cannot be completed again'
);

insert into training_goal_ids (label, goal_id)
select 'rating', goal_id
from public.create_own_training_goal(
  'Codeforces 达到 1600',
  'platform_rating',
  'codeforces',
  1600,
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 60
);

select ok(
  exists (
    select 1
    from public.training_goals as goal
    join training_goal_ids as saved on saved.goal_id = goal.id and saved.label = 'rating'
    where goal.baseline_value = 1500
      and goal.target_value = 1600
      and goal.baseline_components = '{"codeforces":1500}'::jsonb
  ),
  'a platform Rating goal freezes the latest successful current Rating and stores an absolute target'
);

select throws_ok(
  $$
    select *
    from public.create_own_training_goal(
      'QOJ Rating',
      'platform_rating',
      'qoj',
      1600,
      (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 60
    )
  $$,
  '22023',
  'Selected platform does not provide a Rating goal.',
  'platforms without Rating data cannot be used for Rating goals'
);

select *
from public.archive_own_training_goal(
  (select goal_id from training_goal_ids where label = 'rating'),
  (
    select goal.updated_at
    from public.training_goals as goal
    join training_goal_ids as saved on saved.goal_id = goal.id and saved.label = 'rating'
  )
);

select ok(
  exists (
    select 1
    from public.list_own_training_goals()
    where goal_id = (select goal_id from training_goal_ids where label = 'rating')
      and lifecycle_status = 'archived'
      and archived_at is not null
  ),
  'an active goal can be archived without deleting its history'
);

select is(
  pg_catalog.jsonb_array_length(public.export_own_training_goals()),
  2,
  'the target-free personal export contains only the caller two private goal records'
);

reset role;
delete from public.profiles
where id = '00000000-0000-0000-0000-000000003801';

select is(
  (
    select count(*)::integer
    from public.training_goals
    where profile_id = '00000000-0000-0000-0000-000000003801'
  ),
  0,
  'member profile deletion cascades through all training goal history'
);

select * from finish();
rollback;
