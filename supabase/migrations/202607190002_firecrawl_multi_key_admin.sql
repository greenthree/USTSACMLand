-- Firecrawl credentials are managed as a private pool. Metadata is visible to
-- live administrators only through redacted RPCs; decrypted secrets are
-- returned exclusively to service-role runtime functions.

create table private.firecrawl_api_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  vault_secret_id uuid not null unique,
  enabled boolean not null default true,
  priority integer not null default 100,
  health_status text not null default 'unknown',
  consecutive_failures integer not null default 0,
  cooldown_until timestamptz,
  last_selected_at timestamptz,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text,
  credits_remaining bigint,
  credits_total bigint,
  billing_period_end timestamptz,
  version bigint not null default 0,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint firecrawl_api_keys_label_length
    check (pg_catalog.char_length(label) between 1 and 80),
  constraint firecrawl_api_keys_label_trimmed check (label = pg_catalog.btrim(label)),
  constraint firecrawl_api_keys_priority_range check (priority between 1 and 1000),
  constraint firecrawl_api_keys_health_status_valid check (
    health_status in (
      'unknown', 'healthy', 'warning', 'critical', 'degraded', 'rate_limited',
      'auth_failed'
    )
  ),
  constraint firecrawl_api_keys_failures_nonnegative check (consecutive_failures >= 0),
  constraint firecrawl_api_keys_error_code_format check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_.:-]{1,80}$'
  ),
  constraint firecrawl_api_keys_credits_valid check (
    (credits_remaining is null and credits_total is null)
    or (
      credits_remaining is not null
      and credits_total is not null
      and credits_remaining >= 0
      and credits_total > 0
    )
  ),
  constraint firecrawl_api_keys_version_nonnegative check (version >= 0)
);

create table private.firecrawl_key_assignments (
  operation_id text primary key,
  purpose text not null,
  key_id uuid references private.firecrawl_api_keys(id) on delete set null,
  claimed_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint firecrawl_key_assignments_operation_id_valid check (
    operation_id ~ '^[a-z0-9:_-]{1,200}$'
  ),
  constraint firecrawl_key_assignments_purpose_valid check (purpose in ('qoj'))
);

create index firecrawl_key_assignments_claimed_at_idx
on private.firecrawl_key_assignments (claimed_at);

create unique index firecrawl_api_keys_label_unique
on private.firecrawl_api_keys (pg_catalog.lower(label));

create index firecrawl_api_keys_selection_idx
on private.firecrawl_api_keys (priority, last_selected_at, id)
where enabled and health_status <> 'auth_failed';

alter table private.firecrawl_api_keys enable row level security;
alter table private.firecrawl_key_assignments enable row level security;
revoke all on table private.firecrawl_api_keys
from public, anon, authenticated, service_role;
revoke all on table private.firecrawl_key_assignments
from public, anon, authenticated, service_role;

