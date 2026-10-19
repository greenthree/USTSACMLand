-- Luogu selects the least recently used eligible Key for each scrape request.
-- QOJ keeps one claim per attempt; Nowcoder keeps its existing priority order.
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
  order by
    case when normalized_purpose = 'luogu' then config.last_selected_at end nulls first,
    config.priority, config.last_selected_at nulls first, config.id
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

comment on table private.firecrawl_key_assignments is
  'Private one-shot claims: QOJ per attempt, Luogu per scrape request. Failures never select a replacement.';
comment on function public.select_firecrawl_runtime_key(text, text) is
  'Service-only selection: Luogu rotates eligible Keys by last use; QOJ/Nowcoder retain priority order. Each operation ID is claimed once.';
