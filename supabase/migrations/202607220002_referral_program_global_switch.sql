-- Globally pause or resume referral bindings without blocking registration.
-- The singleton is private; browser clients use narrow SECURITY DEFINER RPCs.

create table private.referral_program_config (
  singleton boolean primary key default true,
  enabled boolean not null default true,
  version bigint not null default 0,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid references public.profiles (id) on delete set null,
  change_reason text not null default 'Referral program enabled by default.',
  constraint referral_program_config_singleton check (singleton),
  constraint referral_program_config_version_nonnegative check (version >= 0),
  constraint referral_program_config_reason_length check (
    pg_catalog.char_length(change_reason) between 3 and 500
      and change_reason ~ '[^[:space:]]'
  )
);

insert into private.referral_program_config (singleton, enabled)
values (true, true)
on conflict (singleton) do nothing;

alter table private.referral_program_config enable row level security;

revoke all on table private.referral_program_config
from public, anon, authenticated, service_role;

create or replace function public.check_referral_code(requested_code text default null)
returns table (
  program_enabled boolean,
  available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with global_state as (
    select coalesce((
      select config.enabled
      from private.referral_program_config as config
      where config.singleton
    ), false) as enabled
  )
  select
    state.enabled as program_enabled,
    state.enabled
      and coalesce(
        pg_catalog.upper(pg_catalog.btrim(requested_code)) ~ '^[A-F0-9]{16}$',
        false
      )
      and exists (
        select 1
        from private.referral_codes as referral
        join public.profiles as inviter on inviter.id = referral.inviter_id
        left join private.webchat_member_access as inviter_access
          on inviter_access.user_id = referral.inviter_id
        where referral.code = pg_catalog.upper(pg_catalog.btrim(requested_code))
          and referral.active
          and referral.reward_count < 10
          and inviter.review_status = 'approved'
          and (
            inviter_access.user_id is null
            or inviter_access.total_token_limit <= 999000000
          )
      ) as available
  from global_state as state;
$$;

create or replace function public.validate_referral_code(requested_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select check_result.available
  from public.check_referral_code(requested_code) as check_result;
$$;

create or replace function private.process_profile_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_code text;
  observed_program_enabled boolean;
  selected_inviter_id uuid;
  selected_code private.referral_codes%rowtype;
  inviter_access private.webchat_member_access%rowtype;
  created_binding_id uuid;
begin
  insert into private.referral_codes (inviter_id, code)
  values (new.id, private.generate_referral_code())
  on conflict (inviter_id) do nothing;

  select pg_catalog.upper(pg_catalog.btrim(user_record.raw_user_meta_data ->> 'referral_code'))
  into requested_code
  from auth.users as user_record
  where user_record.id = new.id;

  if requested_code is null or requested_code = '' then
    return new;
  end if;

  -- A disabled snapshot can return immediately: a concurrent enable may make
  -- later registrations eligible, but this registration began while paused.
  select config.enabled into observed_program_enabled
  from private.referral_program_config as config
  where config.singleton;
  if not found then
    return new;
  end if;

  -- Disabled referrals are ignored before validating metadata. Registration
  -- remains available even when a stale client submits malformed metadata.
  if not observed_program_enabled then
    return new;
  end if;

  if requested_code !~ '^[A-F0-9]{16}$' then
    raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
  end if;

  -- Resolve without a row lock, then acquire every mutable row in the shared
  -- profile -> config -> code -> access order used by deletion and updates.
  select referral.inviter_id into selected_inviter_id
  from private.referral_codes as referral
  where referral.code = requested_code;

  if not found or selected_inviter_id = new.id then
    raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
  end if;

  perform 1
  from public.profiles as inviter
  where inviter.id = selected_inviter_id
    and inviter.review_status = 'approved'
  for share;
  if not found then
    raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
  end if;

  -- This shared lock conflicts with the administrator's UPDATE lock. Once a
  -- disable call returns, no in-flight registration can still award a referral.
  select config.enabled into observed_program_enabled
  from private.referral_program_config as config
  where config.singleton
  for share;
  if not found then
    return new;
  end if;
  if not observed_program_enabled then
    return new;
  end if;

  select referral.* into selected_code
  from private.referral_codes as referral
  where referral.code = requested_code
  for update;

  if not found
    or selected_code.inviter_id is distinct from selected_inviter_id
    or not selected_code.active
    or selected_code.reward_count >= 10 then
    raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
  end if;

  insert into private.webchat_member_access (
    user_id,
    access_enabled,
    pilot_observation_enabled,
    total_request_limit,
    total_token_limit
  ) values (
    selected_code.inviter_id,
    true,
    false,
    10000,
    5000000
  )
  on conflict (user_id) do nothing;

  select access.* into inviter_access
  from private.webchat_member_access as access
  where access.user_id = selected_code.inviter_id
  for update;

  if inviter_access.total_token_limit > 999000000 then
    raise exception 'Referral reward would exceed the member quota ceiling.'
      using errcode = '22023';
  end if;

  insert into private.referral_bindings (invitee_id, inviter_id)
  values (new.id, selected_code.inviter_id)
  returning id into created_binding_id;

  update private.referral_codes as referral
  set
    reward_count = referral.reward_count + 1,
    updated_at = pg_catalog.clock_timestamp()
  where referral.inviter_id = selected_code.inviter_id;

  update private.webchat_member_access as access
  set
    total_token_limit = access.total_token_limit + 1000000,
    version = access.version + 1,
    updated_at = pg_catalog.clock_timestamp(),
    updated_by = null
  where access.user_id = selected_code.inviter_id;

  insert into public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    after_data,
    metadata
  ) values (
    new.id,
    'referral_reward_granted',
    'referral_bindings',
    selected_code.inviter_id::text,
    pg_catalog.jsonb_build_object(
      'reward_tokens', 1000000,
      'reward_count', selected_code.reward_count + 1,
      'max_rewards', 10
    ),
    pg_catalog.jsonb_build_object(
      'profile_id', selected_code.inviter_id,
      'binding_id', created_binding_id
    )
  );

  return new;
end;
$$;

drop function public.read_own_referral_summary();

create function public.read_own_referral_summary()
returns table (
  program_enabled boolean,
  code text,
  reward_count integer,
  remaining_rewards integer,
  reward_tokens bigint,
  available boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'Authenticated member access required.' using errcode = '42501';
  end if;

  return query
  select
    config.enabled,
    case when config.enabled then referral.code else null end,
    coalesce(referral.reward_count, 0)::integer,
    (10 - coalesce(referral.reward_count, 0))::integer,
    coalesce(referral.reward_count, 0)::bigint * 1000000,
    config.enabled
      and coalesce(referral.active, false)
      and coalesce(referral.reward_count, 0) < 10
      and profile.review_status = 'approved'
      and (
        member_access.user_id is null
        or member_access.total_token_limit <= 999000000
      )
  from private.referral_program_config as config
  left join private.referral_codes as referral on referral.inviter_id = actor_id
  left join public.profiles as profile on profile.id = actor_id
  left join private.webchat_member_access as member_access on member_access.user_id = actor_id
  where config.singleton;
end;
$$;

create or replace function public.export_own_referral_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  program_enabled boolean;
begin
  if actor_id is null then
    raise exception 'Authenticated member access required.' using errcode = '42501';
  end if;

  select config.enabled into program_enabled
  from private.referral_program_config as config
  where config.singleton;

  return pg_catalog.jsonb_build_object(
    'programEnabled', program_enabled,
    'code', case when program_enabled then (
      select referral.code
      from private.referral_codes as referral
      where referral.inviter_id = actor_id
    ) else null end,
    'rewardCount', coalesce((
      select referral.reward_count
      from private.referral_codes as referral
      where referral.inviter_id = actor_id
    ), 0),
    'rewardTokens', coalesce((
      select referral.reward_count::bigint * 1000000
      from private.referral_codes as referral
      where referral.inviter_id = actor_id
    ), 0),
    'invitedByAnotherMember', exists (
      select 1
      from private.referral_bindings as binding
      where binding.invitee_id = actor_id
    ),
    'boundAt', (
      select binding.created_at
      from private.referral_bindings as binding
      where binding.invitee_id = actor_id
    )
  );
end;
$$;

create function public.admin_read_referral_program_config()
returns table (
  enabled boolean,
  version bigint,
  updated_at timestamptz,
  updated_by_label text,
  reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select
    config.enabled,
    config.version,
    config.updated_at,
    coalesce(
      administrator.full_name,
      user_account.email::text,
      case when config.updated_by is null then 'System' else 'Former administrator' end
    ),
    config.change_reason
  from private.referral_program_config as config
  left join public.profiles as administrator on administrator.id = config.updated_by
  left join auth.users as user_account on user_account.id = config.updated_by
  where config.singleton;
end;
$$;

create function public.admin_update_referral_program_config(
  requested_enabled boolean,
  expected_version bigint,
  requested_reason text
)
returns table (
  enabled boolean,
  version bigint,
  updated_at timestamptz,
  updated_by_label text,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text := nullif(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(requested_reason, '[[:space:]]+', ' ', 'g')
    ),
    ''
  );
  current_config private.referral_program_config%rowtype;
  previous_config private.referral_program_config%rowtype;
  checked_at timestamptz := pg_catalog.clock_timestamp();
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  perform public.consume_admin_rate_limit(
    actor_id,
    'referral_program.write',
    10,
    300
  );

  if requested_enabled is null then
    raise exception 'Referral program state is required.' using errcode = '22004';
  end if;
  if expected_version is null or expected_version < 0 then
    raise exception 'Expected referral program version is required.' using errcode = '22004';
  end if;
  if normalized_reason is null
    or pg_catalog.char_length(normalized_reason) not between 3 and 500 then
    raise exception 'Referral program change reason must contain 3 to 500 characters.'
      using errcode = '22023';
  end if;

  -- Hold the actor's administrator state through the configuration write.
  perform 1
  from public.profiles as administrator
  where administrator.id = actor_id
    and administrator.role = 'admin'
    and administrator.review_status = 'approved'
  for share;
  if not found then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select config.* into current_config
  from private.referral_program_config as config
  where config.singleton
  for update;
  if not found then
    raise exception 'Referral program configuration is unavailable.' using errcode = '55000';
  end if;

  if current_config.version is distinct from expected_version then
    -- A client that lost the successful response may retry the exact state with
    -- the previous version. Reconcile only that single-version transition.
    if current_config.version - expected_version = 1
      and current_config.enabled is not distinct from requested_enabled
      and current_config.updated_by is not distinct from actor_id
      and current_config.change_reason is not distinct from normalized_reason then
      return query
      select
        current_config.enabled,
        current_config.version,
        current_config.updated_at,
        coalesce(
          administrator.full_name,
          user_account.email::text,
          case when current_config.updated_by is null then 'System' else 'Former administrator' end
        ),
        current_config.change_reason
      from (select 1) as singleton_row
      left join public.profiles as administrator
        on administrator.id = current_config.updated_by
      left join auth.users as user_account
        on user_account.id = current_config.updated_by;
      return;
    end if;

    raise exception 'Referral program configuration changed after it was loaded.'
      using errcode = '40001';
  end if;

  if current_config.enabled is not distinct from requested_enabled then
    raise exception 'Referral program state must change.' using errcode = '22023';
  end if;

  previous_config := current_config;

  update private.referral_program_config as config
  set
    enabled = requested_enabled,
    version = config.version + 1,
    updated_at = checked_at,
    updated_by = actor_id,
    change_reason = normalized_reason
  where config.singleton
    and config.version = expected_version
  returning config.* into current_config;
  if not found then
    raise exception 'Referral program configuration changed after it was loaded.'
      using errcode = '40001';
  end if;

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
    'referral_program_config_update',
    'referral_program_config',
    'global',
    pg_catalog.jsonb_build_object(
      'label', 'Referral program',
      'enabled', previous_config.enabled,
      'version', previous_config.version
    ),
    pg_catalog.jsonb_build_object(
      'label', 'Referral program',
      'enabled', current_config.enabled,
      'version', current_config.version
    ),
    pg_catalog.jsonb_build_object('reason', normalized_reason)
  );

  return query
  select
    current_config.enabled,
    current_config.version,
    current_config.updated_at,
    coalesce(administrator.full_name, user_account.email::text, 'Former administrator'),
    current_config.change_reason
  from (select 1) as singleton_row
  left join public.profiles as administrator on administrator.id = current_config.updated_by
  left join auth.users as user_account on user_account.id = current_config.updated_by;
end;
$$;

revoke all on function public.check_referral_code(text)
from public, anon, authenticated, service_role;
revoke all on function public.validate_referral_code(text)
from public, anon, authenticated, service_role;
revoke all on function private.process_profile_referral()
from public, anon, authenticated, service_role;
revoke all on function public.read_own_referral_summary()
from public, anon, authenticated, service_role;
revoke all on function public.export_own_referral_data()
from public, anon, authenticated, service_role;
revoke all on function public.admin_read_referral_program_config()
from public, anon, authenticated, service_role;
revoke all on function public.admin_update_referral_program_config(boolean, bigint, text)
from public, anon, authenticated, service_role;

grant execute on function public.check_referral_code(text) to anon, authenticated;
grant execute on function public.validate_referral_code(text) to anon, authenticated;
grant execute on function public.read_own_referral_summary() to authenticated;
grant execute on function public.export_own_referral_data() to authenticated;
grant execute on function public.admin_read_referral_program_config() to authenticated;
grant execute on function public.admin_update_referral_program_config(boolean, bigint, text)
to authenticated;

comment on table private.referral_program_config is
  'Private singleton controlling whether registration may create referral bindings and rewards.';
comment on function public.check_referral_code(text) is
  'Returns only the global referral state and whether a supplied code is currently available.';
comment on function public.validate_referral_code(text) is
  'Compatibility boolean referral-code check; always false while the program is disabled.';
comment on function private.process_profile_referral() is
  'Creates every member code and atomically gates optional registration binding and rewards on the locked global switch.';
comment on function public.read_own_referral_summary() is
  'Returns the member aggregate referral history while suppressing the code whenever referrals are globally disabled.';
comment on function public.export_own_referral_data() is
  'Exports the member referral history and global state without exposing a disabled referral code.';
comment on function public.admin_read_referral_program_config() is
  'Returns the global referral switch to the signed-in administrator without exposing internal identifiers.';
comment on function public.admin_update_referral_program_config(boolean, bigint, text) is
  'Atomically updates the referral switch with optimistic locking, rate limiting, lost-response reconciliation, and audit logging.';

-- Extend the administrator projection with an allowlisted switch summary.
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
        'profile_fields', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
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
      when 'referral_bindings' then pg_catalog.jsonb_build_object(
        'reward_tokens', log.after_data -> 'reward_tokens',
        'reward_count', log.after_data -> 'reward_count',
        'max_rewards', log.after_data -> 'max_rewards'
      )
      when 'referral_program_config' then pg_catalog.jsonb_build_object(
        'before_enabled', log.before_data -> 'enabled',
        'after_enabled', log.after_data -> 'enabled',
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

revoke all on function public.admin_list_audit_logs(integer, bigint)
from public, anon, authenticated, service_role;
grant execute on function public.admin_list_audit_logs(integer, bigint) to authenticated;

comment on function public.admin_list_audit_logs(integer, bigint) is
  'Returns a bounded administrator audit projection with allowlisted referral switch and reward details.';
