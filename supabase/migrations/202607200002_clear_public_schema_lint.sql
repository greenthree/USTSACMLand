alter function public.read_daily_problem_feed(integer, date) volatile;

alter function public.list_daily_problem_comments(bigint, integer, bigint) volatile;

create or replace function public.claim_webchat_total_request(
  requested_user_id uuid,
  requested_request_id text,
  requested_fingerprint text,
  requested_owner_token uuid,
  minute_request_limit integer,
  total_request_limit integer,
  total_token_limit bigint,
  global_daily_request_limit integer,
  global_daily_token_limit bigint,
  requested_reserved_tokens bigint,
  lease_seconds integer default 180
)
returns table (
  decision text,
  status text,
  remaining_minute_requests integer,
  remaining_total_requests integer,
  remaining_total_tokens bigint,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  current_usage record;
  core_result record;
  core_reserved_tokens bigint;
  core_token_limit bigint;
begin
  if requested_user_id is null or requested_owner_token is null then
    raise exception 'User ID and owner token are required.' using errcode = '22004';
  end if;
  if total_request_limit is null or total_request_limit not between 1 and 10000 then
    raise exception 'Total request limit must be between 1 and 10000.' using errcode = '22023';
  end if;
  if total_token_limit is null or total_token_limit not between 100 and 1000000000 then
    raise exception 'Total token limit must be between 100 and 1000000000.' using errcode = '22023';
  end if;
  if requested_reserved_tokens is null
    or requested_reserved_tokens not between 1 and 1000000000 then
    raise exception 'Reserved tokens must be between 1 and 1000000000.'
      using errcode = '22023';
  end if;

  perform 1
  from private.webchat_global_quota_state as global_state
  where global_state.singleton
  for update;
  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;

  insert into private.webchat_quota_states as quota_state (user_id, updated_at)
  values (requested_user_id, checked_at)
  on conflict (user_id) do nothing;

  perform 1
  from private.webchat_quota_states as quota_state
  where quota_state.user_id = requested_user_id
  for update;

  perform public.reconcile_expired_webchat_member_requests(requested_user_id, checked_at);

  perform 1
  from private.webchat_requests as request
  where request.user_id = requested_user_id
    and request.request_id = requested_request_id;

  if found then
    core_reserved_tokens := least(
      greatest(requested_reserved_tokens, 1::bigint),
      1000000000::bigint
    );
    core_token_limit := greatest(total_token_limit, core_reserved_tokens);

    select * into core_result
    from public.claim_webchat_request_internal(
      requested_user_id,
      requested_request_id,
      requested_fingerprint,
      requested_owner_token,
      minute_request_limit,
      total_request_limit,
      core_token_limit,
      global_daily_request_limit,
      global_daily_token_limit,
      core_reserved_tokens,
      lease_seconds
    );

    select * into current_usage
    from public.calculate_webchat_member_total_usage(requested_user_id, checked_at);

    return query select
      core_result.decision,
      core_result.status,
      core_result.remaining_minute_requests,
      greatest(total_request_limit - current_usage.used_requests, 0),
      greatest(
        total_token_limit - current_usage.used_tokens - current_usage.reserved_tokens,
        0::bigint
      ),
      core_result.retry_after_seconds;
    return;
  end if;

  select * into current_usage
  from public.calculate_webchat_member_total_usage(requested_user_id, checked_at);

  if current_usage.used_requests >= total_request_limit then
    return query select
      'member_total_request_limited'::text,
      'blocked'::text,
      minute_request_limit,
      0,
      greatest(
        total_token_limit - current_usage.used_tokens - current_usage.reserved_tokens,
        0::bigint
      ),
      null::integer;
    return;
  end if;

  if current_usage.used_tokens
      + current_usage.reserved_tokens
      + requested_reserved_tokens > total_token_limit then
    return query select
      'member_total_token_limited'::text,
      'blocked'::text,
      minute_request_limit,
      greatest(total_request_limit - current_usage.used_requests, 0),
      greatest(
        total_token_limit - current_usage.used_tokens - current_usage.reserved_tokens,
        0::bigint
      ),
      null::integer;
    return;
  end if;

  select * into core_result
  from public.claim_webchat_request_internal(
    requested_user_id,
    requested_request_id,
    requested_fingerprint,
    requested_owner_token,
    minute_request_limit,
    total_request_limit,
    total_token_limit,
    global_daily_request_limit,
    global_daily_token_limit,
    requested_reserved_tokens,
    lease_seconds
  );

  select * into current_usage
  from public.calculate_webchat_member_total_usage(requested_user_id, checked_at);

  return query select
    case core_result.decision
      when 'daily_request_limited' then 'member_total_request_limited'::text
      when 'daily_token_limited' then 'member_total_token_limited'::text
      else core_result.decision
    end,
    core_result.status,
    core_result.remaining_minute_requests,
    greatest(total_request_limit - current_usage.used_requests, 0),
    greatest(
      total_token_limit - current_usage.used_tokens - current_usage.reserved_tokens,
      0::bigint
    ),
    case
      when core_result.decision in ('daily_request_limited', 'daily_token_limited')
        then null::integer
      else core_result.retry_after_seconds
    end;
end;
$$;

comment on function public.claim_webchat_total_request(
  uuid, text, text, uuid, integer, integer, bigint, integer, bigint, bigint, integer
) is
  'Claims cumulative member and global WebChat quota without retaining an unused request row.';
