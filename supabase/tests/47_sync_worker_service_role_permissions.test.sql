begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT'),
  'the synchronization worker can read member profiles'
);

select ok(
  not pg_catalog.has_table_privilege('service_role', 'public.profiles', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.profiles', 'UPDATE')
    and not pg_catalog.has_table_privilege('service_role', 'public.profiles', 'DELETE'),
  'the synchronization worker cannot mutate member profiles directly'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.platform_accounts', 'SELECT')
    and not pg_catalog.has_table_privilege('service_role', 'public.platform_accounts', 'UPDATE'),
  'the synchronization worker can read platform accounts without table-wide update access'
);

select ok(
  pg_catalog.has_column_privilege(
    'service_role',
    'public.platform_accounts',
    'external_id',
    'UPDATE'
  )
    and pg_catalog.has_column_privilege(
      'service_role',
      'public.platform_accounts',
      'status',
      'UPDATE'
    )
    and pg_catalog.has_column_privilege(
      'service_role',
      'public.platform_accounts',
      'verification_error_code',
      'UPDATE'
    )
    and pg_catalog.has_column_privilege(
      'service_role',
      'public.platform_accounts',
      'verification_error_message',
      'UPDATE'
    ),
  'the synchronization worker can update only account verification inputs'
);

select ok(
  not pg_catalog.has_column_privilege(
    'service_role',
    'public.platform_accounts',
    'profile_id',
    'UPDATE'
  )
    and not pg_catalog.has_column_privilege(
      'service_role',
      'public.platform_accounts',
      'platform',
      'UPDATE'
    )
    and not pg_catalog.has_column_privilege(
      'service_role',
      'public.platform_accounts',
      'normalized_external_id',
      'UPDATE'
    )
    and not pg_catalog.has_column_privilege(
      'service_role',
      'public.platform_accounts',
      'verified_at',
      'UPDATE'
    ),
  'the synchronization worker cannot reassign or directly normalize platform accounts'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.platform_stats', 'SELECT'),
  'the synchronization worker can read retained platform statistics'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.luogu_sync_states', 'SELECT'),
  'the synchronization worker can read Luogu incremental state'
);

select ok(
  not pg_catalog.has_table_privilege('service_role', 'public.luogu_sync_states', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.luogu_sync_states', 'UPDATE')
    and not pg_catalog.has_table_privilege('service_role', 'public.luogu_sync_states', 'DELETE'),
  'the synchronization worker cannot bypass atomic Luogu checkpoint commits'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.sync_jobs', 'SELECT')
    and pg_catalog.has_table_privilege('service_role', 'public.sync_jobs', 'INSERT')
    and pg_catalog.has_table_privilege('service_role', 'public.sync_jobs', 'UPDATE'),
  'the synchronization worker can orchestrate durable jobs'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.sync_runs', 'SELECT')
    and pg_catalog.has_table_privilege('service_role', 'public.sync_runs', 'INSERT')
    and pg_catalog.has_table_privilege('service_role', 'public.sync_runs', 'UPDATE'),
  'the synchronization worker can record platform attempts'
);

select ok(
  pg_catalog.has_sequence_privilege('service_role', 'public.sync_jobs_id_seq', 'USAGE')
    and pg_catalog.has_sequence_privilege('service_role', 'public.sync_jobs_id_seq', 'SELECT'),
  'the synchronization worker can allocate durable job IDs'
);

select ok(
  pg_catalog.has_sequence_privilege('service_role', 'public.sync_runs_id_seq', 'USAGE')
    and pg_catalog.has_sequence_privilege('service_role', 'public.sync_runs_id_seq', 'SELECT'),
  'the synchronization worker can allocate run IDs'
);

select ok(
  not pg_catalog.has_table_privilege('service_role', 'public.platform_stats', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.platform_stats', 'UPDATE')
    and not pg_catalog.has_table_privilege('service_role', 'public.platform_stats', 'DELETE'),
  'the synchronization worker cannot bypass atomic platform statistics commits'
);

select ok(
  not pg_catalog.has_table_privilege('service_role', 'public.stat_snapshots', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.stat_snapshots', 'UPDATE')
    and not pg_catalog.has_table_privilege('service_role', 'public.stat_snapshots', 'DELETE'),
  'the synchronization worker cannot write snapshots outside atomic commit functions'
);

select ok(
  not pg_catalog.has_table_privilege('service_role', 'public.sync_jobs', 'DELETE'),
  'the synchronization worker cannot delete audit-relevant jobs'
);

select ok(
  not pg_catalog.has_table_privilege('service_role', 'public.sync_runs', 'DELETE'),
  'the synchronization worker cannot delete audit-relevant runs'
);

select ok(
  not pg_catalog.has_table_privilege('service_role', 'public.platform_accounts', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.platform_accounts', 'DELETE'),
  'the synchronization worker cannot create or delete platform account bindings'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.sync_jobs', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.sync_jobs', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.sync_jobs', 'DELETE'),
  'ordinary users remain unable to mutate synchronization jobs'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.sync_runs', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.sync_runs', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.sync_runs', 'DELETE'),
  'ordinary users remain unable to mutate synchronization runs'
);

select * from finish();

rollback;
