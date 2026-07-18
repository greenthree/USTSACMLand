begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

select has_table('private', 'webchat_cache_probe_runs', 'private cache probe ledger exists');

select ok(
  (
    select class.relrowsecurity
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'private'
      and class.relname = 'webchat_cache_probe_runs'
  )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.webchat_cache_probe_runs', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.webchat_cache_probe_runs', 'SELECT'
    ),
  'the probe ledger keeps RLS enabled and has no direct application reads'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.claim_webchat_cache_probe(uuid,uuid,bigint,integer)', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'service_role', 'public.mark_webchat_cache_probe_started(uuid,uuid)', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.finalize_webchat_cache_probe(uuid,uuid,text,bigint,bigint,bigint,bigint,bigint)',
      'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role', 'public.release_webchat_cache_probe(uuid,uuid,text)', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role', 'public.purge_webchat_cache_probe_runs()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated', 'public.claim_webchat_cache_probe(uuid,uuid,bigint,integer)', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.claim_webchat_cache_probe(uuid,uuid,bigint,integer)', 'EXECUTE'
    ),
  'only service_role receives the cache probe lifecycle RPCs'
);

select is(
  (select pg_catalog.count(*)::integer from cron.job where jobname = 'webchat-cache-probe-retention'),
  1,
  'one cache probe retention job is scheduled'
);

set local role service_role;
create temporary table disabled_probe_claim as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000101',
  10000,
  180
);
reset role;

select is(
  (select decision from disabled_probe_claim),
  'relay_disabled',
  'a disabled or incomplete relay rejects the billable probe before reservation'
);

select is(
  (select pg_catalog.count(*)::integer from private.webchat_cache_probe_runs),
  0,
  'a relay-disabled decision creates no probe ledger row'
);

create temporary table probe_secret as
select vault.create_secret(
  new_secret => 'cache-probe-test-key-0000000000000000',
  new_name => 'webchat_cache_probe_test_key',
  new_description => 'transactional pgTAP cache probe secret'
) as id;

update private.webchat_relay_config
set
  base_url = 'https://relay.cache-probe.example.test/v1',
  model = 'gpt-5.6',
  api_key_secret_id = (select id from probe_secret),
  requests_enabled = true,
  global_daily_request_limit = 100,
  global_daily_token_limit = 1000000
where singleton;

set local role service_role;
create temporary table first_probe_claim as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000102',
  10000,
  180
);
reset role;

select is((select decision from first_probe_claim), 'acquired', 'the first probe acquires its lease');

select ok(
  exists (
    select 1
    from first_probe_claim
    where status = 'claimed'
      and retry_after_seconds is null
      and remaining_global_requests = 98
      and remaining_global_tokens = 990000
  ),
  'claim returns the remaining global request and token budget'
);

select ok(
  exists (
    select 1
    from private.webchat_global_daily_usage
    where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
      and request_count = 2
      and reserved_tokens = 10000
      and total_tokens = 0
  ),
  'claim atomically reserves two requests and the requested token ceiling'
);

set local role service_role;
create temporary table concurrent_probe_claim as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000003',
  '31000000-0000-4000-8000-000000000103',
  10000,
  180
);
reset role;

select is(
  (select decision from concurrent_probe_claim),
  'active_concurrent',
  'a second active probe is fenced before another reservation'
);

set local role service_role;
select is(
  public.mark_webchat_cache_probe_started(
    '31000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000999'
  ),
  false,
  'an incorrect owner token cannot start the probe'
);

select is(
  public.mark_webchat_cache_probe_started(
    '31000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000102'
  ),
  true,
  'the owning worker marks the probe started immediately before upstream I/O'
);
reset role;

select ok(
  exists (
    select 1 from private.webchat_cache_probe_runs
    where id = '31000000-0000-4000-8000-000000000002'
      and status = 'started'
      and upstream_started_at is not null
      and finished_at is null
  ),
  'the started transition preserves an active lease and records no prompt content'
);