create or replace function public.admin_list_firecrawl_api_keys(actor_id uuid)
returns table (
  id uuid,
  label text,
  key_configured boolean,
  enabled boolean,
  priority integer,
  health_status text,
  consecutive_failures integer,
  cooldown_until timestamptz,
  last_selected_at timestamptz,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text,
  credits_remaining bigint,
  credits_total bigint,
  billing_period_end timestamptz,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = actor_id
      and profile.role = 'admin'
      and profile.review_status = 'approved'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select
    config.id,
    config.label,
    exists (
      select 1 from vault.secrets as secret where secret.id = config.vault_secret_id
    ),
    config.enabled,
    config.priority,
    config.health_status,
    config.consecutive_failures,
    config.cooldown_until,
    config.last_selected_at,
    config.last_checked_at,
    config.last_success_at,
    config.last_failure_at,
    config.last_error_code,
    config.credits_remaining,
    config.credits_total,
    config.billing_period_end,
    config.version,
    config.created_at,
    config.updated_at
  from private.firecrawl_api_keys as config
  order by config.priority, pg_catalog.lower(config.label), config.id;
end;
$$;

create or replace function public.admin_upsert_firecrawl_api_key(
  actor_id uuid,
  target_key_id uuid,
  requested_label text,
  replacement_api_key text,
  requested_enabled boolean,
  requested_priority integer,
  expected_version bigint,
  reason text
)
returns table (
  id uuid,
  label text,
  key_configured boolean,
  enabled boolean,
  priority integer,
  health_status text,
  consecutive_failures integer,
  cooldown_until timestamptz,
  last_selected_at timestamptz,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text,
  credits_remaining bigint,
  credits_total bigint,
  billing_period_end timestamptz,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_label text := nullif(pg_catalog.btrim(requested_label), '');
  normalized_api_key text := nullif(pg_catalog.btrim(replacement_api_key), '');
  normalized_reason text := nullif(pg_catalog.btrim(reason), '');
  checked_at timestamptz := pg_catalog.clock_timestamp();
  current_config private.firecrawl_api_keys%rowtype;
  previous_config private.firecrawl_api_keys%rowtype;
  next_id uuid := coalesce(target_key_id, gen_random_uuid());
  next_secret_id uuid;
  changed_fields text[] := array[]::text[];
  key_was_configured boolean := false;
  key_is_configured boolean := false;
begin
  perform public.consume_admin_rate_limit(actor_id, 'firecrawl_keys.write', 15, 300);

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = actor_id
      and profile.role = 'admin'
      and profile.review_status = 'approved'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if normalized_label is null or pg_catalog.char_length(normalized_label) > 80 then
    raise exception 'Firecrawl key label must contain 1 to 80 characters.' using errcode = '22023';
  end if;
  if requested_enabled is null then
    raise exception 'Firecrawl key enabled state is required.' using errcode = '22004';
  end if;
  if requested_priority is null or requested_priority not between 1 and 1000 then
    raise exception 'Firecrawl key priority must be between 1 and 1000.' using errcode = '22023';
  end if;
  if replacement_api_key is not null and normalized_api_key is null then
    raise exception 'Replacement Firecrawl API key cannot be empty.' using errcode = '22023';
  end if;
  if normalized_api_key is not null and (
    pg_catalog.char_length(normalized_api_key) not between 16 and 4096
    or normalized_api_key ~ '[[:space:]]'
  ) then
    raise exception 'Replacement Firecrawl API key has an invalid format.' using errcode = '22023';
  end if;
  if normalized_reason is null or pg_catalog.char_length(normalized_reason) not between 3 and 500 then
    raise exception 'Configuration change reason must contain 3 to 500 characters.' using errcode = '22023';
  end if;

  perform 1
  from public.profiles as administrator
  where administrator.id = actor_id
    and administrator.role = 'admin'
    and administrator.review_status = 'approved'
  for key share;
  if not found then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if target_key_id is null then
    if expected_version is not null then
      raise exception 'A new Firecrawl key cannot have an expected version.' using errcode = '22023';
    end if;
    if normalized_api_key is null then
      raise exception 'A Firecrawl API key is required when creating a key.' using errcode = '22023';
    end if;
    if requested_enabled then
      raise exception 'A new Firecrawl key must pass a health check before it can be enabled.'
        using errcode = '22023';
    end if;
    if exists (
      select 1 from private.firecrawl_api_keys as config
      where pg_catalog.lower(config.label) = pg_catalog.lower(normalized_label)
    ) then
      raise exception 'A Firecrawl key with this label already exists.' using errcode = '23505';
    end if;

    select vault.create_secret(
      new_secret => normalized_api_key,
      new_name => 'firecrawl_api_key_' || next_id::text,
      new_description => 'USTS ACM Land Firecrawl API key'
    ) into next_secret_id;

    insert into private.firecrawl_api_keys (
      id, label, vault_secret_id, enabled, priority, created_at, created_by, updated_at, updated_by
    ) values (
      next_id, normalized_label, next_secret_id, requested_enabled, requested_priority,
      checked_at, actor_id, checked_at, actor_id
    )
    returning * into current_config;

    changed_fields := array['label', 'apiKey', 'enabled', 'priority'];
  else
    if expected_version is null or expected_version < 0 then
      raise exception 'Expected Firecrawl key version is required.' using errcode = '22004';
    end if;

    select config.* into current_config
    from private.firecrawl_api_keys as config
    where config.id = target_key_id
    for update;
    if not found then
      raise exception 'Firecrawl key was not found.' using errcode = 'P0002';
    end if;
    if current_config.version is distinct from expected_version then
      raise exception 'Firecrawl key changed after it was loaded.' using errcode = '40001';
    end if;
    if exists (
      select 1 from private.firecrawl_api_keys as config
      where config.id <> target_key_id
        and pg_catalog.lower(config.label) = pg_catalog.lower(normalized_label)
    ) then
      raise exception 'A Firecrawl key with this label already exists.' using errcode = '23505';
    end if;

    previous_config := current_config;
    key_was_configured := exists (
      select 1 from vault.secrets as secret where secret.id = current_config.vault_secret_id
    );
    if not key_was_configured and normalized_api_key is null then
      raise exception 'A replacement Firecrawl API key is required.' using errcode = '22023';
    end if;
    if normalized_api_key is not null and requested_enabled then
      raise exception 'A rotated Firecrawl key must pass a health check before it can be enabled.'
        using errcode = '22023';
    end if;
    if not current_config.enabled
      and requested_enabled
      and normalized_api_key is null
      and (
        current_config.health_status not in ('healthy', 'warning', 'critical')
        or current_config.credits_remaining is null
        or current_config.credits_remaining <= 0
        or current_config.last_checked_at is null
        or current_config.last_checked_at < checked_at - interval '60 minutes'
      ) then
      raise exception 'Only a successfully checked Firecrawl key can be enabled.'
        using errcode = '22023';
    end if;

    if current_config.label is distinct from normalized_label then
      changed_fields := pg_catalog.array_append(changed_fields, 'label');
    end if;
    if current_config.enabled is distinct from requested_enabled then
      changed_fields := pg_catalog.array_append(changed_fields, 'enabled');
    end if;
    if current_config.priority is distinct from requested_priority then
      changed_fields := pg_catalog.array_append(changed_fields, 'priority');
    end if;
    if normalized_api_key is not null then
      changed_fields := pg_catalog.array_append(changed_fields, 'apiKey');
    end if;
    if pg_catalog.cardinality(changed_fields) = 0 then
      raise exception 'At least one Firecrawl key field must change.' using errcode = '22023';
    end if;

    next_secret_id := current_config.vault_secret_id;
    if normalized_api_key is not null then
      if key_was_configured then
        perform vault.update_secret(
          secret_id => next_secret_id,
          new_secret => normalized_api_key,
          new_name => 'firecrawl_api_key_' || next_id::text,
          new_description => 'USTS ACM Land Firecrawl API key'
        );
      else
        select vault.create_secret(
          new_secret => normalized_api_key,
          new_name => 'firecrawl_api_key_' || next_id::text,
          new_description => 'USTS ACM Land Firecrawl API key'
        ) into next_secret_id;
      end if;
    end if;

    update private.firecrawl_api_keys as config
    set
      label = normalized_label,
      vault_secret_id = next_secret_id,
      enabled = requested_enabled,
      priority = requested_priority,
      health_status = case when normalized_api_key is null then config.health_status else 'unknown' end,
      consecutive_failures = case when normalized_api_key is null then config.consecutive_failures else 0 end,
      cooldown_until = case when normalized_api_key is null then config.cooldown_until else null end,
      last_checked_at = case when normalized_api_key is null then config.last_checked_at else null end,
      last_success_at = case when normalized_api_key is null then config.last_success_at else null end,
      last_failure_at = case when normalized_api_key is null then config.last_failure_at else null end,
      last_error_code = case when normalized_api_key is null then config.last_error_code else null end,
      credits_remaining = case when normalized_api_key is null then config.credits_remaining else null end,
      credits_total = case when normalized_api_key is null then config.credits_total else null end,
      billing_period_end = case when normalized_api_key is null then config.billing_period_end else null end,
      version = config.version + 1,
      updated_at = checked_at,
      updated_by = actor_id
    where config.id = target_key_id
    returning * into current_config;
  end if;

  key_is_configured := exists (
    select 1 from vault.secrets as secret where secret.id = current_config.vault_secret_id
  );

  insert into public.audit_logs (
    actor_id, action, target_table, target_id, before_data, after_data, metadata
  ) values (
    actor_id,
    case when target_key_id is null then 'firecrawl_api_key_create' else 'firecrawl_api_key_update' end,
    'firecrawl_api_keys',
    current_config.id::text,
    case when target_key_id is null then null else pg_catalog.jsonb_build_object(
      'label', previous_config.label,
      'keyConfigured', key_was_configured,
      'enabled', previous_config.enabled,
      'priority', previous_config.priority,
      'healthStatus', previous_config.health_status,
      'version', previous_config.version
    ) end,
    pg_catalog.jsonb_build_object(
      'label', current_config.label,
      'keyConfigured', key_is_configured,
      'enabled', current_config.enabled,
      'priority', current_config.priority,
      'healthStatus', current_config.health_status,
      'version', current_config.version
    ),
    pg_catalog.jsonb_build_object(
      'reason', normalized_reason,
      'changedFields', pg_catalog.to_jsonb(changed_fields)
    )
  );

  return query
  select
    current_config.id,
    current_config.label,
    key_is_configured,
    current_config.enabled,
    current_config.priority,
    current_config.health_status,
    current_config.consecutive_failures,
    current_config.cooldown_until,
    current_config.last_selected_at,
    current_config.last_checked_at,
    current_config.last_success_at,
    current_config.last_failure_at,
    current_config.last_error_code,
    current_config.credits_remaining,
    current_config.credits_total,
    current_config.billing_period_end,
    current_config.version,
    current_config.created_at,
    current_config.updated_at;
end;
$$;

create or replace function public.admin_delete_firecrawl_api_key(
  actor_id uuid,
  target_key_id uuid,
  expected_version bigint,
  reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_reason text := nullif(pg_catalog.btrim(reason), '');
  current_config private.firecrawl_api_keys%rowtype;
  key_was_configured boolean := false;
begin
  perform public.consume_admin_rate_limit(actor_id, 'firecrawl_keys.write', 15, 300);

  if not exists (
    select 1 from public.profiles as profile
    where profile.id = actor_id
      and profile.role = 'admin'
      and profile.review_status = 'approved'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if target_key_id is null then
    raise exception 'Firecrawl key ID is required.' using errcode = '22004';
  end if;
  if expected_version is null or expected_version < 0 then
    raise exception 'Expected Firecrawl key version is required.' using errcode = '22004';
  end if;
  if normalized_reason is null or pg_catalog.char_length(normalized_reason) not between 3 and 500 then
    raise exception 'Deletion reason must contain 3 to 500 characters.' using errcode = '22023';
  end if;

  perform 1
  from public.profiles as administrator
  where administrator.id = actor_id
    and administrator.role = 'admin'
    and administrator.review_status = 'approved'
  for key share;
  if not found then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select config.* into current_config
  from private.firecrawl_api_keys as config
  where config.id = target_key_id
  for update;
  if not found then
    raise exception 'Firecrawl key was not found.' using errcode = 'P0002';
  end if;
  if current_config.version is distinct from expected_version then
    raise exception 'Firecrawl key changed after it was loaded.' using errcode = '40001';
  end if;

  key_was_configured := exists (
    select 1 from vault.secrets as secret where secret.id = current_config.vault_secret_id
  );

  delete from private.firecrawl_api_keys as config where config.id = target_key_id;
  delete from vault.secrets as secret where secret.id = current_config.vault_secret_id;

  insert into public.audit_logs (
    actor_id, action, target_table, target_id, before_data, after_data, metadata
  ) values (
    actor_id,
    'firecrawl_api_key_delete',
    'firecrawl_api_keys',
    target_key_id::text,
    pg_catalog.jsonb_build_object(
      'label', current_config.label,
      'keyConfigured', key_was_configured,
      'enabled', current_config.enabled,
      'priority', current_config.priority,
      'healthStatus', current_config.health_status,
      'version', current_config.version
    ),
    null,
    pg_catalog.jsonb_build_object('reason', normalized_reason)
  );

  return target_key_id;
end;
$$;

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
  if normalized_purpose is null or normalized_purpose not in ('qoj', 'nowcoder') then
    raise exception 'Unsupported Firecrawl key purpose.' using errcode = '22023';
  end if;
  if normalized_purpose = 'qoj' and (
    normalized_operation_id is null
    or normalized_operation_id !~ '^[a-z0-9:_-]{1,200}$'
  ) then
    raise exception 'A valid Firecrawl operation ID is required for QOJ.' using errcode = '22023';
  end if;
  if normalized_purpose = 'nowcoder' and requested_operation_id is not null then
    raise exception 'Firecrawl operation IDs are reserved for QOJ.' using errcode = '22023';
  end if;

  if normalized_purpose = 'qoj' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(normalized_operation_id, 0)
    );
    if exists (
      select 1
      from private.firecrawl_key_assignments as assignment
      where assignment.operation_id = normalized_operation_id
    ) then
      raise exception 'This QOJ operation already claimed a Firecrawl key.' using errcode = '55000';
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
    if normalized_purpose = 'qoj' then
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

  if normalized_purpose = 'qoj' then
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

create or replace function public.list_firecrawl_runtime_keys()
returns table (
  pool_configured boolean,
  key_id uuid,
  api_key text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    true,
    config.id,
    secret.decrypted_secret
  from private.firecrawl_api_keys as config
  join vault.decrypted_secrets as secret on secret.id = config.vault_secret_id
  where config.enabled
  order by config.priority, config.id;

  if not found then
    return query
    select exists (select 1 from private.firecrawl_api_keys), null::uuid, null::text;
  end if;
end;
$$;

create or replace function public.read_firecrawl_runtime_key(target_key_id uuid)
returns table (key_id uuid, api_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select config.id, secret.decrypted_secret
  from private.firecrawl_api_keys as config
  join vault.decrypted_secrets as secret on secret.id = config.vault_secret_id
  where config.id = target_key_id;
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
    or normalized_purpose not in ('qoj', 'nowcoder', 'credit_monitor', 'admin_check') then
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
      when normalized_purpose in ('qoj', 'nowcoder') then
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

revoke all on function public.admin_list_firecrawl_api_keys(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.admin_upsert_firecrawl_api_key(
  uuid, uuid, text, text, boolean, integer, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_delete_firecrawl_api_key(uuid, uuid, bigint, text)
from public, anon, authenticated, service_role;
revoke all on function public.select_firecrawl_runtime_key(text, text)
from public, anon, authenticated, service_role;
revoke all on function public.list_firecrawl_runtime_keys()
from public, anon, authenticated, service_role;
revoke all on function public.read_firecrawl_runtime_key(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.record_firecrawl_key_observation(
  uuid, text, boolean, text, bigint, bigint, timestamptz, text
) from public, anon, authenticated, service_role;

grant execute on function public.admin_list_firecrawl_api_keys(uuid) to service_role;
grant execute on function public.admin_upsert_firecrawl_api_key(
  uuid, uuid, text, text, boolean, integer, bigint, text
) to service_role;
grant execute on function public.admin_delete_firecrawl_api_key(uuid, uuid, bigint, text)
to service_role;
grant execute on function public.select_firecrawl_runtime_key(text, text) to service_role;
grant execute on function public.list_firecrawl_runtime_keys() to service_role;
grant execute on function public.read_firecrawl_runtime_key(uuid) to service_role;
grant execute on function public.record_firecrawl_key_observation(
  uuid, text, boolean, text, bigint, bigint, timestamptz, text
) to service_role;

comment on table private.firecrawl_api_keys is
  'Private Firecrawl key-pool metadata with Vault secret references and sanitized health observations.';
comment on table private.firecrawl_key_assignments is
  'Private one-shot QOJ operation claims preventing a repeated operation from receiving a replacement Firecrawl key.';
comment on function public.select_firecrawl_runtime_key(text, text) is
  'Selects one eligible Firecrawl key by priority and least-recent use; QOJ requires a unique operation ID that can only be claimed once.';
comment on function public.list_firecrawl_runtime_keys() is
  'Returns enabled Firecrawl runtime keys to the service role for one-shot per-key credit monitoring.';
comment on function public.record_firecrawl_key_observation(
  uuid, text, boolean, text, bigint, bigint, timestamptz, text
) is 'Records sanitized per-key health and credit observations without storing credentials or member data.';

-- Extend the existing audit projection with an allowlisted Firecrawl summary.
-- The raw audit rows already contain only redacted metadata; this projection
-- additionally prevents future fields from reaching the browser by default.
create or replace function public.admin_list_audit_logs(
  row_limit integer default 50,
  before_log_id bigint default null
)
returns table (
  id bigint,
  actor_id uuid,
  actor_label text,
  action text,
  target_table text,
  target_id text,
  target_label text,
  details jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(row_limit, 50), 1), 100);
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select
    log.id,
    log.actor_id,
    coalesce(actor_profile.full_name, actor_user.email::text),
    log.action,
    log.target_table,
    log.target_id,
    coalesce(
      target_profile.full_name,
      log.after_data ->> 'title',
      log.before_data ->> 'title',
      log.after_data ->> 'label',
      log.before_data ->> 'label',
      log.target_id
    ),
    case log.target_table
      when 'profiles' then pg_catalog.jsonb_build_object(
        'before_role', log.before_data ->> 'role',
        'after_role', log.after_data ->> 'role',
        'before_review_status', log.before_data ->> 'review_status',
        'after_review_status', log.after_data ->> 'review_status',
        'profile_fields', to_jsonb(array_remove(array[
          case when log.before_data ->> 'full_name' is distinct from log.after_data ->> 'full_name' then 'full_name' end,
          case when log.before_data ->> 'qq' is distinct from log.after_data ->> 'qq' then 'qq' end,
          case when log.before_data ->> 'major' is distinct from log.after_data ->> 'major' then 'major' end,
          case when log.before_data ->> 'grade' is distinct from log.after_data ->> 'grade' then 'grade' end,
          case when log.before_data ->> 'is_public' is distinct from log.after_data ->> 'is_public' then 'is_public' end
        ]::text[], null))
      )
      when 'platform_accounts' then pg_catalog.jsonb_build_object(
        'platform', coalesce(log.after_data ->> 'platform', log.before_data ->> 'platform'),
        'before_status', log.before_data ->> 'status',
        'after_status', log.after_data ->> 'status',
        'external_id_changed',
          log.action = 'update'
          and log.before_data ->> 'external_id' is distinct from log.after_data ->> 'external_id'
      )
      when 'sync_jobs' then pg_catalog.jsonb_build_object(
        'scope', log.metadata ->> 'scope',
        'platform', log.metadata ->> 'platform',
        'trigger_type', log.metadata ->> 'trigger_type',
        'platform_count', case
          when pg_catalog.jsonb_typeof(log.metadata -> 'platforms') = 'array'
            then pg_catalog.jsonb_array_length(log.metadata -> 'platforms')
          else null
        end
      )
      when 'firecrawl_api_keys' then pg_catalog.jsonb_build_object(
        'before_enabled', log.before_data -> 'enabled',
        'after_enabled', log.after_data -> 'enabled',
        'before_priority', log.before_data -> 'priority',
        'after_priority', log.after_data -> 'priority',
        'before_health_status', log.before_data ->> 'healthStatus',
        'after_health_status', log.after_data ->> 'healthStatus',
        'key_configured', coalesce(
          log.after_data -> 'keyConfigured',
          log.before_data -> 'keyConfigured'
        ),
        'changed_fields', log.metadata -> 'changedFields',
        'reason', log.metadata ->> 'reason'
      )
      else '{}'::jsonb
    end,
    log.created_at
  from public.audit_logs as log
  left join auth.users as actor_user on actor_user.id = log.actor_id
  left join public.profiles as actor_profile on actor_profile.id = log.actor_id
  left join public.profiles as target_profile
    on target_profile.id::text = coalesce(
      case when log.target_table = 'profiles' then log.target_id end,
      log.after_data ->> 'profile_id',
      log.before_data ->> 'profile_id',
      log.metadata ->> 'profile_id'
    )
  where before_log_id is null or log.id < before_log_id
  order by log.id desc
  limit safe_limit;
end;
$$;
