begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class as rel
    join pg_catalog.pg_namespace as ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = any(array[
        'profiles', 'platform_accounts', 'platform_stats', 'stat_snapshots',
        'sync_jobs', 'sync_runs', 'announcements', 'audit_logs'
      ])
      and rel.relrowsecurity
  ),
  8,
  'all core tables have row level security enabled'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class as rel
    join pg_catalog.pg_namespace as ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = any(array['xcpc_elo_cache_state', 'xcpc_elo_cache_players'])
      and rel.relrowsecurity
  ),
  2,
  'XCPC ELO cache tables have row level security enabled'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'public.xcpc_elo_cache_state', 'SELECT')
    and not pg_catalog.has_table_privilege('anon', 'public.xcpc_elo_cache_players', 'SELECT')
    and not pg_catalog.has_table_privilege(
      'authenticated', 'public.xcpc_elo_cache_state', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'public.xcpc_elo_cache_players', 'SELECT'
    ),
  'browser roles cannot read the XCPC ELO cache'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'public.xcpc_elo_cache_state', 'INSERT')
    and not pg_catalog.has_table_privilege('anon', 'public.xcpc_elo_cache_players', 'UPDATE')
    and not pg_catalog.has_table_privilege(
      'authenticated', 'public.xcpc_elo_cache_state', 'UPDATE'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'public.xcpc_elo_cache_players', 'DELETE'
    ),
  'browser roles cannot write the XCPC ELO cache'
);

select ok(
  not pg_catalog.has_table_privilege('service_role', 'public.xcpc_elo_cache_state', 'SELECT')
    and not pg_catalog.has_table_privilege(
      'service_role', 'public.xcpc_elo_cache_players', 'INSERT'
    ),
  'service role must maintain the XCPC ELO cache through controlled RPCs'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any(array['xcpc_elo_cache_state', 'xcpc_elo_cache_players'])
  ),
  0,
  'XCPC ELO cache tables expose no browser RLS policies'
);

select ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.read_xcpc_elo_cache()', 'EXECUTE')
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.acquire_xcpc_elo_cache_refresh(uuid,integer,integer)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.commit_xcpc_elo_cache_refresh(uuid,integer,text,text,timestamptz,jsonb)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.validate_xcpc_elo_cache_refresh(uuid,integer,text,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.fail_xcpc_elo_cache_refresh(uuid,public.sync_error_code,text,integer)',
      'EXECUTE'
    ),
  'authenticated users cannot call XCPC ELO cache RPCs'
);

select ok(
  pg_catalog.has_function_privilege('service_role', 'public.read_xcpc_elo_cache()', 'EXECUTE')
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.acquire_xcpc_elo_cache_refresh(uuid,integer,integer)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.commit_xcpc_elo_cache_refresh(uuid,integer,text,text,timestamptz,jsonb)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.validate_xcpc_elo_cache_refresh(uuid,integer,text,text)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.fail_xcpc_elo_cache_refresh(uuid,public.sync_error_code,text,integer)',
      'EXECUTE'
    ),
  'service role can call all XCPC ELO cache RPCs'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname like '%xcpc_elo_cache%'
      and not proc.prosecdef
  ),
  'all XCPC ELO cache functions are SECURITY DEFINER'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname like '%xcpc_elo_cache%'
      and coalesce(proc.proconfig::text, '') not like '%search_path=%'
  ),
  'all XCPC ELO cache functions pin their search path'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'profiles', 'platform_accounts', 'platform_stats',
        'stat_snapshots', 'sync_jobs', 'sync_runs'
      ])
      and policyname like '%admin_all'
  ),
  0,
  'core tables do not expose administrator FOR ALL policies'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and policyname = any(array[
        'profiles_admin_select', 'platform_accounts_admin_select',
        'platform_stats_admin_select', 'stat_snapshots_admin_select',
        'sync_jobs_admin_select', 'sync_runs_admin_select'
      ])
      and cmd = 'SELECT'
  ),
  6,
  'administrators receive explicit read-only core table policies'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'authenticated users cannot insert or delete profiles directly'
);

select ok(
  pg_catalog.has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
    and pg_catalog.has_column_privilege('authenticated', 'public.profiles', 'qq', 'UPDATE')
    and pg_catalog.has_column_privilege('authenticated', 'public.profiles', 'grade', 'UPDATE'),
  'members retain column-scoped profile editing privileges'
);

