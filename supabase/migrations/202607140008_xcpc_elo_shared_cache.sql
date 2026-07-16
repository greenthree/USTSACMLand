-- Cross-isolate XCPC ELO cache with a database refresh lease.

create table public.xcpc_elo_cache_state (
  cache_key boolean primary key default true,
  active_version bigint not null default 0,
  etag text,
  last_modified text,
  source_generated_at timestamptz,
  validated_at timestamptz,
  expires_at timestamptz,
  refresh_owner uuid,
  refresh_lease_expires_at timestamptz,
  refresh_retry_after timestamptz,
  last_error_code public.sync_error_code,
  last_error_message text,
  updated_at timestamptz not null default now(),
  constraint xcpc_elo_cache_state_singleton check (cache_key),
  constraint xcpc_elo_cache_state_version_nonnegative check (active_version >= 0),
  constraint xcpc_elo_cache_state_active_metadata check (
    (active_version = 0 and source_generated_at is null and validated_at is null and expires_at is null)
    or
    (active_version > 0 and source_generated_at is not null and validated_at is not null and expires_at is not null)
  ),
  constraint xcpc_elo_cache_state_lease_pair check (
    (refresh_owner is null) = (refresh_lease_expires_at is null)
  ),
  constraint xcpc_elo_cache_state_error_length check (
    last_error_message is null or char_length(last_error_message) <= 4000
  )
);

create table public.xcpc_elo_cache_players (
  version bigint not null,
  player_id text not null,
  normalized_name text not null,
  display_name text not null,
  organization text not null,
  rating integer not null,
  max_rating integer,
  contests integer,
  primary key (version, player_id),
  constraint xcpc_elo_cache_players_version_positive check (version > 0),
  constraint xcpc_elo_cache_players_id_format check (
    player_id ~ '^xcpc_[A-Fa-f0-9]{16}$'
  ),
  constraint xcpc_elo_cache_players_name_length check (
    char_length(normalized_name) between 1 and 200
    and char_length(display_name) between 1 and 200
  ),
  constraint xcpc_elo_cache_players_organization_length check (
    char_length(organization) between 1 and 200
  ),
  constraint xcpc_elo_cache_players_contests_nonnegative check (
    contests is null or contests >= 0
  )
);

create index xcpc_elo_cache_players_version_name_idx
  on public.xcpc_elo_cache_players (version, normalized_name);

insert into public.xcpc_elo_cache_state (cache_key) values (true)
on conflict (cache_key) do nothing;

alter table public.xcpc_elo_cache_state enable row level security;
alter table public.xcpc_elo_cache_players enable row level security;

revoke all on public.xcpc_elo_cache_state from public, anon, authenticated, service_role;
revoke all on public.xcpc_elo_cache_players from public, anon, authenticated, service_role;

create or replace function public.read_xcpc_elo_cache()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'activeVersion', state.active_version,
    'etag', state.etag,
    'lastModified', state.last_modified,
    'sourceGeneratedAt', state.source_generated_at,
    'validatedAt', state.validated_at,
    'expiresAt', state.expires_at,
    'refreshLeaseExpiresAt', state.refresh_lease_expires_at,
    'refreshRetryAfter', state.refresh_retry_after,
    'lastErrorCode', state.last_error_code,
    'lastErrorMessage', state.last_error_message,
    'players', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', player.player_id,
            'teamMember', player.display_name,
            'organization', player.organization,
            'rating', player.rating,
            'maxRating', player.max_rating,
            'contests', player.contests
          )
          order by player.normalized_name, player.player_id
        )
        from public.xcpc_elo_cache_players as player
        where player.version = state.active_version
      ),
      '[]'::jsonb
    )
  )
  from public.xcpc_elo_cache_state as state
  where state.cache_key;
$$;

