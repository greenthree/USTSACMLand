-- Real member WebChat requests keep only aggregate prompt-cache counters from
-- Responses usage. Message bodies, prompts, relay URLs, and credentials remain
-- outside the database ledger.

alter table private.webchat_requests
  add column cached_input_tokens bigint,
  add column cache_write_tokens bigint;

alter table private.webchat_requests
  add constraint webchat_requests_cache_tokens_nonnegative check (
    (cached_input_tokens is null or cached_input_tokens >= 0)
    and (cache_write_tokens is null or cache_write_tokens >= 0)
  ),
  add constraint webchat_requests_cache_usage_consistent check (
    (cached_input_tokens is null or (
      input_tokens is not null and cached_input_tokens <= input_tokens
    ))
    and (cache_write_tokens is null or input_tokens is not null)
  );

drop function public.finalize_webchat_request(
  uuid, text, uuid, text, bigint, bigint, bigint
);

create function public.finalize_webchat_request(
  requested_user_id uuid,
  requested_request_id text,
  requested_owner_token uuid,
  request_outcome text,
  used_input_tokens bigint default null,
  used_output_tokens bigint default null,
  used_total_tokens bigint default null,
  observed_cached_input_tokens bigint default null,
  observed_cache_write_tokens bigint default null
)
returns table (
  transitioned boolean,
  status text,
  charged_tokens bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  request private.webchat_requests%rowtype;
  usage_is_known boolean;
  final_charge bigint;
begin
  if request_outcome is null or request_outcome !~ '^[a-z0-9_.:-]{1,80}$' then
    raise exception 'Request outcome has an invalid format.' using errcode = '22023';
  end if;

  usage_is_known := used_input_tokens is not null
    and used_output_tokens is not null
    and used_total_tokens is not null;
  if usage_is_known <> (
    used_input_tokens is not null
    or used_output_tokens is not null
    or used_total_tokens is not null
  ) then
    raise exception 'Token usage must be either complete or omitted.' using errcode = '22023';
  end if;
  if usage_is_known and (
    used_input_tokens < 0
    or used_output_tokens < 0
    or used_total_tokens < 0
    or used_total_tokens <> used_input_tokens + used_output_tokens
  ) then
    raise exception 'Token usage is inconsistent.' using errcode = '22023';
  end if;
  if observed_cached_input_tokens is not null and (
    not usage_is_known
    or observed_cached_input_tokens < 0
    or observed_cached_input_tokens > used_input_tokens
  ) then
    raise exception 'Cached token usage is inconsistent.' using errcode = '22023';
  end if;
  if observed_cache_write_tokens is not null and (
    not usage_is_known or observed_cache_write_tokens < 0
  ) then
    raise exception 'Cache-write usage is inconsistent.' using errcode = '22023';
  end if;

  perform 1
  from private.webchat_global_quota_state as global_state
  where global_state.singleton
  for update;

  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;

  perform 1
  from private.webchat_quota_states as quota_state
  where quota_state.user_id = requested_user_id
  for update;

  select candidate.* into request
  from private.webchat_requests as candidate
  where candidate.user_id = requested_user_id
    and candidate.request_id = requested_request_id
  for update;

  if not found
    or request.owner_token is distinct from requested_owner_token
    or request.status <> 'started' then
    return query select
      false,
      coalesce(request.status, 'missing'),
      coalesce(request.charged_tokens, 0::bigint);
    return;
  end if;

  final_charge := case when usage_is_known then used_total_tokens else request.reserved_tokens end;

  update private.webchat_daily_usage as usage
  set
    reserved_tokens = usage.reserved_tokens - request.reserved_tokens,
    input_tokens = usage.input_tokens + coalesce(used_input_tokens, 0),
    output_tokens = usage.output_tokens + coalesce(used_output_tokens, 0),
    unknown_tokens = usage.unknown_tokens
      + case when usage_is_known then 0 else request.reserved_tokens end,
    total_tokens = usage.total_tokens + final_charge,
    updated_at = checked_at
  where usage.user_id = request.user_id
    and usage.usage_date = request.quota_date;

  update private.webchat_global_daily_usage as usage
  set
    reserved_tokens = usage.reserved_tokens - request.reserved_tokens,
    input_tokens = usage.input_tokens + coalesce(used_input_tokens, 0),
    output_tokens = usage.output_tokens + coalesce(used_output_tokens, 0),
    unknown_tokens = usage.unknown_tokens
      + case when usage_is_known then 0 else request.reserved_tokens end,
    total_tokens = usage.total_tokens + final_charge,
    updated_at = checked_at
  where usage.usage_date = request.quota_date;

  update private.webchat_requests as candidate
  set
    status = 'finished',
    lease_expires_at = null,
    finished_at = checked_at,
    input_tokens = used_input_tokens,
    output_tokens = used_output_tokens,
    total_tokens = used_total_tokens,
    charged_tokens = final_charge,
    cached_input_tokens = observed_cached_input_tokens,
    cache_write_tokens = observed_cache_write_tokens,
    outcome = request_outcome,
    updated_at = checked_at
  where candidate.user_id = request.user_id
    and candidate.request_id = request.request_id;

  update private.webchat_quota_states as quota_state
  set updated_at = checked_at
  where quota_state.user_id = requested_user_id;

  update private.webchat_global_quota_state as global_state
  set updated_at = checked_at
  where global_state.singleton;

  return query select true, 'finished'::text, final_charge;
end;
$$;

create function public.admin_read_webchat_cache_summary()
returns table (
  observed_requests bigint,
  eligible_requests bigint,
  cache_hit_requests bigint,
  eligible_input_tokens bigint,
  cached_input_tokens bigint,
  cache_write_tokens bigint
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
  select
    pg_catalog.count(*) filter (
      where request.cached_input_tokens is not null
    )::bigint,
    pg_catalog.count(*) filter (
      where request.cached_input_tokens is not null
        and request.input_tokens >= 1024
    )::bigint,
    pg_catalog.count(*) filter (
      where request.cached_input_tokens > 0
        and request.input_tokens >= 1024
    )::bigint,
    coalesce(pg_catalog.sum(request.input_tokens) filter (
      where request.cached_input_tokens is not null
        and request.input_tokens >= 1024
    ), 0)::bigint,
    coalesce(pg_catalog.sum(request.cached_input_tokens) filter (
      where request.input_tokens >= 1024
    ), 0)::bigint,
    coalesce(pg_catalog.sum(request.cache_write_tokens), 0)::bigint
  from private.webchat_requests as request
  where request.status = 'finished';
end;
$$;

revoke all on function public.finalize_webchat_request(
  uuid, text, uuid, text, bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.admin_read_webchat_cache_summary()
from public, anon, authenticated, service_role;

grant execute on function public.finalize_webchat_request(
  uuid, text, uuid, text, bigint, bigint, bigint, bigint, bigint
) to service_role;
grant execute on function public.admin_read_webchat_cache_summary() to authenticated;

comment on column private.webchat_requests.cached_input_tokens is
  'Aggregate cached input tokens reported by the relay; null when the provider omitted cache usage.';
comment on column private.webchat_requests.cache_write_tokens is
  'Aggregate cache-write tokens reported by the relay; null when the provider omitted this counter.';
comment on function public.finalize_webchat_request(
  uuid, text, uuid, text, bigint, bigint, bigint, bigint, bigint
) is 'Finalizes trusted relay usage and content-free cache counters, or conservatively charges the reservation when usage is unknown.';
comment on function public.admin_read_webchat_cache_summary() is
  'Returns content-free aggregate cache eligibility and hit counters for administrator observability.';
