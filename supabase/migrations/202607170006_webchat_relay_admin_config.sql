-- Administrators may rotate the WebChat relay without receiving the API key
-- back from the server. Public metadata lives in a locked private singleton;
-- the secret itself remains in Supabase Vault and is available only through a
-- service-role runtime RPC.

create table private.webchat_relay_config (
  singleton boolean primary key default true check (singleton),
  base_url text,
  model text,
  api_key_secret_id uuid,
  requests_enabled boolean not null default false,
  global_daily_request_limit integer not null default 300,
  global_daily_token_limit bigint not null default 1000000,
  version bigint not null default 0,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid,
  constraint webchat_relay_config_pair check (
    (base_url is null and model is null)
    or (base_url is not null and model is not null)
  ),
  constraint webchat_relay_config_base_url check (
    base_url is null
    or (
      pg_catalog.char_length(base_url) between 10 and 2048
      and base_url ~ '^https://[^[:space:]?#@/]+(?::[0-9]{1,5})?(?:/[^[:space:]?#]*)?$'
      and base_url !~ '/responses/?$'
    )
  ),
  constraint webchat_relay_config_model check (
    model is null or model ~ '^[A-Za-z0-9._:/-]{1,128}$'
  ),
  constraint webchat_relay_config_global_request_limit check (
    global_daily_request_limit between 1 and 1000000
  ),
  constraint webchat_relay_config_global_token_limit check (
    global_daily_token_limit between 100 and 1000000000
  ),
  constraint webchat_relay_config_version_nonnegative check (version >= 0)
);

insert into private.webchat_relay_config (singleton)
values (true)
on conflict (singleton) do nothing;

alter table private.webchat_relay_config enable row level security;
revoke all on table private.webchat_relay_config
from public, anon, authenticated, service_role;

-- Browser roles cannot reach Vault. Supabase's service role remains a
-- platform-privileged backend credential, so application code exposes only the
-- bounded SECURITY DEFINER functions below and never returns the key to a browser.
revoke all on table vault.secrets
from public, anon, authenticated, service_role;
revoke all on table vault.decrypted_secrets
from public, anon, authenticated, service_role;
revoke all on function vault.create_secret(text, text, text, uuid)
from public, anon, authenticated, service_role;
revoke all on function vault.update_secret(uuid, text, text, text, uuid)
from public, anon, authenticated, service_role;