create or replace function public.acquire_xcpc_elo_cache_refresh(
  requested_owner uuid,
  cache_ttl_seconds integer,
  lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  state public.xcpc_elo_cache_state%rowtype;
  acquired boolean := false;
  reason text;
begin
  if requested_owner is null then
    raise exception 'Refresh owner is required.' using errcode = '22004';
  end if;
  if cache_ttl_seconds not between 60 and 86400 then
    raise exception 'Cache TTL must be between 60 and 86400 seconds.' using errcode = '22023';
  end if;
  if lease_seconds not between 30 and 600 then
    raise exception 'Refresh lease must be between 30 and 600 seconds.' using errcode = '22023';
  end if;

  select * into state
  from public.xcpc_elo_cache_state
  where cache_key
  for update;

  if state.expires_at is not null and state.expires_at > pg_catalog.clock_timestamp() then
    reason := 'fresh';
  elsif state.refresh_retry_after is not null
    and state.refresh_retry_after > pg_catalog.clock_timestamp() then
    reason := 'cooldown';
  elsif state.refresh_owner is not null
    and state.refresh_lease_expires_at > pg_catalog.clock_timestamp()
    and state.refresh_owner <> requested_owner then
    reason := 'leased';
  else
    update public.xcpc_elo_cache_state
    set
      refresh_owner = requested_owner,
      refresh_lease_expires_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => lease_seconds),
      updated_at = pg_catalog.clock_timestamp()
    where cache_key
    returning * into state;
    acquired := true;
    reason := 'acquired';
  end if;

  return pg_catalog.jsonb_build_object(
    'acquired', acquired,
    'reason', reason,
    'activeVersion', state.active_version,
    'etag', state.etag,
    'lastModified', state.last_modified,
    'expiresAt', state.expires_at,
    'refreshLeaseExpiresAt', state.refresh_lease_expires_at,
    'refreshRetryAfter', state.refresh_retry_after,
    'lastErrorCode', state.last_error_code,
    'lastErrorMessage', state.last_error_message
  );
end;
$$;

create or replace function public.commit_xcpc_elo_cache_refresh(
  requested_owner uuid,
  cache_ttl_seconds integer,
  response_etag text,
  response_last_modified text,
  response_source_generated_at timestamptz,
  response_players jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  state public.xcpc_elo_cache_state%rowtype;
  next_version bigint;
  inserted_count integer;
begin
  if requested_owner is null or response_source_generated_at is null then
    raise exception 'Refresh owner and source generation time are required.' using errcode = '22004';
  end if;
  if cache_ttl_seconds not between 60 and 86400 then
    raise exception 'Cache TTL must be between 60 and 86400 seconds.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(response_players) <> 'array'
    or pg_catalog.jsonb_array_length(response_players) = 0
    or pg_catalog.jsonb_array_length(response_players) > 10000 then
    raise exception 'Cached player payload must contain between 1 and 10000 players.'
      using errcode = '22023';
  end if;

  select * into state
  from public.xcpc_elo_cache_state
  where cache_key
  for update;

  if state.refresh_owner is distinct from requested_owner
    or state.refresh_lease_expires_at is null
    or state.refresh_lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'XCPC ELO refresh lease is no longer owned by this worker.'
      using errcode = '40001';
  end if;

  next_version := state.active_version + 1;

  insert into public.xcpc_elo_cache_players (
    version,
    player_id,
    normalized_name,
    display_name,
    organization,
    rating,
    max_rating,
    contests
  )
  select
    next_version,
    record.player_id,
    record.normalized_name,
    record.display_name,
    record.organization,
    record.rating,
    record.max_rating,
    record.contests
  from pg_catalog.jsonb_to_recordset(response_players) as record(
    player_id text,
    normalized_name text,
    display_name text,
    organization text,
    rating integer,
    max_rating integer,
    contests integer
  );

  get diagnostics inserted_count = row_count;
  if inserted_count <> pg_catalog.jsonb_array_length(response_players) then
    raise exception 'Cached player payload could not be stored completely.' using errcode = '22023';
  end if;

  update public.xcpc_elo_cache_state
  set
    active_version = next_version,
    etag = nullif(response_etag, ''),
    last_modified = nullif(response_last_modified, ''),
    source_generated_at = response_source_generated_at,
    validated_at = pg_catalog.clock_timestamp(),
    expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => cache_ttl_seconds),
    refresh_owner = null,
    refresh_lease_expires_at = null,
    refresh_retry_after = null,
    last_error_code = null,
    last_error_message = null,
    updated_at = pg_catalog.clock_timestamp()
  where cache_key;

  delete from public.xcpc_elo_cache_players where version <> next_version;
  return next_version;
