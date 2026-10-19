-- Extend the existing service-only Key pool to Luogu. Existing callers and grants remain valid.

alter table private.firecrawl_key_assignments
  drop constraint firecrawl_key_assignments_purpose_valid,
  add constraint firecrawl_key_assignments_purpose_valid check (purpose in ('qoj', 'luogu'));

create or replace function public.select_firecrawl_runtime_key(
  requested_purpose text,
  requested_operation_id text default null
)
returns table (
  pool_configured boolean,
  key_id uuid,
  api_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_purpose text := nullif(pg_catalog.btrim(requested_purpose), '');
  normalized_operation_id text := nullif(pg_catalog.btrim(requested_operation_id), '');
  selected_id uuid;
  checked_at timestamptz := pg_catalog.clock_timestamp();
begin
  if normalized_purpose is null or normalized_purpose not in ('qoj', 'nowcoder', 'luogu') then
    raise exception 'Unsupported Firecrawl key purpose.' using errcode = '22023';
  end if;
  if normalized_purpose in ('qoj', 'luogu') and (
    normalized_operation_id is null
    or normalized_operation_id !~ '^[a-z0-9:_-]{1,200}$'
  ) then
    raise exception 'A valid Firecrawl operation ID is required for %.', upper(normalized_purpose) using errcode = '22023';
  end if;
  if normalized_purpose = 'nowcoder' and requested_operation_id is not null then
    raise exception 'Firecrawl operation IDs are reserved for QOJ and Luogu.' using errcode = '22023';
  end if;

  if normalized_purpose in ('qoj', 'luogu') then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(normalized_operation_id, 0)
    );
    if exists (
      select 1
      from private.firecrawl_key_assignments as assignment
      where assignment.operation_id = normalized_operation_id
    ) then
      raise exception 'This % operation already claimed a Firecrawl key.', upper(normalized_purpose) using errcode = '55000';
    end if;
  end if;

  select config.id into selected_id
  from private.firecrawl_api_keys as config
  join vault.secrets as secret on secret.id = config.vault_secret_id
  where config.enabled
    and config.health_status <> 'auth_failed'
    and (config.credits_remaining is null or config.credits_remaining > 0)
    and (config.cooldown_until is null or config.cooldown_until <= checked_at)
  order by config.priority, config.last_selected_at nulls first, config.id
  for update of config skip locked
  limit 1;

  if selected_id is null then
    if normalized_purpose in ('qoj', 'luogu') then
      insert into private.firecrawl_key_assignments (operation_id, purpose, key_id, claimed_at)
      values (normalized_operation_id, normalized_purpose, null, checked_at);
    end if;
    return query
    select exists (select 1 from private.firecrawl_api_keys), null::uuid, null::text;
    return;
  end if;

  update private.firecrawl_api_keys as config
  set last_selected_at = checked_at
  where config.id = selected_id;

  if normalized_purpose in ('qoj', 'luogu') then
    insert into private.firecrawl_key_assignments (operation_id, purpose, key_id, claimed_at)
    values (normalized_operation_id, normalized_purpose, selected_id, checked_at);
  end if;

  return query
  select
    true,
    config.id,
    secret.decrypted_secret
  from private.firecrawl_api_keys as config
  join vault.decrypted_secrets as secret on secret.id = config.vault_secret_id
  where config.id = selected_id;
end;
$$;

create or replace function public.record_firecrawl_key_observation(
  target_key_id uuid,
  requested_purpose text,
  observed_success boolean,
  observed_error_code text default null,
  observed_credits_remaining bigint default null,
  observed_credits_total bigint default null,
  observed_billing_period_end timestamptz default null,
  observed_severity text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_purpose text := nullif(pg_catalog.btrim(requested_purpose), '');
  normalized_error_code text := nullif(pg_catalog.btrim(observed_error_code), '');
  checked_at timestamptz := pg_catalog.clock_timestamp();
  next_failures integer;
  expected_severity text;
begin
  if normalized_purpose is null
    or normalized_purpose not in ('qoj', 'nowcoder', 'luogu', 'credit_monitor', 'admin_check') then
    raise exception 'Unsupported Firecrawl observation purpose.' using errcode = '22023';
  end if;
  if observed_success is null then
    raise exception 'Firecrawl observation success state is required.' using errcode = '22004';
  end if;
  if normalized_error_code is not null
    and normalized_error_code !~ '^[a-z0-9_.:-]{1,80}$' then
    raise exception 'Firecrawl observation error code is invalid.' using errcode = '22023';
  end if;
  if observed_success and normalized_error_code is not null then
    raise exception 'A successful Firecrawl observation cannot contain an error code.' using errcode = '22023';
  end if;
  if not observed_success and normalized_error_code is null then
    raise exception 'A failed Firecrawl observation requires an error code.' using errcode = '22023';
  end if;
  if (observed_credits_remaining is null) <> (observed_credits_total is null)
    or observed_credits_remaining < 0
    or observed_credits_total <= 0 then
    raise exception 'Firecrawl credit observation is invalid.' using errcode = '22023';
  end if;
  expected_severity := case
    when observed_credits_total is null then null
    when observed_credits_remaining::numeric / observed_credits_total::numeric <= 0.10 then 'critical'
    when observed_credits_remaining::numeric / observed_credits_total::numeric <= 0.25 then 'warning'
    else null
  end;
  if observed_severity is distinct from expected_severity then
    raise exception 'Firecrawl credit severity is invalid.' using errcode = '22023';
  end if;

  select config.consecutive_failures + 1 into next_failures
  from private.firecrawl_api_keys as config
  where config.id = target_key_id
  for update;
  if not found then
    raise exception 'Firecrawl key was not found.' using errcode = 'P0002';
  end if;

  update private.firecrawl_api_keys as config
  set
    health_status = case
      when observed_success then coalesce(expected_severity, 'healthy')
      when normalized_error_code in ('auth_required', 'auth_expired') then 'auth_failed'
      when normalized_error_code = 'rate_limited' then 'rate_limited'
      else 'degraded'
    end,
    consecutive_failures = case when observed_success then 0 else next_failures end,
    cooldown_until = case
      when observed_success then null
      when normalized_error_code in ('auth_required', 'auth_expired') then null
      when normalized_error_code = 'rate_limited' then checked_at + interval '30 minutes'
      when normalized_purpose in ('qoj', 'nowcoder', 'luogu') then
        checked_at + pg_catalog.make_interval(
          mins => least(80, 5 * (2 ^ least(next_failures - 1, 4)))::integer
        )
      else null
    end,
    last_checked_at = checked_at,
    last_success_at = case when observed_success then checked_at else config.last_success_at end,
    last_failure_at = case when observed_success then config.last_failure_at else checked_at end,
    last_error_code = case when observed_success then null else normalized_error_code end,
    credits_remaining = case
      when observed_credits_remaining is null then config.credits_remaining
      else observed_credits_remaining
    end,
    credits_total = case
      when observed_credits_total is null then config.credits_total
      else observed_credits_total
    end,
    billing_period_end = case
      when observed_credits_total is null then config.billing_period_end
      else observed_billing_period_end
    end,
    updated_at = checked_at
  where config.id = target_key_id;
end;
$$;

comment on table private.firecrawl_key_assignments is
  'Private one-shot QOJ and Luogu attempt claims; one Key across all pages without replacement.';
comment on function public.select_firecrawl_runtime_key(text, text) is
  'Selects one eligible Firecrawl key; QOJ and Luogu require an operation ID claimed only once.';