select ok(
  not pg_catalog.has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
    and not pg_catalog.has_column_privilege(
      'authenticated', 'public.profiles', 'review_status', 'UPDATE'
    ),
  'authenticated users cannot update managed profile fields'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.platform_stats', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.platform_stats', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.platform_stats', 'DELETE'),
  'authenticated users cannot write platform statistics directly'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.stat_snapshots', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.stat_snapshots', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.stat_snapshots', 'DELETE'),
  'authenticated users cannot write statistic snapshots directly'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.sync_jobs', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.sync_jobs', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.sync_jobs', 'DELETE'),
  'authenticated users cannot write synchronization jobs directly'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.sync_runs', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.sync_runs', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.sync_runs', 'DELETE'),
  'authenticated users cannot write synchronization runs directly'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'platform_accounts'
      and policyname = any(array[
        'platform_accounts_insert_self',
        'platform_accounts_update_self',
        'platform_accounts_delete_self'
      ])
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%xcpc_elo%'
  ),
  3,
  'member platform account policies exclude XCPC ELO writes'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname like 'admin_%'
      and not proc.prosecdef
  ),
  'all administrator functions are SECURITY DEFINER'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname like 'admin_%'
      and coalesce(proc.proconfig::text, '') not like '%search_path=%'
  ),
  'all administrator functions pin their search path'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'public.bootstrap_first_admin(text)', 'EXECUTE'
  ),
  'authenticated users cannot bootstrap an administrator'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.bootstrap_first_admin(text)', 'EXECUTE'
  ),
  'service role can execute the one-time administrator bootstrap'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_members'
      and column_name = any(array['qq', 'role', 'review_status', 'review_note'])
  ),
  0,
  'public member view excludes private and managed profile fields'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_platform_stats'
      and column_name = 'error_message'
  ),
  0,
  'public statistics view excludes raw error messages'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_constraint as con
    join pg_catalog.pg_class as rel on rel.oid = con.conrelid
    join pg_catalog.pg_namespace as ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'platform_accounts'
      and con.conname = any(array[
        'platform_accounts_profile_platform_unique',
        'platform_accounts_platform_external_unique'
      ])
      and con.contype = 'u'
  ),
  2,
  'platform account ownership and duplicate binding constraints exist'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'stat_snapshots'
      and indexname = 'stat_snapshots_success_source_unique_idx'
      and indexdef like 'CREATE UNIQUE INDEX%'
  ),
  1,
  'successful source snapshots have an idempotency index'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'daily_problems', 'daily_problem_completions', 'daily_problem_comments'
      ])
      and relation.relrowsecurity
  ),
  3,
  'all daily learning identity tables enable row level security'
);

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) as browser(role_name)
    cross join unnest(array[
      'public.daily_problems',
      'public.daily_problem_completions',
      'public.daily_problem_comments'
    ]) as base_table(table_name)
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as access(privilege_name)
    where pg_catalog.has_table_privilege(
      browser.role_name,
      base_table.table_name,
      access.privilege_name
    )
  ),
  'daily learning identities have no browser-facing base-table privileges'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'require_daily_problem_member',
        'read_daily_problem_feed',
        'set_own_daily_problem_completion',
        'list_daily_problem_comments',
        'create_daily_problem_comment',
        'delete_own_daily_problem_comment',
        'admin_list_daily_problems',
        'admin_upsert_daily_problem',
        'admin_delete_daily_problem',
        'admin_set_daily_problem_comment_visibility'
      ])
      and (
        not procedure.prosecdef
        or coalesce(procedure.proconfig::text, '') not like '%search_path=%'
      )
  ),
  'daily learning RPCs are SECURITY DEFINER and pin their search path'
);

select ok(
  pg_catalog.has_function_privilege(
    'anon', 'public.read_daily_problem_feed(integer,date)', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.list_daily_problem_comments(bigint,integer,bigint)', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.set_own_daily_problem_completion(bigint,boolean)', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.admin_list_daily_problems(integer,bigint)', 'EXECUTE'
    ),
  'anonymous access is limited to the sanitized daily problem feed'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.admin_list_webchat_pilot_members()', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.admin_list_webchat_pilot_members()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role', 'public.admin_list_webchat_pilot_members()', 'EXECUTE'
    ),
  'the WebChat pilot roster is reachable only through the authenticated administrator boundary'
);

select * from finish();

rollback;
