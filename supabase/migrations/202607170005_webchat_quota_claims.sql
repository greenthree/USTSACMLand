-- WebChat quota accounting is intentionally database-backed. Every request is
-- serialized per user before it can reach the paid relay, and active work is
-- fenced by an owner token so a recovered worker cannot finish a newer claim.

create table private.webchat_global_quota_state (
  singleton boolean primary key default true check (singleton),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

insert into private.webchat_global_quota_state (singleton)
values (true);

create table private.webchat_global_daily_usage (
  usage_date date primary key,
  request_count integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  unknown_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  reserved_tokens bigint not null default 0,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint webchat_global_daily_usage_requests_nonnegative check (request_count >= 0),
  constraint webchat_global_daily_usage_tokens_nonnegative check (
    input_tokens >= 0
    and output_tokens >= 0
    and unknown_tokens >= 0
    and total_tokens >= 0
    and reserved_tokens >= 0
  ),
  constraint webchat_global_daily_usage_total_consistent check (
    total_tokens = input_tokens + output_tokens + unknown_tokens
  )
);

create table private.webchat_quota_states (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table private.webchat_daily_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null,
  request_count integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  unknown_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  reserved_tokens bigint not null default 0,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, usage_date),
  constraint webchat_daily_usage_requests_nonnegative check (request_count >= 0),
  constraint webchat_daily_usage_tokens_nonnegative check (
    input_tokens >= 0
    and output_tokens >= 0
    and unknown_tokens >= 0
    and total_tokens >= 0
    and reserved_tokens >= 0
  ),
  constraint webchat_daily_usage_total_consistent check (
    total_tokens = input_tokens + output_tokens + unknown_tokens
  )
);