set local role service_role;
create temporary table known_probe_finish as
select * from public.finalize_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000102',
  'cache_hit',
  2400,
  200,
  2600,
  1200,
  1200
);
reset role;

select ok(
  exists (
    select 1 from known_probe_finish
    where transitioned and status = 'finished' and charged_tokens = 2600
  ),
  'known aggregate usage settles the started probe at its actual token count'
);

select ok(
  exists (
    select 1 from private.webchat_global_daily_usage
    where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
      and request_count = 2
      and reserved_tokens = 0
      and input_tokens = 2400
      and output_tokens = 200
      and unknown_tokens = 0
      and total_tokens = 2600
  ),
  'known completion moves the reservation into global settled usage'
);

select ok(
  exists (
    select 1 from private.webchat_cache_probe_runs
    where id = '31000000-0000-4000-8000-000000000002'
      and status = 'finished'
      and cached_input_tokens = 1200
      and cache_write_tokens = 1200
      and outcome = 'cache_hit'
  ),
  'the sanitized ledger retains only aggregate usage and cache counters'
);

set local role service_role;
create temporary table duplicate_probe_claim as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000102',
  10000,
  180
);
create temporary table cooldown_probe_claim as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000004',
  '31000000-0000-4000-8000-000000000104',
  10000,
  180
);
reset role;

select is((select decision from duplicate_probe_claim), 'duplicate', 'probe IDs are idempotent');
select is((select decision from cooldown_probe_claim), 'cooldown', 'terminal probes enforce a 30-minute cooldown');

update private.webchat_cache_probe_runs
set claimed_at = pg_catalog.clock_timestamp() - interval '31 minutes'
where status = 'finished';

set local role service_role;
create temporary table releasable_probe_claim as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000005',
  '31000000-0000-4000-8000-000000000105',
  5000,
  180
);
reset role;

select is((select decision from releasable_probe_claim), 'acquired', 'a new probe can claim after cooldown');

set local role service_role;
select is(
  public.release_webchat_cache_probe(
    '31000000-0000-4000-8000-000000000005',
    '31000000-0000-4000-8000-000000000105',
    'runtime_config_failed'
  ),
  true,
  'a failure before upstream I/O releases the full reservation'
);
reset role;

select ok(
  exists (
    select 1 from private.webchat_global_daily_usage
    where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
      and request_count = 2
      and reserved_tokens = 0
      and total_tokens = 2600
  ),
  'pre-start release refunds both request slots and all reserved tokens'
);

select ok(
  exists (
    select 1 from private.webchat_cache_probe_runs
    where id = '31000000-0000-4000-8000-000000000005'
      and status = 'released'
      and not request_counted
      and charged_tokens = 0
  ),
  'released runs remain terminal without consuming request count'
);

update private.webchat_cache_probe_runs
set claimed_at = pg_catalog.clock_timestamp() - interval '31 minutes'
where status not in ('claimed', 'started');

set local role service_role;
create temporary table unknown_probe_claim as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000006',
  '31000000-0000-4000-8000-000000000106',
  4000,
  180
);
select is(
  (select decision from unknown_probe_claim),
  'acquired',
  'an unknown-usage scenario first acquires a normal reservation'
);
select is(
  public.mark_webchat_cache_probe_started(
    '31000000-0000-4000-8000-000000000006',
    '31000000-0000-4000-8000-000000000106'
  ),
  true,
  'the unknown-usage scenario crosses the upstream-start boundary'
);
create temporary table unknown_probe_finish as
select * from public.finalize_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000006',
  '31000000-0000-4000-8000-000000000106',
  'upstream_protocol_error'
);
reset role;

select ok(
  exists (
    select 1 from unknown_probe_finish
    where transitioned and charged_tokens = 4000
  ),
  'missing upstream usage is conservatively charged at the reservation ceiling'
);

select ok(
  exists (
    select 1 from private.webchat_global_daily_usage
    where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
      and request_count = 4
      and reserved_tokens = 0
      and input_tokens = 2400
      and output_tokens = 200
      and unknown_tokens = 4000
      and total_tokens = 6600
  ),
  'unknown completion is isolated in the global unknown-token bucket'
);