create or replace function public.read_webchat_relay_config()
returns table (
  base_url text,
  model text,
  api_key_configured boolean,
  requests_enabled boolean,
  global_daily_request_limit integer,
  global_daily_token_limit bigint,
  version bigint,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    config.base_url,
    config.model,
    config.api_key_secret_id is not null
      and exists (
        select 1
        from vault.secrets as secret
        where secret.id = config.api_key_secret_id
      ) as api_key_configured,
    config.requests_enabled,
    config.global_daily_request_limit,
    config.global_daily_token_limit,
    config.version,
    config.updated_at
  from private.webchat_relay_config as config
  where config.singleton;
$$;

create or replace function public.read_webchat_relay_runtime_config()
returns table (
  base_url text,
  api_key text,
  model text,
  requests_enabled boolean,
  global_daily_request_limit integer,
  global_daily_token_limit bigint,
  version bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    config.base_url,
    secret.decrypted_secret as api_key,
    config.model,
    config.requests_enabled,
    config.global_daily_request_limit,
    config.global_daily_token_limit,
    config.version
  from private.webchat_relay_config as config
  left join vault.decrypted_secrets as secret
    on secret.id = config.api_key_secret_id
  where config.singleton;
$$;

create or replace function public.admin_update_webchat_relay_config(
  actor_id uuid,
  requested_base_url text,
  requested_model text,
  replacement_api_key text,
  expected_version bigint,
  reason text,
  requested_requests_enabled boolean default false,
  requested_global_daily_request_limit integer default 300,
  requested_global_daily_token_limit bigint default 1000000
)
returns table (
  base_url text,
  model text,
  api_key_configured boolean,
  requests_enabled boolean,
  global_daily_request_limit integer,
  global_daily_token_limit bigint,
  version bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_base_url text := nullif(pg_catalog.btrim(requested_base_url), '');
  normalized_model text := nullif(pg_catalog.btrim(requested_model), '');
  normalized_api_key text := nullif(pg_catalog.btrim(replacement_api_key), '');
  normalized_reason text := nullif(pg_catalog.btrim(reason), '');
  current_config private.webchat_relay_config%rowtype;
  previous_config private.webchat_relay_config%rowtype;
  next_secret_id uuid;
  checked_at timestamptz := pg_catalog.clock_timestamp();
  changed_fields text[] := array[]::text[];
  key_was_configured boolean;
  key_is_configured boolean;
begin
  perform public.consume_admin_rate_limit(actor_id, 'webchat_config.write', 10, 300);

  if normalized_base_url is null
    or normalized_base_url !~ '^https://[^[:space:]?#@/]+(?::[0-9]{1,5})?(?:/[^[:space:]?#]*)?$'
    or normalized_base_url ~ '/responses/?$'
    or pg_catalog.char_length(normalized_base_url) not between 10 and 2048 then
    raise exception 'Relay base URL must be a credential-free HTTPS API root without query, fragment, or /responses suffix.'
      using errcode = '22023';
  end if;
  if normalized_model is null
    or normalized_model !~ '^[A-Za-z0-9._:/-]{1,128}$' then
    raise exception 'Relay model has an invalid format.' using errcode = '22023';
  end if;
  if requested_requests_enabled is null then
    raise exception 'WebChat request switch is required.' using errcode = '22004';
  end if;
  if requested_global_daily_request_limit is null
    or requested_global_daily_request_limit not between 1 and 1000000 then
    raise exception 'Global daily request limit must be between 1 and 1000000.'
      using errcode = '22023';
  end if;
  if requested_global_daily_token_limit is null
    or requested_global_daily_token_limit not between 100 and 1000000000 then
    raise exception 'Global daily token limit must be between 100 and 1000000000.'
      using errcode = '22023';
  end if;
  if replacement_api_key is not null and normalized_api_key is null then
    raise exception 'Replacement API key cannot be empty.' using errcode = '22023';
  end if;
  if normalized_api_key is not null and (
    pg_catalog.char_length(normalized_api_key) not between 16 and 4096
    or normalized_api_key ~ '[[:space:]]'
  ) then
    raise exception 'Replacement API key has an invalid format.' using errcode = '22023';
  end if;
  if expected_version is null or expected_version < 0 then
    raise exception 'Expected configuration version is required.' using errcode = '22004';
  end if;
  if normalized_reason is null or pg_catalog.char_length(normalized_reason) < 3 then
    raise exception 'Configuration change reason must contain at least 3 characters.'
      using errcode = '22023';
  end if;
  if pg_catalog.char_length(normalized_reason) > 500 then
    raise exception 'Configuration change reason exceeds 500 characters.'
      using errcode = '22001';
  end if;
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = actor_id
      and profile.role = 'admin'
      and profile.review_status = 'approved'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select config.* into current_config
  from private.webchat_relay_config as config
  where config.singleton
  for update;

  if not found then
    raise exception 'WebChat relay configuration singleton is missing.' using errcode = '55000';
  end if;
  if current_config.version is distinct from expected_version then
    raise exception 'WebChat relay configuration changed after it was loaded.'
      using errcode = '40001';
  end if;

  previous_config := current_config;

  key_was_configured := current_config.api_key_secret_id is not null
    and exists (
      select 1
      from vault.secrets as secret
      where secret.id = current_config.api_key_secret_id
    );

  if not key_was_configured and normalized_api_key is null then
    raise exception 'A replacement API key is required until the relay secret is configured.'
      using errcode = '22023';
  end if;

  if current_config.base_url is distinct from normalized_base_url then
    changed_fields := pg_catalog.array_append(changed_fields, 'baseUrl');
  end if;
  if current_config.model is distinct from normalized_model then
    changed_fields := pg_catalog.array_append(changed_fields, 'model');
  end if;
  if current_config.requests_enabled is distinct from requested_requests_enabled then
    changed_fields := pg_catalog.array_append(changed_fields, 'requestsEnabled');
  end if;
  if current_config.global_daily_request_limit
    is distinct from requested_global_daily_request_limit then
    changed_fields := pg_catalog.array_append(changed_fields, 'globalDailyRequestLimit');
  end if;
  if current_config.global_daily_token_limit
    is distinct from requested_global_daily_token_limit then
    changed_fields := pg_catalog.array_append(changed_fields, 'globalDailyTokenLimit');
  end if;
  if normalized_api_key is not null then
    changed_fields := pg_catalog.array_append(changed_fields, 'apiKey');
  end if;
  if pg_catalog.cardinality(changed_fields) = 0 then
    raise exception 'At least one relay configuration field must change.' using errcode = '22023';
  end if;

  next_secret_id := current_config.api_key_secret_id;
  if normalized_api_key is not null then
    if next_secret_id is null
      or not exists (select 1 from vault.secrets as secret where secret.id = next_secret_id) then
      select secret.id into next_secret_id
      from vault.secrets as secret
      where secret.name = 'webchat_relay_api_key'
      order by secret.created_at desc
      limit 1;
    end if;

    if next_secret_id is null then
      select vault.create_secret(
        new_secret => normalized_api_key,
        new_name => 'webchat_relay_api_key',
        new_description => 'USTS ACM Land WebChat relay API key'
      ) into next_secret_id;
    else
      perform vault.update_secret(
        secret_id => next_secret_id,
        new_secret => normalized_api_key,
        new_name => 'webchat_relay_api_key',
        new_description => 'USTS ACM Land WebChat relay API key'
      );
    end if;
  end if;

  key_is_configured := next_secret_id is not null
    and exists (
      select 1
      from vault.secrets as secret
      where secret.id = next_secret_id
    );

  update private.webchat_relay_config as config
  set
    base_url = normalized_base_url,
    model = normalized_model,
    api_key_secret_id = next_secret_id,
    requests_enabled = requested_requests_enabled,
    global_daily_request_limit = requested_global_daily_request_limit,
    global_daily_token_limit = requested_global_daily_token_limit,
    version = config.version + 1,
    updated_at = checked_at,
    updated_by = actor_id
  where config.singleton
  returning config.* into current_config;

  insert into public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    before_data,
    after_data,
    metadata
  ) values (
    actor_id,
    'webchat_relay_config_update',
    'webchat_relay_config',
    'singleton',
    pg_catalog.jsonb_build_object(
      'baseUrl', previous_config.base_url,
      'model', previous_config.model,
      'apiKeyConfigured', key_was_configured,
      'requestsEnabled', previous_config.requests_enabled,
      'globalDailyRequestLimit', previous_config.global_daily_request_limit,
      'globalDailyTokenLimit', previous_config.global_daily_token_limit
    ),
    pg_catalog.jsonb_build_object(
      'baseUrl', normalized_base_url,
      'model', normalized_model,
      'apiKeyConfigured', key_is_configured,
      'requestsEnabled', requested_requests_enabled,
      'globalDailyRequestLimit', requested_global_daily_request_limit,
      'globalDailyTokenLimit', requested_global_daily_token_limit
    ),
    pg_catalog.jsonb_build_object(
      'reason', normalized_reason,
      'changedFields', pg_catalog.to_jsonb(changed_fields)
    )
  );

  return query
  select
    current_config.base_url,
    current_config.model,
    key_is_configured,
    current_config.requests_enabled,
    current_config.global_daily_request_limit,
    current_config.global_daily_token_limit,
    current_config.version,
    current_config.updated_at;
end;
$$;

revoke all on function public.read_webchat_relay_config()
from public, anon, authenticated, service_role;
revoke all on function public.read_webchat_relay_runtime_config()
from public, anon, authenticated, service_role;
revoke all on function public.admin_update_webchat_relay_config(
  uuid, text, text, text, bigint, text, boolean, integer, bigint
) from public, anon, authenticated, service_role;

grant execute on function public.read_webchat_relay_config() to service_role;
grant execute on function public.read_webchat_relay_runtime_config() to service_role;
grant execute on function public.admin_update_webchat_relay_config(
  uuid, text, text, text, bigint, text, boolean, integer, bigint
) to service_role;

comment on table private.webchat_relay_config is
  'Private singleton containing non-secret WebChat relay metadata and a Vault secret reference.';
comment on function public.read_webchat_relay_config() is
  'Returns redacted WebChat relay metadata to the service role; never returns the API key.';
comment on function public.read_webchat_relay_runtime_config() is
  'Returns the complete WebChat relay runtime configuration only to the service role.';
comment on function public.admin_update_webchat_relay_config(
  uuid, text, text, text, bigint, text, boolean, integer, bigint
) is 'Updates WebChat relay metadata and rotates its Vault key with administrator validation, rate limiting, optimistic locking, and redacted audit.';