create table private.webchat_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id text not null,
  request_fingerprint text not null,
  owner_token uuid not null,
  status text not null,
  quota_date date not null,
  request_counted boolean not null default true,
  claimed_at timestamptz not null default pg_catalog.clock_timestamp(),
  upstream_started_at timestamptz,
  lease_expires_at timestamptz,
  finished_at timestamptz,
  reserved_tokens bigint not null,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  charged_tokens bigint not null default 0,
  outcome text,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, request_id),
  unique (owner_token),
  constraint webchat_requests_id_format check (
    request_id ~ '^[A-Za-z0-9._:-]{1,128}$'
  ),
  constraint webchat_requests_fingerprint_format check (
    request_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint webchat_requests_status_valid check (
    status in ('claimed', 'started', 'finished', 'released', 'expired')
  ),
  constraint webchat_requests_reservation_positive check (reserved_tokens > 0),
  constraint webchat_requests_tokens_nonnegative check (
    (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
    and (total_tokens is null or total_tokens >= 0)
    and charged_tokens >= 0
  ),
  constraint webchat_requests_usage_complete check (
    (input_tokens is null and output_tokens is null and total_tokens is null)
    or (
      input_tokens is not null
      and output_tokens is not null
      and total_tokens is not null
      and total_tokens = input_tokens + output_tokens
    )
  ),
  constraint webchat_requests_started_state check (
    (status = 'claimed' and upstream_started_at is null)
    or (status <> 'claimed' and (
      upstream_started_at is not null
      or status = 'released'
    ))
  ),
  constraint webchat_requests_lease_state check (
    (status in ('claimed', 'started') and lease_expires_at is not null and finished_at is null)
    or (status not in ('claimed', 'started') and lease_expires_at is null and finished_at is not null)
  ),
  constraint webchat_requests_terminal_outcome check (
    (status in ('claimed', 'started') and outcome is null)
    or (status not in ('claimed', 'started') and outcome is not null)
  ),
  constraint webchat_requests_outcome_length check (
    outcome is null or pg_catalog.char_length(outcome) between 1 and 80
  )
);

create unique index webchat_requests_one_active_per_user_idx
  on private.webchat_requests (user_id)
  where status in ('claimed', 'started');

create index webchat_requests_minute_window_idx
  on private.webchat_requests (user_id, claimed_at)
  where request_counted;

create index webchat_requests_active_lease_idx
  on private.webchat_requests (user_id, lease_expires_at)
  where status in ('claimed', 'started');

alter table private.webchat_global_quota_state enable row level security;
alter table private.webchat_global_daily_usage enable row level security;
alter table private.webchat_quota_states enable row level security;
alter table private.webchat_daily_usage enable row level security;
alter table private.webchat_requests enable row level security;

revoke all on table private.webchat_global_quota_state
from public, anon, authenticated, service_role;
revoke all on table private.webchat_global_daily_usage
from public, anon, authenticated, service_role;
revoke all on table private.webchat_quota_states
from public, anon, authenticated, service_role;
revoke all on table private.webchat_daily_usage
from public, anon, authenticated, service_role;
revoke all on table private.webchat_requests
from public, anon, authenticated, service_role;

create or replace function public.claim_webchat_request(
  requested_user_id uuid,
  requested_request_id text,
  requested_fingerprint text,
  requested_owner_token uuid,
  minute_request_limit integer,
  daily_request_limit integer,
  daily_token_limit bigint,
  global_daily_request_limit integer,
  global_daily_token_limit bigint,
  requested_reserved_tokens bigint,
  lease_seconds integer default 180
)
returns table (
  decision text,
  status text,
  remaining_minute_requests integer,
  remaining_daily_requests integer,
  remaining_daily_tokens bigint,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  beijing_date date := (checked_at at time zone 'Asia/Shanghai')::date;
  next_beijing_day timestamptz;
  existing_request private.webchat_requests%rowtype;
  stale_request private.webchat_requests%rowtype;
  daily_usage private.webchat_daily_usage%rowtype;
  global_daily_usage private.webchat_global_daily_usage%rowtype;
  minute_count integer;
  minute_resets_at timestamptz;
  active_lease_expires_at timestamptz;
begin
  if requested_user_id is null or requested_owner_token is null then
    raise exception 'User ID and owner token are required.' using errcode = '22004';
  end if;
  if requested_request_id is null
    or requested_request_id !~ '^[A-Za-z0-9._:-]{1,128}$' then
    raise exception 'Request ID has an invalid format.' using errcode = '22023';
  end if;
  if requested_fingerprint is null
    or requested_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Request fingerprint has an invalid format.' using errcode = '22023';
  end if;
  if minute_request_limit is null or minute_request_limit not between 1 and 1000 then
    raise exception 'Minute request limit must be between 1 and 1000.' using errcode = '22023';
  end if;
  if daily_request_limit is null or daily_request_limit not between 1 and 10000 then
    raise exception 'Daily request limit must be between 1 and 10000.' using errcode = '22023';
  end if;
  if daily_token_limit is null or daily_token_limit not between 100 and 1000000000 then
    raise exception 'Daily token limit must be between 100 and 1000000000.' using errcode = '22023';
  end if;
  if global_daily_request_limit is null
    or global_daily_request_limit not between 1 and 100000000 then
    raise exception 'Global daily request limit must be between 1 and 100000000.'
      using errcode = '22023';
  end if;
  if global_daily_token_limit is null
    or global_daily_token_limit not between 100 and 1000000000000000 then
    raise exception 'Global daily token limit must be between 100 and 1000000000000000.'
      using errcode = '22023';
  end if;
  if requested_reserved_tokens is null
    or requested_reserved_tokens < 1
    or requested_reserved_tokens > daily_token_limit then
    raise exception 'Reserved tokens must fit within the daily token limit.' using errcode = '22023';
  end if;
  if lease_seconds is null or lease_seconds not between 121 and 600 then
    raise exception 'Lease must be between 121 and 600 seconds.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = requested_user_id
      and profile.review_status = 'approved'
  ) then
    raise exception 'An active member account is required.' using errcode = '42501';
  end if;

  -- Every transition that mutates global accounting takes this singleton lock
  -- before any per-user lock. Different users therefore serialize briefly
  -- without creating a global->user / user->global deadlock cycle.
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

  select request.* into existing_request
  from private.webchat_requests as request
  where request.user_id = requested_user_id
    and request.request_id = requested_request_id;

  if found then
    if existing_request.request_fingerprint <> requested_fingerprint then
      return query select
        'idempotency_conflict'::text,
        existing_request.status,
        0,
        0,
        0::bigint,
        null::integer;
      return;
    end if;

    if existing_request.status = 'claimed'
      and existing_request.lease_expires_at <= checked_at then
      update private.webchat_daily_usage as usage
      set
        request_count = usage.request_count - 1,
        reserved_tokens = usage.reserved_tokens - existing_request.reserved_tokens,
        updated_at = checked_at
      where usage.user_id = existing_request.user_id
        and usage.usage_date = existing_request.quota_date;

      update private.webchat_global_daily_usage as usage
      set
        request_count = usage.request_count - 1,
        reserved_tokens = usage.reserved_tokens - existing_request.reserved_tokens,
        updated_at = checked_at
      where usage.usage_date = existing_request.quota_date;

      update private.webchat_requests as request
      set
        status = 'released',
        request_counted = false,
        lease_expires_at = null,
        finished_at = checked_at,
        outcome = 'lease_expired_before_start',
        updated_at = checked_at
      where request.user_id = requested_user_id
        and request.request_id = requested_request_id
      returning request.* into existing_request;

      return query select
        'duplicate_terminal'::text,
        existing_request.status,
        0,
        0,
        0::bigint,
        null::integer;
      return;
    end if;

    if existing_request.status = 'started'
      and existing_request.lease_expires_at <= checked_at then
      update private.webchat_daily_usage as usage
      set
        reserved_tokens = usage.reserved_tokens - existing_request.reserved_tokens,
        unknown_tokens = usage.unknown_tokens + existing_request.reserved_tokens,
        total_tokens = usage.total_tokens + existing_request.reserved_tokens,
        updated_at = checked_at
      where usage.user_id = existing_request.user_id
        and usage.usage_date = existing_request.quota_date;

      update private.webchat_global_daily_usage as usage
      set
        reserved_tokens = usage.reserved_tokens - existing_request.reserved_tokens,
        unknown_tokens = usage.unknown_tokens + existing_request.reserved_tokens,
        total_tokens = usage.total_tokens + existing_request.reserved_tokens,
        updated_at = checked_at
      where usage.usage_date = existing_request.quota_date;

      update private.webchat_requests as request
      set
        status = 'expired',
        lease_expires_at = null,
        finished_at = checked_at,
        charged_tokens = request.reserved_tokens,
        outcome = 'lease_expired_after_start',
        updated_at = checked_at
      where request.user_id = requested_user_id
        and request.request_id = requested_request_id
      returning request.* into existing_request;
    end if;

    if existing_request.status = 'claimed'
      and existing_request.owner_token = requested_owner_token then
      return query select
        'acquired'::text,
        existing_request.status,
        minute_request_limit,
        daily_request_limit,
        greatest(daily_token_limit - existing_request.reserved_tokens, 0::bigint),
        null::integer;
      return;
    end if;

    return query select
      case
        when existing_request.status in ('claimed', 'started') then 'duplicate_active'
        else 'duplicate_terminal'
      end,
      existing_request.status,
      0,
      0,
      0::bigint,
      case
        when existing_request.status in ('claimed', 'started') then greatest(
          1,
          pg_catalog.ceil(
            pg_catalog.date_part('epoch', existing_request.lease_expires_at - checked_at)
          )::integer
        )
        else null::integer
      end;
    return;
  end if;

  select request.* into stale_request
  from private.webchat_requests as request
  where request.user_id = requested_user_id
    and request.status in ('claimed', 'started')
    and request.lease_expires_at <= checked_at
  for update;

  if found then
    if stale_request.status = 'claimed' then
      update private.webchat_daily_usage as usage
      set
        request_count = usage.request_count - 1,
        reserved_tokens = usage.reserved_tokens - stale_request.reserved_tokens,
        updated_at = checked_at
      where usage.user_id = stale_request.user_id
        and usage.usage_date = stale_request.quota_date;

      update private.webchat_global_daily_usage as usage
      set
        request_count = usage.request_count - 1,
        reserved_tokens = usage.reserved_tokens - stale_request.reserved_tokens,
        updated_at = checked_at
      where usage.usage_date = stale_request.quota_date;

      update private.webchat_requests as request
      set
        status = 'released',
        request_counted = false,
        lease_expires_at = null,
        finished_at = checked_at,
        outcome = 'lease_expired_before_start',
        updated_at = checked_at
      where request.user_id = stale_request.user_id
        and request.request_id = stale_request.request_id;
    else
      update private.webchat_daily_usage as usage
      set
        reserved_tokens = usage.reserved_tokens - stale_request.reserved_tokens,
        unknown_tokens = usage.unknown_tokens + stale_request.reserved_tokens,
        total_tokens = usage.total_tokens + stale_request.reserved_tokens,
        updated_at = checked_at
      where usage.user_id = stale_request.user_id
        and usage.usage_date = stale_request.quota_date;

      update private.webchat_global_daily_usage as usage
      set
        reserved_tokens = usage.reserved_tokens - stale_request.reserved_tokens,
        unknown_tokens = usage.unknown_tokens + stale_request.reserved_tokens,
        total_tokens = usage.total_tokens + stale_request.reserved_tokens,
        updated_at = checked_at
      where usage.usage_date = stale_request.quota_date;

      update private.webchat_requests as request
      set
        status = 'expired',
        lease_expires_at = null,
        finished_at = checked_at,
        charged_tokens = request.reserved_tokens,
        outcome = 'lease_expired_after_start',
        updated_at = checked_at
      where request.user_id = stale_request.user_id
        and request.request_id = stale_request.request_id;
    end if;
  end if;

  select request.lease_expires_at into active_lease_expires_at
  from private.webchat_requests as request
  where request.user_id = requested_user_id
    and request.status in ('claimed', 'started')
    and request.lease_expires_at > checked_at;

  if found then
    return query select
      'active_concurrent'::text,
      'blocked'::text,
      0,
      0,
      0::bigint,
      greatest(
        1,
        pg_catalog.ceil(
          pg_catalog.date_part('epoch', active_lease_expires_at - checked_at)
        )::integer
      );
    return;
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.min(request.claimed_at) + interval '60 seconds'
  into minute_count, minute_resets_at
  from private.webchat_requests as request
  where request.user_id = requested_user_id
    and request.request_counted
    and request.claimed_at > checked_at - interval '60 seconds';

  if minute_count >= minute_request_limit then
    return query select
      'minute_limited'::text,
      'blocked'::text,
      0,
      0,
      0::bigint,
      greatest(
        1,
        pg_catalog.ceil(pg_catalog.date_part('epoch', minute_resets_at - checked_at))::integer
      );
    return;
  end if;

  insert into private.webchat_daily_usage as usage (user_id, usage_date, updated_at)
  values (requested_user_id, beijing_date, checked_at)
  on conflict (user_id, usage_date) do nothing;

  select usage.* into daily_usage
  from private.webchat_daily_usage as usage
  where usage.user_id = requested_user_id
    and usage.usage_date = beijing_date
  for update;

  insert into private.webchat_global_daily_usage as usage (usage_date, updated_at)
  values (beijing_date, checked_at)
  on conflict (usage_date) do nothing;

  select usage.* into global_daily_usage
  from private.webchat_global_daily_usage as usage
  where usage.usage_date = beijing_date
  for update;

  next_beijing_day := ((beijing_date + 1)::timestamp at time zone 'Asia/Shanghai');

  if daily_usage.request_count >= daily_request_limit then
    return query select
      'daily_request_limited'::text,
      'blocked'::text,
      minute_request_limit - minute_count,
      0,
      greatest(daily_token_limit - daily_usage.total_tokens - daily_usage.reserved_tokens, 0::bigint),
      greatest(
        1,
        pg_catalog.ceil(pg_catalog.date_part('epoch', next_beijing_day - checked_at))::integer
      );
    return;
  end if;

  if daily_usage.total_tokens + daily_usage.reserved_tokens + requested_reserved_tokens
    > daily_token_limit then
    return query select
      'daily_token_limited'::text,
      'blocked'::text,
      minute_request_limit - minute_count,
      daily_request_limit - daily_usage.request_count,
      greatest(daily_token_limit - daily_usage.total_tokens - daily_usage.reserved_tokens, 0::bigint),
      greatest(
        1,
        pg_catalog.ceil(pg_catalog.date_part('epoch', next_beijing_day - checked_at))::integer
      );
    return;
  end if;

  if global_daily_usage.request_count >= global_daily_request_limit then
    return query select
      'global_daily_request_limited'::text,
      'blocked'::text,
      minute_request_limit - minute_count,
      daily_request_limit - daily_usage.request_count,
      greatest(daily_token_limit - daily_usage.total_tokens - daily_usage.reserved_tokens, 0::bigint),
      greatest(
        1,
        pg_catalog.ceil(pg_catalog.date_part('epoch', next_beijing_day - checked_at))::integer
      );
    return;
  end if;

  if global_daily_usage.total_tokens
      + global_daily_usage.reserved_tokens
      + requested_reserved_tokens
    > global_daily_token_limit then
    return query select
      'global_daily_token_limited'::text,
      'blocked'::text,
      minute_request_limit - minute_count,
      daily_request_limit - daily_usage.request_count,
      greatest(daily_token_limit - daily_usage.total_tokens - daily_usage.reserved_tokens, 0::bigint),
      greatest(
        1,
        pg_catalog.ceil(pg_catalog.date_part('epoch', next_beijing_day - checked_at))::integer
      );
    return;
  end if;

  update private.webchat_daily_usage as usage
  set
    request_count = usage.request_count + 1,
    reserved_tokens = usage.reserved_tokens + requested_reserved_tokens,
    updated_at = checked_at
  where usage.user_id = requested_user_id
    and usage.usage_date = beijing_date
  returning usage.* into daily_usage;

  update private.webchat_global_daily_usage as usage
  set
    request_count = usage.request_count + 1,
    reserved_tokens = usage.reserved_tokens + requested_reserved_tokens,
    updated_at = checked_at
  where usage.usage_date = beijing_date
  returning usage.* into global_daily_usage;

  insert into private.webchat_requests (
    user_id,
    request_id,
    request_fingerprint,
    owner_token,
    status,
    quota_date,
    claimed_at,
    lease_expires_at,
    reserved_tokens,
    updated_at
  ) values (
    requested_user_id,
    requested_request_id,
    requested_fingerprint,
    requested_owner_token,
    'claimed',
    beijing_date,
    checked_at,
    checked_at + pg_catalog.make_interval(secs => lease_seconds),
    requested_reserved_tokens,
    checked_at
  );

  update private.webchat_quota_states as quota_state
  set updated_at = checked_at
  where quota_state.user_id = requested_user_id;

  update private.webchat_global_quota_state as global_state
  set updated_at = checked_at
  where global_state.singleton;

  return query select
    'acquired'::text,
    'claimed'::text,
    minute_request_limit - minute_count - 1,
    daily_request_limit - daily_usage.request_count,
    daily_token_limit - daily_usage.total_tokens - daily_usage.reserved_tokens,
    null::integer;
end;
$$;

create or replace function public.mark_webchat_request_started(
  requested_user_id uuid,
  requested_request_id text,
  requested_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  request private.webchat_requests%rowtype;
begin
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
    or request.status not in ('claimed', 'started')
    or request.lease_expires_at <= checked_at then
    return false;
  end if;

  if request.status = 'claimed' then
    update private.webchat_requests as candidate
    set
      status = 'started',
      upstream_started_at = checked_at,
      updated_at = checked_at
    where candidate.user_id = requested_user_id
      and candidate.request_id = requested_request_id;
  end if;

  return true;
end;
$$;

create or replace function public.finalize_webchat_request(
  requested_user_id uuid,
  requested_request_id text,
  requested_owner_token uuid,
  request_outcome text,
  used_input_tokens bigint default null,
  used_output_tokens bigint default null,
  used_total_tokens bigint default null
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

create or replace function public.release_webchat_request(
  requested_user_id uuid,
  requested_request_id text,
  requested_owner_token uuid,
  release_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  request private.webchat_requests%rowtype;
begin
  if release_reason is null or release_reason !~ '^[a-z0-9_.:-]{1,80}$' then
    raise exception 'Release reason has an invalid format.' using errcode = '22023';
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
    or request.status <> 'claimed' then
    return false;
  end if;

  update private.webchat_daily_usage as usage
  set
    request_count = usage.request_count - 1,
    reserved_tokens = usage.reserved_tokens - request.reserved_tokens,
    updated_at = checked_at
  where usage.user_id = request.user_id
    and usage.usage_date = request.quota_date;

  update private.webchat_global_daily_usage as usage
  set
    request_count = usage.request_count - 1,
    reserved_tokens = usage.reserved_tokens - request.reserved_tokens,
    updated_at = checked_at
  where usage.usage_date = request.quota_date;

  update private.webchat_requests as candidate
  set
    status = 'released',
    request_counted = false,
    lease_expires_at = null,
    finished_at = checked_at,
    outcome = release_reason,
    updated_at = checked_at
  where candidate.user_id = request.user_id
    and candidate.request_id = request.request_id;

  update private.webchat_quota_states as quota_state
  set updated_at = checked_at
  where quota_state.user_id = requested_user_id;

  update private.webchat_global_quota_state as global_state
  set updated_at = checked_at
  where global_state.singleton;

  return true;
end;
$$;

revoke all on function public.claim_webchat_request(
  uuid, text, text, uuid, integer, integer, bigint, integer, bigint, bigint, integer
) from public, anon, authenticated;
revoke all on function public.mark_webchat_request_started(uuid, text, uuid)
from public, anon, authenticated;
revoke all on function public.finalize_webchat_request(
  uuid, text, uuid, text, bigint, bigint, bigint
) from public, anon, authenticated;
revoke all on function public.release_webchat_request(uuid, text, uuid, text)
from public, anon, authenticated;

grant execute on function public.claim_webchat_request(
  uuid, text, text, uuid, integer, integer, bigint, integer, bigint, bigint, integer
) to service_role;
grant execute on function public.mark_webchat_request_started(uuid, text, uuid)
to service_role;
grant execute on function public.finalize_webchat_request(
  uuid, text, uuid, text, bigint, bigint, bigint
) to service_role;
grant execute on function public.release_webchat_request(uuid, text, uuid, text)
to service_role;

comment on table private.webchat_global_quota_state is
  'Singleton row-lock anchor acquired before every global WebChat accounting transition.';
comment on table private.webchat_global_daily_usage is
  'Asia/Shanghai aggregate WebChat request, token, and active reservation accounting across all members.';
comment on table private.webchat_quota_states is
  'Per-user row-lock anchor for serializing WebChat quota lifecycle transitions.';
comment on table private.webchat_daily_usage is
  'Asia/Shanghai daily WebChat request, token, and active reservation accounting.';
comment on table private.webchat_requests is
  'Private idempotency ledger and fenced lease lifecycle for WebChat requests; stores no message content.';
comment on function public.claim_webchat_request(
  uuid, text, text, uuid, integer, integer, bigint, integer, bigint, bigint, integer
) is 'Atomically claims one WebChat request after per-user and global concurrency, request, and reserved-token checks.';
comment on function public.mark_webchat_request_started(uuid, text, uuid) is
  'Marks the fenced WebChat claim as potentially billable immediately before the relay fetch.';
comment on function public.finalize_webchat_request(
  uuid, text, uuid, text, bigint, bigint, bigint
) is 'Finalizes trusted relay usage, or conservatively charges the reservation when usage is unknown.';
comment on function public.release_webchat_request(uuid, text, uuid, text) is
  'Releases and refunds a fenced WebChat claim only before the relay request has started.';