update private.webchat_cache_probe_runs
set claimed_at = pg_catalog.clock_timestamp() - interval '31 minutes'
where status not in ('claimed', 'started');

set local role service_role;
create temporary table stale_claimed_probe as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000007',
  '31000000-0000-4000-8000-000000000107',
  2000,
  180
);
reset role;

select is((select decision from stale_claimed_probe), 'acquired', 'a claimed lease is created for stale recovery');

update private.webchat_cache_probe_runs
set
  claimed_at = pg_catalog.clock_timestamp() - interval '2 minutes',
  lease_expires_at = pg_catalog.clock_timestamp() - interval '1 minute'
where id = '31000000-0000-4000-8000-000000000007';

set local role service_role;
create temporary table stale_claimed_recovery as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000008',
  '31000000-0000-4000-8000-000000000108',
  2000,
  180
);
reset role;

select is(
  (select decision from stale_claimed_recovery),
  'cooldown',
  'reconciling a stale pre-start lease enters cooldown without a new claim'
);

select ok(
  exists (
    select 1 from private.webchat_cache_probe_runs
    where id = '31000000-0000-4000-8000-000000000007'
      and status = 'expired'
      and outcome = 'lease_expired_before_start'
      and not request_counted
      and charged_tokens = 0
  )
    and exists (
      select 1 from private.webchat_global_daily_usage
      where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
        and request_count = 4
        and reserved_tokens = 0
        and total_tokens = 6600
    ),
  'stale pre-start recovery refunds request slots and reservation exactly once'
);

update private.webchat_cache_probe_runs
set claimed_at = pg_catalog.clock_timestamp() - interval '31 minutes'
where status not in ('claimed', 'started');

set local role service_role;
create temporary table stale_started_probe as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000009',
  '31000000-0000-4000-8000-000000000109',
  3000,
  180
);
select is(
  public.mark_webchat_cache_probe_started(
    '31000000-0000-4000-8000-000000000009',
    '31000000-0000-4000-8000-000000000109'
  ),
  true,
  'a started lease is created for conservative stale recovery'
);
reset role;

update private.webchat_cache_probe_runs
set
  claimed_at = pg_catalog.clock_timestamp() - interval '2 minutes',
  upstream_started_at = pg_catalog.clock_timestamp() - interval '119 seconds',
  lease_expires_at = pg_catalog.clock_timestamp() - interval '1 minute'
where id = '31000000-0000-4000-8000-000000000009';

set local role service_role;
create temporary table stale_started_recovery as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000010',
  '31000000-0000-4000-8000-000000000110',
  3000,
  180
);
reset role;

select is(
  (select decision from stale_started_recovery),
  'cooldown',
  'reconciling a stale started lease enters cooldown without a new claim'
);

select ok(
  exists (
    select 1 from private.webchat_cache_probe_runs
    where id = '31000000-0000-4000-8000-000000000009'
      and status = 'expired'
      and outcome = 'lease_expired_after_start'
      and request_counted
      and charged_tokens = 3000
  )
    and exists (
      select 1 from private.webchat_global_daily_usage
      where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
        and request_count = 6
        and reserved_tokens = 0
        and unknown_tokens = 7000
        and total_tokens = 9600
    ),
  'stale post-start recovery preserves request count and charges the reservation as unknown'
);

update private.webchat_cache_probe_runs
set claimed_at = pg_catalog.clock_timestamp() - interval '31 minutes'
where status not in ('claimed', 'started');

update private.webchat_relay_config
set global_daily_request_limit = 7, global_daily_token_limit = 1000000
where singleton;

set local role service_role;
create temporary table request_budget_probe as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000011',
  '31000000-0000-4000-8000-000000000111',
  2000,
  180
);
reset role;

select is(
  (select decision from request_budget_probe),
  'global_daily_request_limited',
  'the two-request probe cannot overrun the global request budget'
);