end;
$$;

create or replace function public.validate_xcpc_elo_cache_refresh(
  requested_owner uuid,
  cache_ttl_seconds integer,
  response_etag text,
  response_last_modified text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  state public.xcpc_elo_cache_state%rowtype;
begin
  if requested_owner is null then
    raise exception 'Refresh owner is required.' using errcode = '22004';
  end if;
  if cache_ttl_seconds not between 60 and 86400 then
    raise exception 'Cache TTL must be between 60 and 86400 seconds.' using errcode = '22023';
  end if;

  select * into state
  from public.xcpc_elo_cache_state
  where cache_key
  for update;

  if state.active_version = 0 then
    raise exception 'A 304 response cannot validate an empty cache.' using errcode = '22023';
  end if;
  if state.refresh_owner is distinct from requested_owner
    or state.refresh_lease_expires_at is null
    or state.refresh_lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'XCPC ELO refresh lease is no longer owned by this worker.'
      using errcode = '40001';
  end if;

  update public.xcpc_elo_cache_state
  set
    etag = coalesce(nullif(response_etag, ''), etag),
    last_modified = coalesce(nullif(response_last_modified, ''), last_modified),
    validated_at = pg_catalog.clock_timestamp(),
    expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => cache_ttl_seconds),
    refresh_owner = null,
    refresh_lease_expires_at = null,
    refresh_retry_after = null,
    last_error_code = null,
    last_error_message = null,
    updated_at = pg_catalog.clock_timestamp()
  where cache_key;

  return state.active_version;
end;
$$;

create or replace function public.fail_xcpc_elo_cache_refresh(
  requested_owner uuid,
  failure_code public.sync_error_code,
  failure_message text,
  retry_after_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if requested_owner is null or failure_code is null then
    raise exception 'Refresh owner and failure code are required.' using errcode = '22004';
  end if;
  if retry_after_seconds not between 30 and 3600 then
    raise exception 'Retry cooldown must be between 30 and 3600 seconds.' using errcode = '22023';
  end if;

  update public.xcpc_elo_cache_state
  set
    refresh_owner = null,
    refresh_lease_expires_at = null,
    refresh_retry_after = pg_catalog.clock_timestamp()
      + pg_catalog.make_interval(secs => retry_after_seconds),
    last_error_code = failure_code,
    last_error_message = left(coalesce(failure_message, 'Unknown XCPC ELO refresh failure'), 4000),
    updated_at = pg_catalog.clock_timestamp()
  where cache_key
    and refresh_owner = requested_owner;

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.read_xcpc_elo_cache() from public, anon, authenticated;
revoke all on function public.acquire_xcpc_elo_cache_refresh(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.commit_xcpc_elo_cache_refresh(
  uuid, integer, text, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.validate_xcpc_elo_cache_refresh(uuid, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_xcpc_elo_cache_refresh(
  uuid, public.sync_error_code, text, integer
) from public, anon, authenticated;

grant execute on function public.read_xcpc_elo_cache() to service_role;
grant execute on function public.acquire_xcpc_elo_cache_refresh(uuid, integer, integer)
  to service_role;
grant execute on function public.commit_xcpc_elo_cache_refresh(
  uuid, integer, text, text, timestamptz, jsonb
) to service_role;
grant execute on function public.validate_xcpc_elo_cache_refresh(uuid, integer, text, text)
  to service_role;
grant execute on function public.fail_xcpc_elo_cache_refresh(
  uuid, public.sync_error_code, text, integer
) to service_role;

comment on table public.xcpc_elo_cache_state is
  'Service-role-only XCPC ELO cache metadata and distributed refresh lease.';
comment on table public.xcpc_elo_cache_players is
  'Versioned XCPC ELO players for Suzhou University of Science and Technology only.';
