begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'webchat_global_daily_usage'
      and column_name = 'request_budget_alerted_at'
      and data_type = 'timestamp with time zone'
      and is_nullable = 'YES'
  ),
  'global usage has a nullable request-budget alert timestamp'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'webchat_global_daily_usage'
      and column_name = 'token_budget_alerted_at'
      and data_type = 'timestamp with time zone'
      and is_nullable = 'YES'
  ),
  'global usage has a nullable token-budget alert timestamp'
);

select ok(
  not pg_catalog.has_table_privilege(
    'anon', 'private.webchat_global_daily_usage', 'SELECT'
  )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.webchat_global_daily_usage', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.webchat_global_daily_usage', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.webchat_global_daily_usage', 'UPDATE'
    ),
  'browser and service roles cannot inspect or forge private global usage directly'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.read_webchat_global_budget_usage()', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'authenticated', 'public.read_webchat_global_budget_usage()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon', 'public.claim_webchat_budget_alert(text,bigint,bigint)', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.claim_webchat_budget_alert(text,bigint,bigint)',
      'EXECUTE'
    ),
  'browser roles cannot call global WebChat budget RPCs'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.read_webchat_global_budget_usage()', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.claim_webchat_budget_alert(text,bigint,bigint)',
      'EXECUTE'
    ),
  'service role can read usage and claim budget alerts'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'read_webchat_global_budget_usage',
        'claim_webchat_budget_alert'
      ])
      and not procedure.prosecdef
  ),
  'both budget RPCs are SECURITY DEFINER functions'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'read_webchat_global_budget_usage',
        'claim_webchat_budget_alert'
      ])
      and coalesce(procedure.proconfig::text, '') not like '%search_path=%'
  ),
  'both budget RPCs pin their search path'
);

delete from private.webchat_global_daily_usage
where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date;

set local role service_role;
create temporary table zero_usage as
select * from public.read_webchat_global_budget_usage();
reset role;

select ok(
  exists (
    select 1
    from zero_usage
    where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
      and request_count = 0
      and settled_tokens = 0
      and reserved_tokens = 0
      and request_budget_alerted_at is null
      and token_budget_alerted_at is null
  ),
  'usage reader returns one zero-valued row when today has no ledger row'
);

select is(
  (select reset_at from zero_usage),
  (
    (
      (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date + 1
    )::timestamp at time zone 'Asia/Shanghai'
  ),
  'zero usage resets at the next Beijing midnight'
);

select is(
  (
    select pg_catalog.array_agg(key order by key)
    from zero_usage as usage
    cross join lateral pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(usage)) as fields(key)
  ),
  array[
    'request_budget_alerted_at',
    'request_count',
    'reserved_tokens',
    'reset_at',
    'settled_tokens',
    'token_budget_alerted_at',
    'usage_date'
  ]::text[],
  'usage reader exposes only aggregate budget fields'
);

set local role service_role;
select throws_ok(
  $$ select * from public.claim_webchat_budget_alert('members', 10, 0) $$,
  '22023',
  'Budget kind must be requests or tokens.',
  'unknown budget kinds are rejected'
);
select throws_ok(
  $$ select * from public.claim_webchat_budget_alert('requests', 0, 0) $$,
  '22023',
  'Budget limit must be a positive integer.',
  'nonpositive budget limits are rejected'
);
select throws_ok(
  $$ select * from public.claim_webchat_budget_alert('tokens', 100, -1) $$,
  '22023',
  'Attempted reserved tokens are outside the supported range.',
  'negative attempted reservations are rejected'
);
select throws_ok(
  $$ select * from public.claim_webchat_budget_alert('requests', 100000001, 0) $$,
  '22023',
  'Request budget limit exceeds the supported range.',
  'request budget limits cannot exceed the quota RPC range'
);
select throws_ok(
  $$ select * from public.claim_webchat_budget_alert('tokens', 99, 0) $$,
  '22023',
  'Token budget limit is outside the supported range.',
  'token budget limits cannot fall below the quota RPC range'
);
select throws_ok(
  $$ select * from public.claim_webchat_budget_alert('tokens', 100, 1000000001) $$,
  '22023',
  'Attempted reserved tokens are outside the supported range.',
  'attempted reservations cannot exceed the member daily token ceiling'
);
reset role;

set local role service_role;
create temporary table request_below as
select * from public.claim_webchat_budget_alert('requests', 1, 0);
reset role;

select ok(
  not (select should_notify from request_below)
    and (select budget_kind = 'requests' from request_below)
    and (select observed_usage = 0 from request_below),
  'request alert is not claimed below its threshold'
);

select is(
  (
    select request_budget_alerted_at
    from private.webchat_global_daily_usage
    where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
  ),
  null::timestamptz,
  'a below-threshold request check does not write its alert timestamp'
);

update private.webchat_global_daily_usage
set
  request_count = 5,
  input_tokens = 30,
  output_tokens = 20,
  unknown_tokens = 0,
  total_tokens = 50,
  reserved_tokens = 20
where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date;

set local role service_role;
create temporary table request_threshold as
select * from public.claim_webchat_budget_alert('requests', 5, 999);
reset role;