update private.webchat_relay_config
set global_daily_request_limit = 100, global_daily_token_limit = 11599
where singleton;

set local role service_role;
create temporary table token_budget_probe as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000012',
  '31000000-0000-4000-8000-000000000112',
  2000,
  180
);
reset role;

select is(
  (select decision from token_budget_probe),
  'global_daily_token_limited',
  'the probe cannot overrun the global token budget'
);

set local role service_role;
select throws_ok(
  $$ select * from public.claim_webchat_cache_probe(
    '31000000-0000-4000-8000-000000000013',
    '31000000-0000-4000-8000-000000000113',
    1023,
    180
  ) $$,
  '22023',
  'Probe reservation must be between 1024 and 1000000 tokens.',
  'sub-1024 reservations are rejected because they cannot prove cache eligibility'
);
reset role;

update private.webchat_cache_probe_runs
set claimed_at = pg_catalog.clock_timestamp() - interval '31 minutes'
where status not in ('claimed', 'started');

update private.webchat_relay_config
set global_daily_request_limit = 100, global_daily_token_limit = 1000000
where singleton;

set local role service_role;
create temporary table oversized_usage_probe as
select * from public.claim_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000015',
  '31000000-0000-4000-8000-000000000115',
  2000,
  180
);
select is(
  (select decision from oversized_usage_probe),
  'acquired',
  'an oversized-usage scenario first acquires its conservative ceiling'
);
select is(
  public.mark_webchat_cache_probe_started(
    '31000000-0000-4000-8000-000000000015',
    '31000000-0000-4000-8000-000000000115'
  ),
  true,
  'the oversized-usage scenario crosses the upstream-start boundary'
);
create temporary table oversized_usage_finish as
select * from public.finalize_webchat_cache_probe(
  '31000000-0000-4000-8000-000000000015',
  '31000000-0000-4000-8000-000000000115',
  'cache_hit',
  1600,
  600,
  2200,
  1200,
  1000
);
reset role;

select ok(
  exists (
    select 1 from oversized_usage_finish
    where transitioned and charged_tokens = 2000
  )
    and exists (
      select 1 from private.webchat_cache_probe_runs
      where id = '31000000-0000-4000-8000-000000000015'
        and status = 'finished'
        and outcome = 'usage_exceeds_reservation'
        and input_tokens is null
        and output_tokens is null
        and total_tokens is null
        and cached_input_tokens is null
        and cache_write_tokens is null
        and charged_tokens = 2000
    )
    and exists (
      select 1 from private.webchat_global_daily_usage
      where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
        and request_count = 8
        and reserved_tokens = 0
        and input_tokens = 2400
        and output_tokens = 200
        and unknown_tokens = 9000
        and total_tokens = 11600
    ),
  'reported usage above the reservation is sanitized and settled at the hard ceiling'
);

insert into private.webchat_cache_probe_runs (
  id, owner_token, status, quota_date, request_counted, claimed_at,
  lease_expires_at, finished_at, reserved_tokens, charged_tokens, outcome, updated_at
)
values (
  '31000000-0000-4000-8000-000000000014',
  '31000000-0000-4000-8000-000000000114',
  'released',
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 181,
  false,
  pg_catalog.clock_timestamp() - interval '181 days',
  null,
  pg_catalog.clock_timestamp() - interval '181 days',
  1024,
  0,
  'retention_test',
  pg_catalog.clock_timestamp() - interval '181 days'
);

set local role service_role;
select is(
  public.purge_webchat_cache_probe_runs(),
  1,
  'service-role retention purges terminal probe ledgers after 180 days'
);
reset role;

select ok(
  not exists (
    select 1 from private.webchat_cache_probe_runs
    where id = '31000000-0000-4000-8000-000000000014'
  ),
  'retention removes the expired sanitized row'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'webchat_cache_probe_runs'
      and column_name in ('prompt', 'request_body', 'response_body', 'base_url', 'api_key')
  ),
  'the probe ledger schema cannot persist prompts, replies, relay URLs, or keys'
);

select * from finish();

rollback;
