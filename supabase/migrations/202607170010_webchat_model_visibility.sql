-- Expose only the administrator-selected model name to an authorized account.
-- A return-type change requires replacing the RPC rather than CREATE OR REPLACE.

drop function public.read_own_webchat_usage();

create function public.read_own_webchat_usage()
returns table (
  access_enabled boolean,
  model text,
  usage_date date,
  daily_request_limit integer,
  request_count integer,
  remaining_requests integer,
  daily_token_limit bigint,
  settled_tokens bigint,
  reserved_tokens bigint,
  remaining_tokens bigint,
  reset_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'Authenticated member access required.' using errcode = '42501';
  end if;

  return query
  with usage_clock as (
    select
      pg_catalog.statement_timestamp() as checked_at,
      (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date as usage_date
  ),
  policy as (
    select
      coalesce(
        profile.role in ('member', 'admin') and profile.review_status = 'approved',
        false
      ) and coalesce(access.access_enabled, false) as access_enabled,
      case
        when coalesce(
          profile.role in ('member', 'admin') and profile.review_status = 'approved',
          false
        ) and coalesce(access.access_enabled, false)
        then nullif(pg_catalog.btrim(config.model), '')
        else null::text
      end as model,
      coalesce(access.daily_request_limit, 30)::integer as daily_request_limit,
      coalesce(access.daily_token_limit, 100000::bigint)::bigint as daily_token_limit
    from (select true) as singleton
    left join public.profiles as profile on profile.id = actor_id
    left join private.webchat_member_access as access on access.user_id = actor_id
    left join private.webchat_relay_config as config on config.singleton
  ),
  expired_active as (
    select
      pg_catalog.count(*) filter (
        where request.status = 'claimed' and request.request_counted
      )::integer as claimed_requests,
      coalesce(pg_catalog.sum(request.reserved_tokens) filter (
        where request.status = 'claimed'
      ), 0)::bigint as claimed_tokens,
      coalesce(pg_catalog.sum(request.reserved_tokens) filter (
        where request.status = 'started'
      ), 0)::bigint as started_tokens
    from usage_clock
    left join private.webchat_requests as request
      on request.user_id = actor_id
      and request.quota_date = usage_clock.usage_date
      and request.status in ('claimed', 'started')
      and request.lease_expires_at <= usage_clock.checked_at
  ),
  effective_usage as (
    select
      usage_clock.usage_date,
      greatest(
        coalesce(usage.request_count, 0) - expired_active.claimed_requests,
        0
      )::integer as request_count,
      (
        coalesce(usage.total_tokens, 0) + expired_active.started_tokens
      )::bigint as settled_tokens,
      greatest(
        coalesce(usage.reserved_tokens, 0)
          - expired_active.claimed_tokens
          - expired_active.started_tokens,
        0::bigint
      )::bigint as reserved_tokens
    from usage_clock
    cross join expired_active
    left join private.webchat_daily_usage as usage
      on usage.user_id = actor_id
      and usage.usage_date = usage_clock.usage_date
  )
  select
    policy.access_enabled,
    policy.model,
    effective_usage.usage_date,
    policy.daily_request_limit,
    effective_usage.request_count,
    greatest(
      policy.daily_request_limit - effective_usage.request_count,
      0
    )::integer,
    policy.daily_token_limit,
    effective_usage.settled_tokens,
    effective_usage.reserved_tokens,
    greatest(
      policy.daily_token_limit
        - effective_usage.settled_tokens
        - effective_usage.reserved_tokens,
      0::bigint
    )::bigint,
    ((effective_usage.usage_date + 1)::timestamp at time zone 'Asia/Shanghai')
  from policy
  cross join effective_usage;
end;
$$;

revoke all on function public.read_own_webchat_usage()
from public, anon, authenticated, service_role;
grant execute on function public.read_own_webchat_usage()
to authenticated;

comment on function public.read_own_webchat_usage() is
  'Returns only the JWT account current Beijing-day WebChat usage, effective access, authorized model name, limits, and remaining quota.';
