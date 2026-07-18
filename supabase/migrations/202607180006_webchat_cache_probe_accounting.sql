-- A production prompt-cache probe reuses the relay configuration already kept
-- in Supabase Vault. Its two billable requests are fenced, rate limited, and
-- charged only to the global WebChat budget; no member quota or prompt body is
-- stored. Only service_role RPCs can operate the probe ledger.

create table private.webchat_cache_probe_runs (
  id uuid primary key,
  owner_token uuid not null unique,
  status text not null,
  quota_date date not null,
  request_count integer not null default 2,
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
  cached_input_tokens bigint,
  cache_write_tokens bigint,
  outcome text,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint webchat_cache_probe_request_count_fixed check (request_count = 2),
  constraint webchat_cache_probe_status_valid check (
    status in ('claimed', 'started', 'finished', 'released', 'expired')
  ),
  constraint webchat_cache_probe_reservation_positive check (
    reserved_tokens between 1024 and 1000000
  ),
  constraint webchat_cache_probe_tokens_nonnegative check (
    (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
    and (total_tokens is null or total_tokens >= 0)
    and charged_tokens >= 0
    and (cached_input_tokens is null or cached_input_tokens >= 0)
    and (cache_write_tokens is null or cache_write_tokens >= 0)
  ),
  constraint webchat_cache_probe_usage_complete check (
    (input_tokens is null and output_tokens is null and total_tokens is null)
    or (
      input_tokens is not null
      and output_tokens is not null
      and total_tokens is not null
      and total_tokens = input_tokens + output_tokens
    )
  ),
  constraint webchat_cache_probe_cache_usage_consistent check (
    (cached_input_tokens is null or (
      input_tokens is not null and cached_input_tokens <= input_tokens
    ))
    and (cache_write_tokens is null or input_tokens is not null)
  ),
  constraint webchat_cache_probe_started_state check (
    (status = 'claimed' and upstream_started_at is null)
    or (status = 'released' and upstream_started_at is null)
    or (status in ('started', 'finished') and upstream_started_at is not null)
    or status = 'expired'
  ),
  constraint webchat_cache_probe_lease_state check (
    (status in ('claimed', 'started') and lease_expires_at is not null and finished_at is null)
    or (status not in ('claimed', 'started') and lease_expires_at is null and finished_at is not null)
  ),
  constraint webchat_cache_probe_terminal_outcome check (
    (status in ('claimed', 'started') and outcome is null)
    or (status not in ('claimed', 'started') and outcome is not null)
  ),
  constraint webchat_cache_probe_outcome_format check (
    outcome is null or outcome ~ '^[a-z0-9_.:-]{1,80}$'
  )
);

create unique index webchat_cache_probe_one_active_idx
  on private.webchat_cache_probe_runs ((true))
  where status in ('claimed', 'started');

create index webchat_cache_probe_recent_idx
  on private.webchat_cache_probe_runs (claimed_at desc, id desc);

alter table private.webchat_cache_probe_runs enable row level security;

revoke all on table private.webchat_cache_probe_runs
from public, anon, authenticated, service_role;

create function public.claim_webchat_cache_probe(
  requested_probe_id uuid,
  requested_owner_token uuid,
  requested_reserved_tokens bigint default 10000,
  lease_seconds integer default 180
)
returns table (
  decision text,
  status text,
  retry_after_seconds integer,
  usage_date date,
  remaining_global_requests integer,
  remaining_global_tokens bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  beijing_date date := (checked_at at time zone 'Asia/Shanghai')::date;
  next_beijing_day timestamptz := (
    ((checked_at at time zone 'Asia/Shanghai')::date + 1)::timestamp
      at time zone 'Asia/Shanghai'
  );
  existing_run private.webchat_cache_probe_runs%rowtype;
  active_run private.webchat_cache_probe_runs%rowtype;
  relay_config private.webchat_relay_config%rowtype;
  current_usage private.webchat_global_daily_usage%rowtype;
  previous_claimed_at timestamptz;
  cooldown_ends_at timestamptz;
begin
  if requested_probe_id is null or requested_owner_token is null then
    raise exception 'Probe ID and owner token are required.' using errcode = '22004';
  end if;
  if requested_reserved_tokens is null
    or requested_reserved_tokens not between 1024 and 1000000 then
    raise exception 'Probe reservation must be between 1024 and 1000000 tokens.'
      using errcode = '22023';
  end if;
  if lease_seconds is null or lease_seconds not between 60 and 600 then
    raise exception 'Probe lease must be between 60 and 600 seconds.' using errcode = '22023';
  end if;

  perform 1
  from private.webchat_global_quota_state as global_state
  where global_state.singleton
  for update;

  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;

  select candidate.* into existing_run
  from private.webchat_cache_probe_runs as candidate
  where candidate.id = requested_probe_id
  for update;

  if found then
    return query select
      case when existing_run.owner_token = requested_owner_token
        then 'duplicate'::text else 'conflict'::text end,
      existing_run.status,
      null::integer,
      existing_run.quota_date,
      0,
      0::bigint;
    return;
  end if;

  select candidate.* into active_run
  from private.webchat_cache_probe_runs as candidate
  where candidate.status in ('claimed', 'started')
  order by candidate.claimed_at, candidate.id
  limit 1
  for update;

  if found then
    if active_run.lease_expires_at <= checked_at then
      select usage.* into current_usage
      from private.webchat_global_daily_usage as usage
      where usage.usage_date = active_run.quota_date
      for update;

      if not found then
        raise exception 'WebChat probe quota row is missing.' using errcode = '55000';
      end if;

      if current_usage.reserved_tokens < active_run.reserved_tokens
        or (
          active_run.status = 'claimed'
          and active_run.request_counted
          and current_usage.request_count < active_run.request_count
        ) then
        raise exception 'WebChat probe quota accounting is inconsistent.' using errcode = '55000';
      end if;

      if active_run.status = 'claimed' then
        update private.webchat_global_daily_usage as usage
        set
          request_count = usage.request_count
            - case when active_run.request_counted then active_run.request_count else 0 end,
          reserved_tokens = usage.reserved_tokens - active_run.reserved_tokens,
          updated_at = checked_at
        where usage.usage_date = active_run.quota_date;
      else
        update private.webchat_global_daily_usage as usage
        set
          reserved_tokens = usage.reserved_tokens - active_run.reserved_tokens,
          unknown_tokens = usage.unknown_tokens + active_run.reserved_tokens,
          total_tokens = usage.total_tokens + active_run.reserved_tokens,
          updated_at = checked_at
        where usage.usage_date = active_run.quota_date;
      end if;

      update private.webchat_cache_probe_runs as candidate
      set
        status = 'expired',
        request_counted = case when active_run.status = 'claimed' then false else candidate.request_counted end,
        lease_expires_at = null,
        finished_at = checked_at,
        charged_tokens = case when active_run.status = 'started'
          then active_run.reserved_tokens else 0 end,
        outcome = case when active_run.status = 'started'
          then 'lease_expired_after_start' else 'lease_expired_before_start' end,
        updated_at = checked_at
      where candidate.id = active_run.id;
    else
      return query select
        'active_concurrent'::text,
        active_run.status,
        greatest(
          1,
          pg_catalog.ceil(
            pg_catalog.date_part('epoch', active_run.lease_expires_at - checked_at)
          )::integer
        ),
        active_run.quota_date,
        0,
        0::bigint;
      return;
    end if;
  end if;

  select pg_catalog.max(run.claimed_at) into previous_claimed_at
  from private.webchat_cache_probe_runs as run
  where run.status in ('started', 'finished', 'expired')
    and run.claimed_at > checked_at - interval '30 minutes';

  if previous_claimed_at is not null then
    cooldown_ends_at := previous_claimed_at + interval '30 minutes';
    return query select
      'cooldown'::text,
      'blocked'::text,
      greatest(
        1,
        pg_catalog.ceil(pg_catalog.date_part('epoch', cooldown_ends_at - checked_at))::integer
      ),
      beijing_date,
      0,
      0::bigint;
    return;
  end if;

  select config.* into relay_config
  from private.webchat_relay_config as config
  where config.singleton
  for share;

  if not found
    or not relay_config.requests_enabled
    or relay_config.base_url is null
    or relay_config.model is null
    or relay_config.api_key_secret_id is null then
    return query select
      'relay_disabled'::text,
      'blocked'::text,
      null::integer,
      beijing_date,
      0,
      0::bigint;
    return;
  end if;

  insert into private.webchat_global_daily_usage as usage (usage_date, updated_at)
  values (beijing_date, checked_at)
  on conflict on constraint webchat_global_daily_usage_pkey do nothing;

  select usage.* into current_usage
  from private.webchat_global_daily_usage as usage
  where usage.usage_date = beijing_date
  for update;

  if not found then
    raise exception 'WebChat probe quota row is missing.' using errcode = '55000';
  end if;

  if current_usage.request_count + 2 > relay_config.global_daily_request_limit then
    return query select
      'global_daily_request_limited'::text,
      'blocked'::text,
      greatest(
        1,
        pg_catalog.ceil(pg_catalog.date_part('epoch', next_beijing_day - checked_at))::integer
      ),
      beijing_date,
      greatest(relay_config.global_daily_request_limit - current_usage.request_count, 0),
      greatest(
        relay_config.global_daily_token_limit
          - current_usage.total_tokens - current_usage.reserved_tokens,
        0::bigint
      );
    return;
  end if;

  if current_usage.total_tokens
      + current_usage.reserved_tokens
      + requested_reserved_tokens > relay_config.global_daily_token_limit then
    return query select
      'global_daily_token_limited'::text,
      'blocked'::text,
      greatest(
        1,
        pg_catalog.ceil(pg_catalog.date_part('epoch', next_beijing_day - checked_at))::integer
      ),
      beijing_date,
      greatest(relay_config.global_daily_request_limit - current_usage.request_count, 0),
      greatest(
        relay_config.global_daily_token_limit
          - current_usage.total_tokens - current_usage.reserved_tokens,
        0::bigint
      );
    return;
  end if;

  update private.webchat_global_daily_usage as usage
  set
    request_count = usage.request_count + 2,
    reserved_tokens = usage.reserved_tokens + requested_reserved_tokens,
    updated_at = checked_at
  where usage.usage_date = beijing_date
  returning usage.* into current_usage;

  insert into private.webchat_cache_probe_runs (
    id,
    owner_token,
    status,
    quota_date,
    claimed_at,
    lease_expires_at,
    reserved_tokens,
    updated_at
  ) values (
    requested_probe_id,
    requested_owner_token,
    'claimed',
    beijing_date,
    checked_at,
    checked_at + pg_catalog.make_interval(secs => lease_seconds),
    requested_reserved_tokens,
    checked_at
  );

  update private.webchat_global_quota_state as global_state
  set updated_at = checked_at
  where global_state.singleton;

  return query select
    'acquired'::text,
    'claimed'::text,
    null::integer,
    beijing_date,
    greatest(relay_config.global_daily_request_limit - current_usage.request_count, 0),
    greatest(
      relay_config.global_daily_token_limit
        - current_usage.total_tokens - current_usage.reserved_tokens,
      0::bigint
    );
end;
$$;

create function public.mark_webchat_cache_probe_started(
  requested_probe_id uuid,
  requested_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  probe private.webchat_cache_probe_runs%rowtype;
begin
  perform 1
  from private.webchat_global_quota_state as global_state
  where global_state.singleton
  for update;

  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;

  select candidate.* into probe
  from private.webchat_cache_probe_runs as candidate
  where candidate.id = requested_probe_id
  for update;

  if not found
    or probe.owner_token is distinct from requested_owner_token
    or probe.status not in ('claimed', 'started')
    or probe.lease_expires_at <= checked_at then
    return false;
  end if;

  if probe.status = 'claimed' then
    update private.webchat_cache_probe_runs as candidate
    set
      status = 'started',
      upstream_started_at = checked_at,
      updated_at = checked_at
    where candidate.id = requested_probe_id;
  end if;

  return true;
end;
$$;

create function public.finalize_webchat_cache_probe(
  requested_probe_id uuid,
  requested_owner_token uuid,
  probe_outcome text,
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
  probe private.webchat_cache_probe_runs%rowtype;
  usage_is_known boolean;
  final_charge bigint;
  settled_outcome text := probe_outcome;
begin
  if probe_outcome is null or probe_outcome !~ '^[a-z0-9_.:-]{1,80}$' then
    raise exception 'Probe outcome has an invalid format.' using errcode = '22023';
  end if;

  usage_is_known := used_input_tokens is not null
    and used_output_tokens is not null
    and used_total_tokens is not null;
  if usage_is_known <> (
    used_input_tokens is not null
    or used_output_tokens is not null
    or used_total_tokens is not null
  ) then
    raise exception 'Probe token usage must be complete or omitted.' using errcode = '22023';
  end if;
  if usage_is_known and (
    used_input_tokens < 0
    or used_output_tokens < 0
    or used_total_tokens <> used_input_tokens + used_output_tokens
  ) then
    raise exception 'Probe token usage is inconsistent.' using errcode = '22023';
  end if;
  if observed_cached_input_tokens is not null and (
    not usage_is_known
    or observed_cached_input_tokens < 0
    or observed_cached_input_tokens > used_input_tokens
  ) then
    raise exception 'Probe cached token usage is inconsistent.' using errcode = '22023';
  end if;
  if observed_cache_write_tokens is not null and (
    not usage_is_known or observed_cache_write_tokens < 0
  ) then
    raise exception 'Probe cache-write usage is inconsistent.' using errcode = '22023';
  end if;

  perform 1
  from private.webchat_global_quota_state as global_state
  where global_state.singleton
  for update;

  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;

  select candidate.* into probe
  from private.webchat_cache_probe_runs as candidate
  where candidate.id = requested_probe_id
  for update;

  if not found
    or probe.owner_token is distinct from requested_owner_token
    or probe.status <> 'started' then
    return query select
      false,
      coalesce(probe.status, 'missing'),
      coalesce(probe.charged_tokens, 0::bigint);
    return;
  end if;

  if usage_is_known and used_total_tokens > probe.reserved_tokens then
    usage_is_known := false;
    used_input_tokens := null;
    used_output_tokens := null;
    used_total_tokens := null;
    observed_cached_input_tokens := null;
    observed_cache_write_tokens := null;
    settled_outcome := 'usage_exceeds_reservation';
  end if;

  perform 1
  from private.webchat_global_daily_usage as usage
  where usage.usage_date = probe.quota_date
    and usage.reserved_tokens >= probe.reserved_tokens
  for update;

  if not found then
    raise exception 'WebChat probe quota accounting is inconsistent.' using errcode = '55000';
  end if;

  final_charge := case when usage_is_known then used_total_tokens else probe.reserved_tokens end;

  update private.webchat_global_daily_usage as usage
  set
    reserved_tokens = usage.reserved_tokens - probe.reserved_tokens,
    input_tokens = usage.input_tokens + coalesce(used_input_tokens, 0),
    output_tokens = usage.output_tokens + coalesce(used_output_tokens, 0),
    unknown_tokens = usage.unknown_tokens
      + case when usage_is_known then 0 else probe.reserved_tokens end,
    total_tokens = usage.total_tokens + final_charge,
    updated_at = checked_at
  where usage.usage_date = probe.quota_date;

  update private.webchat_cache_probe_runs as candidate
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
    outcome = settled_outcome,
    updated_at = checked_at
  where candidate.id = probe.id;

  update private.webchat_global_quota_state as global_state
  set updated_at = checked_at
  where global_state.singleton;

  return query select true, 'finished'::text, final_charge;
end;
$$;

create function public.release_webchat_cache_probe(
  requested_probe_id uuid,
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
  probe private.webchat_cache_probe_runs%rowtype;
begin
  if release_reason is null or release_reason !~ '^[a-z0-9_.:-]{1,80}$' then
    raise exception 'Probe release reason has an invalid format.' using errcode = '22023';
  end if;

  perform 1
  from private.webchat_global_quota_state as global_state
  where global_state.singleton
  for update;

  if not found then
    raise exception 'WebChat global quota state is missing.' using errcode = '55000';
  end if;

  select candidate.* into probe
  from private.webchat_cache_probe_runs as candidate
  where candidate.id = requested_probe_id
  for update;

  if not found
    or probe.owner_token is distinct from requested_owner_token
    or probe.status <> 'claimed' then
    return false;
  end if;

  perform 1
  from private.webchat_global_daily_usage as usage
  where usage.usage_date = probe.quota_date
    and usage.reserved_tokens >= probe.reserved_tokens
    and (
      not probe.request_counted
      or usage.request_count >= probe.request_count
    )
  for update;

  if not found then
    raise exception 'WebChat probe quota accounting is inconsistent.' using errcode = '55000';
  end if;

  update private.webchat_global_daily_usage as usage
  set
    request_count = usage.request_count
      - case when probe.request_counted then probe.request_count else 0 end,
    reserved_tokens = usage.reserved_tokens - probe.reserved_tokens,
    updated_at = checked_at
  where usage.usage_date = probe.quota_date;

  update private.webchat_cache_probe_runs as candidate
  set
    status = 'released',
    request_counted = false,
    lease_expires_at = null,
    finished_at = checked_at,
    outcome = release_reason,
    updated_at = checked_at
  where candidate.id = probe.id;

  update private.webchat_global_quota_state as global_state
  set updated_at = checked_at
  where global_state.singleton;

  return true;
end;
$$;

create function public.purge_webchat_cache_probe_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged_count integer;
begin
  delete from private.webchat_cache_probe_runs as run
  where run.status not in ('claimed', 'started')
    and run.finished_at < pg_catalog.clock_timestamp() - interval '180 days';
  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

revoke all on function public.claim_webchat_cache_probe(uuid, uuid, bigint, integer)
from public, anon, authenticated, service_role;
revoke all on function public.mark_webchat_cache_probe_started(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.finalize_webchat_cache_probe(
  uuid, uuid, text, bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.release_webchat_cache_probe(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.purge_webchat_cache_probe_runs()
from public, anon, authenticated, service_role;

grant execute on function public.claim_webchat_cache_probe(uuid, uuid, bigint, integer)
to service_role;
grant execute on function public.mark_webchat_cache_probe_started(uuid, uuid)
to service_role;
grant execute on function public.finalize_webchat_cache_probe(
  uuid, uuid, text, bigint, bigint, bigint, bigint, bigint
) to service_role;
grant execute on function public.release_webchat_cache_probe(uuid, uuid, text)
to service_role;
grant execute on function public.purge_webchat_cache_probe_runs()
to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'webchat-cache-probe-retention';

select cron.schedule(
  'webchat-cache-probe-retention',
  '45 19 * * *',
  $command$select public.purge_webchat_cache_probe_runs();$command$
);

comment on table private.webchat_cache_probe_runs is
  'Sanitized global-budget ledger for service-role-only two-request prompt cache probes.';
comment on function public.claim_webchat_cache_probe(uuid, uuid, bigint, integer) is
  'Claims one cooldown-limited two-request cache probe under the global WebChat budget.';
comment on function public.finalize_webchat_cache_probe(
  uuid, uuid, text, bigint, bigint, bigint, bigint, bigint
) is
  'Settles a started cache probe with aggregate Responses usage and cache token counters.';
comment on function public.purge_webchat_cache_probe_runs() is
  'Removes terminal sanitized cache probe ledgers after 180 days.';
