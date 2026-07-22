-- Transactional referral binding and WebChat quota rewards.
-- Referral tables stay private; browser clients use narrow SECURITY DEFINER RPCs.

create table private.referral_codes (
  inviter_id uuid primary key references public.profiles (id) on delete cascade,
  code text not null unique,
  reward_count smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_codes_code_format check (code ~ '^[A-F0-9]{16}$'),
  constraint referral_codes_reward_count check (reward_count between 0 and 10)
);

create table private.referral_bindings (
  id uuid primary key default gen_random_uuid(),
  invitee_id uuid unique references public.profiles (id) on delete set null,
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  reward_tokens bigint not null default 1000000,
  created_at timestamptz not null default now(),
  invitee_deleted_at timestamptz,
  constraint referral_bindings_not_self check (
    invitee_id is null or invitee_id is distinct from inviter_id
  ),
  constraint referral_bindings_reward_tokens check (reward_tokens = 1000000),
  constraint referral_bindings_deletion_state check (
    (invitee_id is not null and invitee_deleted_at is null)
    or (invitee_id is null and invitee_deleted_at is not null)
  )
);

create index referral_bindings_inviter_created_idx
  on private.referral_bindings (inviter_id, created_at desc);

alter table private.referral_codes enable row level security;
alter table private.referral_bindings enable row level security;

revoke all on table private.referral_codes from public, anon, authenticated, service_role;
revoke all on table private.referral_bindings from public, anon, authenticated, service_role;

create function private.generate_referral_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate text;
begin
  loop
    candidate := pg_catalog.upper(pg_catalog.substr(
      pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      1,
      16
    ));
    exit when not exists (
      select 1 from private.referral_codes as referral where referral.code = candidate
    );
  end loop;
  return candidate;
end;
$$;

revoke all on function private.generate_referral_code()
from public, anon, authenticated, service_role;

insert into private.referral_codes (inviter_id, code)
select profile.id, private.generate_referral_code()
from public.profiles as profile
on conflict (inviter_id) do nothing;

create function private.process_profile_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_code text;
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
  if requested_code !~ '^[A-F0-9]{16}$' then
    raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
  end if;

  select referral.* into selected_code
  from private.referral_codes as referral
  where referral.code = requested_code
  for update;

  if not found
    or not selected_code.active
    or selected_code.reward_count >= 10 then
    raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
  end if;
  if selected_code.inviter_id = new.id then
    raise exception 'Self-referral is not allowed.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles as inviter
    where inviter.id = selected_code.inviter_id
      and inviter.review_status = 'approved'
  ) then
    raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
  end if;

  -- The default-access trigger normally creates this row first. The upsert
  -- keeps registration atomic even if trigger ordering changes later.
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

revoke all on function private.process_profile_referral()
from public, anon, authenticated, service_role;

create trigger profiles_z_process_registration_referral
after insert on public.profiles
for each row execute function private.process_profile_referral();

create function private.anonymize_deleted_referral_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.referral_bindings as binding
  set
    invitee_id = null,
    invitee_deleted_at = pg_catalog.clock_timestamp()
  where binding.invitee_id = old.id;
  return old;
end;
$$;

revoke all on function private.anonymize_deleted_referral_binding()
from public, anon, authenticated, service_role;

create trigger profiles_y_anonymize_referral_binding
before delete on public.profiles
for each row execute function private.anonymize_deleted_referral_binding();

create function public.validate_referral_code(requested_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.referral_codes as referral
    join public.profiles as inviter on inviter.id = referral.inviter_id
    where referral.code = pg_catalog.upper(pg_catalog.btrim(requested_code))
      and referral.active
      and referral.reward_count < 10
      and inviter.review_status = 'approved'
  )
$$;

create function public.read_own_referral_summary()
returns table (
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
    referral.code,
    referral.reward_count::integer,
    (10 - referral.reward_count)::integer,
    referral.reward_count::bigint * 1000000,
    referral.active
      and referral.reward_count < 10
      and profile.review_status = 'approved'
  from private.referral_codes as referral
  join public.profiles as profile on profile.id = referral.inviter_id
  where referral.inviter_id = actor_id;
end;
$$;

create function public.export_own_referral_data()
returns jsonb
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

  return pg_catalog.jsonb_build_object(
    'code', (
      select referral.code
      from private.referral_codes as referral
      where referral.inviter_id = actor_id
    ),
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

revoke all on function public.validate_referral_code(text)
from public, anon, authenticated, service_role;
revoke all on function public.read_own_referral_summary()
from public, anon, authenticated, service_role;
revoke all on function public.export_own_referral_data()
from public, anon, authenticated, service_role;

grant execute on function public.validate_referral_code(text) to anon, authenticated;
grant execute on function public.read_own_referral_summary() to authenticated;
grant execute on function public.export_own_referral_data() to authenticated;

comment on table private.referral_codes is
  'Private member referral codes and the lifetime ten-reward counter.';
comment on table private.referral_bindings is
  'One-time invitation bindings; invitee identity is removed on account deletion while rewards remain.';
comment on function public.validate_referral_code(text) is
  'Returns only whether a normalized referral code can currently accept a registration.';
comment on function public.read_own_referral_summary() is
  'Returns the signed-in member own referral code and aggregate reward status.';
comment on function public.export_own_referral_data() is
  'Exports only the signed-in member own referral summary and binding state.';

-- Extend the administrator projection with an allowlisted reward summary.
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