select ok(
  (select should_notify from request_threshold)
    and (select budget_kind = 'requests' from request_threshold)
    and (select budget_limit = 5 from request_threshold)
    and (select request_count = 5 from request_threshold)
    and (select observed_usage = 5 from request_threshold),
  'request alert is claimed when count reaches its inclusive threshold'
);

select ok(
  (
    select request_budget_alerted_at is not null
      and token_budget_alerted_at is null
    from private.webchat_global_daily_usage
    where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
  ),
  'claiming a request alert does not consume the independent token alert'
);

create temporary table request_alert_time as
select request_budget_alerted_at as value
from private.webchat_global_daily_usage
where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date;

set local role service_role;
create temporary table request_repeat as
select * from public.claim_webchat_budget_alert('requests', 5, 0);
reset role;

select ok(
  not (select should_notify from request_repeat)
    and (select observed_usage = 5 from request_repeat),
  'the request budget alert can be claimed only once per Beijing date'
);

select is(
  (
    select request_budget_alerted_at
    from private.webchat_global_daily_usage
    where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
  ),
  (select value from request_alert_time),
  'a repeated request alert check preserves the first claim timestamp'
);

set local role service_role;
create temporary table token_equal as
select * from public.claim_webchat_budget_alert('tokens', 100, 30);
reset role;

select ok(
  not (select should_notify from token_equal)
    and (select settled_tokens = 50 from token_equal)
    and (select reserved_tokens = 20 from token_equal)
    and (select attempted_reserved_tokens = 30 from token_equal)
    and (select observed_usage = 100 from token_equal),
  'token alert remains below threshold when settled, reserved, and attempted equal the limit'
);

select is(
  (
    select token_budget_alerted_at
    from private.webchat_global_daily_usage
    where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
  ),
  null::timestamptz,
  'an equal-to-limit token check does not write its alert timestamp'
);

set local role service_role;
create temporary table token_over as
select * from public.claim_webchat_budget_alert('tokens', 100, 31);
reset role;

select ok(
  (select should_notify from token_over)
    and (select budget_kind = 'tokens' from token_over)
    and (select budget_limit = 100 from token_over)
    and (select observed_usage = 101 from token_over),
  'token alert is claimed only after aggregate and attempted reservations exceed the limit'
);

select ok(
  (
    select request_budget_alerted_at is not null
      and token_budget_alerted_at is not null
    from private.webchat_global_daily_usage
    where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
  ),
  'request and token alert claims remain independently recorded'
);

create temporary table token_alert_time as
select token_budget_alerted_at as value
from private.webchat_global_daily_usage
where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date;

set local role service_role;
create temporary table token_repeat as
select * from public.claim_webchat_budget_alert('tokens', 100, 500);
reset role;

select ok(
  not (select should_notify from token_repeat)
    and (select observed_usage = 570 from token_repeat),
  'the token budget alert can be claimed only once per Beijing date'
);

select is(
  (
    select token_budget_alerted_at
    from private.webchat_global_daily_usage
    where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date
  ),
  (select value from token_alert_time),
  'a repeated token alert check preserves the first claim timestamp'
);

select is(
  (
    select pg_catalog.array_agg(key order by key)
    from token_over as alert
    cross join lateral pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(alert)) as fields(key)
  ),
  array[
    'attempted_reserved_tokens',
    'budget_kind',
    'budget_limit',
    'observed_at',
    'observed_usage',
    'request_count',
    'reserved_tokens',
    'reset_at',
    'settled_tokens',
    'should_notify',
    'usage_date'
  ]::text[],
  'alert claim result contains aggregate fields and no member, request, or message data'
);

select is(
  (select reset_at from token_over),
  (
    (
      (select usage_date from token_over) + 1
    )::timestamp at time zone 'Asia/Shanghai'
  ),
  'alert claim reset time is the next Beijing midnight'
);

set local role service_role;
create temporary table final_usage as
select * from public.read_webchat_global_budget_usage();
reset role;

select ok(
  exists (
    select 1
    from final_usage
    where request_count = 5
      and settled_tokens = 50
      and reserved_tokens = 20
      and request_budget_alerted_at is not null
      and token_budget_alerted_at is not null
  ),
  'usage reader returns current aggregate counters and both redacted alert states'
);

insert into private.webchat_global_daily_usage (
  usage_date,
  request_count,
  request_budget_alerted_at,
  token_budget_alerted_at
)
values (
  (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date - 1,
  999,
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
)
on conflict (usage_date) do update
set
  request_count = excluded.request_count,
  request_budget_alerted_at = excluded.request_budget_alerted_at,
  token_budget_alerted_at = excluded.token_budget_alerted_at;

delete from private.webchat_global_daily_usage
where usage_date = (pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai')::date;

set local role service_role;
create temporary table next_day_isolation as
select * from public.read_webchat_global_budget_usage();
reset role;

select ok(
  exists (
    select 1
    from next_day_isolation
    where request_count = 0
      and settled_tokens = 0
      and reserved_tokens = 0
      and request_budget_alerted_at is null
      and token_budget_alerted_at is null
  ),
  'a prior Beijing-date alert never leaks into the current daily budget state'
);

select * from finish();

rollback;
