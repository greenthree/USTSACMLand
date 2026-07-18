-- Administrator-only, content-free observability for the explicitly enrolled
-- WebChat pilot cohort. Usage follows read_own_webchat_usage exactly: expired
-- claimed leases refund their request and reservation, while expired started
-- leases retain the request and move their reservation into settled usage.

create or replace function public.admin_list_webchat_pilot_members()
returns table (
  user_id uuid,
  full_name text,
  grade text,
  major text,
  role public.app_role,
  review_status public.profile_review_status,
  access_enabled boolean,
  daily_request_limit integer,
  daily_token_limit bigint,
  usage_date date,
  request_count integer,
  settled_tokens bigint,
  reserved_tokens bigint,
  remaining_requests integer,
  remaining_tokens bigint,
  active_request_count integer,
  last_request_at timestamptz,
  version bigint,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  with usage_clock as (
    select
      pg_catalog.statement_timestamp() as checked_at,
      (pg_catalog.statement_timestamp() at time zone 'Asia/Shanghai')::date as usage_date
  ),
  expired_active as (
    select
      request.user_id,
      pg_catalog.count(*) filter (
        where request.status = 'claimed' and request.request_counted
      )::integer as claimed_requests,
      coalesce(pg_catalog.sum(request.reserved_tokens) filter (
        where request.status = 'claimed'
      ), 0)::bigint as claimed_tokens,
      coalesce(pg_catalog.sum(request.reserved_tokens) filter (
        where request.status = 'started'
      ), 0)::bigint as started_tokens
    from private.webchat_requests as request
    cross join usage_clock
    where request.quota_date = usage_clock.usage_date
      and request.status in ('claimed', 'started')
      and request.lease_expires_at <= usage_clock.checked_at
    group by request.user_id
  ),
  active_requests as (
    select
      request.user_id,
      pg_catalog.count(*)::integer as active_request_count
    from private.webchat_requests as request
    cross join usage_clock
    where request.status in ('claimed', 'started')
      and request.lease_expires_at > usage_clock.checked_at
    group by request.user_id
  ),
  request_history as (
    select
      request.user_id,
      pg_catalog.max(request.claimed_at) as last_request_at
    from private.webchat_requests as request
    group by request.user_id
  ),
  effective_usage as (
    select
      access.user_id,
      usage_clock.usage_date,
      greatest(
        coalesce(usage.request_count, 0)
          - coalesce(expired.claimed_requests, 0),
        0
      )::integer as request_count,
      (
        coalesce(usage.total_tokens, 0)
          + coalesce(expired.started_tokens, 0)
      )::bigint as settled_tokens,
      greatest(
        coalesce(usage.reserved_tokens, 0)
          - coalesce(expired.claimed_tokens, 0)
          - coalesce(expired.started_tokens, 0),
        0::bigint
      )::bigint as reserved_tokens
    from private.webchat_member_access as access
    cross join usage_clock
    left join private.webchat_daily_usage as usage
      on usage.user_id = access.user_id
      and usage.usage_date = usage_clock.usage_date
    left join expired_active as expired on expired.user_id = access.user_id
  )
  select
    access.user_id,
    profile.full_name,
    profile.grade,
    profile.major,
    profile.role,
    profile.review_status,
    access.access_enabled,
    access.daily_request_limit,
    access.daily_token_limit,
    effective.usage_date,
    effective.request_count,
    effective.settled_tokens,
    effective.reserved_tokens,
    greatest(
      access.daily_request_limit - effective.request_count,
      0
    )::integer,
    greatest(
      access.daily_token_limit
        - effective.settled_tokens
        - effective.reserved_tokens,
      0::bigint
    )::bigint,
    coalesce(active.active_request_count, 0)::integer,
    history.last_request_at,
    access.version,
    access.updated_at
  from private.webchat_member_access as access
  join public.profiles as profile on profile.id = access.user_id
  join effective_usage as effective on effective.user_id = access.user_id
  left join active_requests as active on active.user_id = access.user_id
  left join request_history as history on history.user_id = access.user_id
  order by
    access.access_enabled desc,
    history.last_request_at desc nulls last,
    access.updated_at desc,
    access.user_id;
end;
$$;

revoke all on function public.admin_list_webchat_pilot_members()
from public, anon, authenticated, service_role;
grant execute on function public.admin_list_webchat_pilot_members()
to authenticated;

comment on function public.admin_list_webchat_pilot_members() is
  'Lists only explicitly configured WebChat pilot accounts with effective Beijing-day quota totals and content-free request activity metadata.';
