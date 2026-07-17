-- WebChat budget alerts are claimed inside the same global lock order used by
-- quota accounting. Alert delivery stays outside the transaction, while these
-- timestamps make each Beijing-day threshold notification idempotent.

alter table private.webchat_global_daily_usage
add column request_budget_alerted_at timestamptz,
add column token_budget_alerted_at timestamptz;

create or replace function public.read_webchat_global_budget_usage()
returns table (
  usage_date date,
  request_count integer,
  settled_tokens bigint,
  reserved_tokens bigint,
  reset_at timestamptz,
  request_budget_alerted_at timestamptz,
  token_budget_alerted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with budget_clock as (
    select
      (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date as usage_date
  )
  select
    budget_clock.usage_date,
    coalesce(usage.request_count, 0)::integer,
    coalesce(usage.total_tokens, 0)::bigint,
    coalesce(usage.reserved_tokens, 0)::bigint,
    ((budget_clock.usage_date + 1)::timestamp at time zone 'Asia/Shanghai'),
    usage.request_budget_alerted_at,
    usage.token_budget_alerted_at
  from budget_clock
  left join private.webchat_global_daily_usage as usage
    on usage.usage_date = budget_clock.usage_date;
$$;

create or replace function public.claim_webchat_budget_alert(
  requested_budget_kind text,
  requested_limit bigint,
  requested_reserved_tokens bigint default 0
)
returns table (
  should_notify boolean,
  budget_kind text,
  usage_date date,
  budget_limit bigint,
  request_count integer,
  settled_tokens bigint,
  reserved_tokens bigint,
  attempted_reserved_tokens bigint,
  observed_usage bigint,
  observed_at timestamptz,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  beijing_date date := (checked_at at time zone 'Asia/Shanghai')::date;
  next_beijing_day timestamptz;
  current_usage private.webchat_global_daily_usage%rowtype;
  normalized_kind text := pg_catalog.btrim(requested_budget_kind);
  threshold_reached boolean;
  notify_now boolean;
  aggregate_usage bigint;
begin
  if normalized_kind is null or normalized_kind not in ('requests', 'tokens') then
    raise exception 'Budget kind must be requests or tokens.' using errcode = '22023';
  end if;
  if requested_limit is null or requested_limit < 1 then
    raise exception 'Budget limit must be a positive integer.' using errcode = '22023';
  end if;
  if normalized_kind = 'requests' and requested_limit > 100000000 then
    raise exception 'Request budget limit exceeds the supported range.' using errcode = '22023';
  end if;
  if normalized_kind = 'tokens'
    and requested_limit not between 100 and 1000000000000000 then
    raise exception 'Token budget limit is outside the supported range.' using errcode = '22023';
  end if;
  if requested_reserved_tokens is null
    or requested_reserved_tokens < 0
    or requested_reserved_tokens > 1000000000 then
    raise exception 'Attempted reserved tokens are outside the supported range.'
      using errcode = '22023';
  end if;

  -- Keep this order identical to claim/finalize/release quota transitions:
  -- global singleton first, then the current global daily row.
  perform 1
  from private.webchat_global_quota_state as global_state
  where global_state.singleton
  for update;

  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;

  insert into private.webchat_global_daily_usage as usage (usage_date, updated_at)
  values (beijing_date, checked_at)
  on conflict on constraint webchat_global_daily_usage_pkey do nothing;

  select usage.* into current_usage
  from private.webchat_global_daily_usage as usage
  where usage.usage_date = beijing_date
  for update;

  next_beijing_day := ((beijing_date + 1)::timestamp at time zone 'Asia/Shanghai');
  aggregate_usage := case normalized_kind
    when 'requests' then current_usage.request_count::bigint
    else current_usage.total_tokens
      + current_usage.reserved_tokens
      + requested_reserved_tokens
  end;
  threshold_reached := case normalized_kind
    when 'requests' then current_usage.request_count::bigint >= requested_limit
    else aggregate_usage > requested_limit
  end;
  notify_now := threshold_reached and case normalized_kind
    when 'requests' then current_usage.request_budget_alerted_at is null
    else current_usage.token_budget_alerted_at is null
  end;

  if notify_now then
    update private.webchat_global_daily_usage as usage
    set
      request_budget_alerted_at = case normalized_kind
        when 'requests' then checked_at
        else usage.request_budget_alerted_at
      end,
      token_budget_alerted_at = case normalized_kind
        when 'tokens' then checked_at
        else usage.token_budget_alerted_at
      end,
      updated_at = checked_at
    where usage.usage_date = beijing_date
    returning usage.* into current_usage;
  end if;

  return query select
    notify_now,
    normalized_kind,
    beijing_date,
    requested_limit,
    current_usage.request_count,
    current_usage.total_tokens,
    current_usage.reserved_tokens,
    requested_reserved_tokens,
    aggregate_usage,
    checked_at,
    next_beijing_day;
end;
$$;

revoke all on function public.read_webchat_global_budget_usage()
from public, anon, authenticated, service_role;
revoke all on function public.claim_webchat_budget_alert(text, bigint, bigint)
from public, anon, authenticated, service_role;

grant execute on function public.read_webchat_global_budget_usage()
to service_role;
grant execute on function public.claim_webchat_budget_alert(text, bigint, bigint)
to service_role;

comment on column private.webchat_global_daily_usage.request_budget_alerted_at is
  'First successfully claimed global request-budget alert time for this Beijing date.';
comment on column private.webchat_global_daily_usage.token_budget_alerted_at is
  'First successfully claimed global token-budget alert time for this Beijing date.';
comment on function public.read_webchat_global_budget_usage() is
  'Returns redacted aggregate WebChat usage and budget-alert state for the current Beijing date.';
comment on function public.claim_webchat_budget_alert(text, bigint, bigint) is
  'Claims at most one request or token budget alert per Beijing date under the global quota lock.';
