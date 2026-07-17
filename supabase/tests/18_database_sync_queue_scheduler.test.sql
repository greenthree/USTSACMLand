begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select ok(
  exists (select 1 from pg_extension where extname = 'pg_cron'),
  'pg_cron is installed'
);

select ok(
  exists (select 1 from pg_extension where extname = 'pg_net'),
  'pg_net is installed'
);

select ok(
  to_regclass('private.sync_queue_scheduler_state') is not null,
  'the private scheduler state table exists'
);

select is(
  (
    select count(*)::integer
    from cron.job
    where jobname = 'sync-queue-every-five-minutes'
      and schedule = '*/5 * * * *'
      and active
  ),
  1,
  'one active five-minute queue scheduler exists'
);

select ok(
  (
    select command = 'select private.invoke_sync_queue_scheduler();'
    from cron.job
    where jobname = 'sync-queue-every-five-minutes'
  ),
  'the cron command contains only the private function call'
);

select ok(
  (
    select command !~* '(bearer|apikey|token)'
    from cron.job
    where jobname = 'sync-queue-every-five-minutes'
  ),
  'the cron catalog stores no credential material'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.read_sync_queue_scheduler_health()',
    'EXECUTE'
  ),
  'anonymous users cannot read scheduler health'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.read_sync_queue_scheduler_health()',
    'EXECUTE'
  ),
  'authenticated users cannot read scheduler health'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.read_sync_queue_scheduler_health()',
    'EXECUTE'
  ),
  'service role can read non-secret scheduler health'
);

select ok(
  not has_function_privilege(
    'service_role',
    'private.invoke_sync_queue_scheduler()',
    'EXECUTE'
  ),
  'service role cannot invoke the private scheduler directly'
);

select ok(
  not has_table_privilege(
    'service_role',
    'private.sync_queue_scheduler_state',
    'SELECT'
  ),
  'service role cannot read private scheduler state directly'
);

set local role service_role;
create temporary table scheduler_health as
select public.read_sync_queue_scheduler_health() as value;
reset role;

select is(
  (select (value ->> 'cronActive')::boolean from scheduler_health),
  true,
  'health reports the configured cron as active'
);

select is(
  (select (value ->> 'configured')::boolean from scheduler_health),
  false,
  'an empty local Vault is reported as unconfigured'
);

select is(
  (select (value ->> 'recentCronSuccesses')::integer from scheduler_health),
  0,
  'an unconfigured local Vault cannot fabricate a successful scheduler run'
);

select * from finish();

rollback;
