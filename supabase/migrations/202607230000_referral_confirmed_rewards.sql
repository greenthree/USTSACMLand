-- Grant referral rewards only after the invitee confirms their email.
-- Existing unconfirmed bindings are reversed transactionally and may earn a
-- reward later if the invitee confirms while the referral remains available.

create or replace function private.process_profile_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_code text;
  invitee_confirmed boolean;
  strict_validation boolean := tg_table_schema = 'public';
  observed_program_enabled boolean;
  referral_check record;
  selected_inviter_id uuid;
  selected_code private.referral_codes%rowtype;
  inviter_access private.webchat_member_access%rowtype;
  created_binding_id uuid;
begin
  insert into private.referral_codes (inviter_id, code)
  values (new.id, private.generate_referral_code())
  on conflict (inviter_id) do nothing;

  select
    pg_catalog.upper(pg_catalog.btrim(user_record.raw_user_meta_data ->> 'referral_code')),
    user_record.email_confirmed_at is not null
  into requested_code, invitee_confirmed
  from auth.users as user_record
  where user_record.id = new.id;

  if requested_code is null or requested_code = '' then
    return new;
  end if;

  select config.enabled into observed_program_enabled
  from private.referral_program_config as config
  where config.singleton;
  if not found or not observed_program_enabled then
    return new;
  end if;

  -- Registration still rejects a malformed or currently unavailable code,
  -- but it does not reserve a reward before email ownership is established.
  if not invitee_confirmed then
    select checked.* into referral_check
    from public.check_referral_code(requested_code) as checked;

    if not found
      or not referral_check.program_enabled
      or not referral_check.available then
      raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
    end if;
    return new;
  end if;

  -- The confirmation trigger is deliberately idempotent. A previously
  -- granted binding wins even if Auth writes the confirmation timestamp again.
  if exists (
    select 1
    from private.referral_bindings as binding
    where binding.invitee_id = new.id
  ) then
    return new;
  end if;

  if requested_code !~ '^[A-F0-9]{16}$' then
    if strict_validation then
      raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
    end if;
    return new;
  end if;

  select referral.inviter_id into selected_inviter_id
  from private.referral_codes as referral
  where referral.code = requested_code;

  if not found or selected_inviter_id = new.id then
    if strict_validation then
      raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
    end if;
    return new;
  end if;

  -- Preserve the established profile -> config -> code -> access lock order.
  perform 1
  from public.profiles as inviter
  where inviter.id = selected_inviter_id
    and inviter.review_status = 'approved'
  for share;
  if not found then
    if strict_validation then
      raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
    end if;
    return new;
  end if;

  select config.enabled into observed_program_enabled
  from private.referral_program_config as config
  where config.singleton
  for share;
  if not found or not observed_program_enabled then
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
    if strict_validation then
      raise exception 'Referral code is invalid or unavailable.' using errcode = '22023';
    end if;
    return new;
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
    if strict_validation then
      raise exception 'Referral reward would exceed the member quota ceiling.'
        using errcode = '22023';
    end if;
    return new;
  end if;

  insert into private.referral_bindings (invitee_id, inviter_id)
  values (new.id, selected_code.inviter_id)
  on conflict (invitee_id) do nothing
  returning id into created_binding_id;

  if created_binding_id is null then
    return new;
  end if;

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
      'binding_id', created_binding_id,
      'email_confirmed', true
    )
  );

  return new;
end;
$$;

revoke all on function private.process_profile_referral()
from public, anon, authenticated, service_role;

drop trigger if exists auth_users_z_process_confirmed_referral on auth.users;
create trigger auth_users_z_process_confirmed_referral
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function private.process_profile_referral();

comment on function private.process_profile_referral() is
  'Creates member codes at registration and grants an idempotent referral reward only after email confirmation.';

-- Reverse rewards that were issued by the earlier registration trigger before
-- this migration could verify ownership of the invitee email address.
create temporary table referral_unconfirmed_rewards_to_revoke
on commit drop
as
select
  binding.id,
  binding.invitee_id,
  binding.inviter_id,
  binding.reward_tokens
from private.referral_bindings as binding
join auth.users as invitee on invitee.id = binding.invitee_id
where invitee.email_confirmed_at is null
  and binding.invitee_deleted_at is null;

with revoked as (
  select
    pending.inviter_id,
    pg_catalog.count(*)::integer as reward_count,
    pg_catalog.sum(pending.reward_tokens)::bigint as reward_tokens
  from referral_unconfirmed_rewards_to_revoke as pending
  group by pending.inviter_id
)
update private.referral_codes as referral
set
  reward_count = greatest(0, referral.reward_count - revoked.reward_count),
  updated_at = pg_catalog.clock_timestamp()
from revoked
where referral.inviter_id = revoked.inviter_id;

with revoked as (
  select
    pending.inviter_id,
    pg_catalog.sum(pending.reward_tokens)::bigint as reward_tokens
  from referral_unconfirmed_rewards_to_revoke as pending
  group by pending.inviter_id
)
update private.webchat_member_access as access
set
  total_token_limit = greatest(0, access.total_token_limit - revoked.reward_tokens),
  version = access.version + 1,
  updated_at = pg_catalog.clock_timestamp(),
  updated_by = null
from revoked
where access.user_id = revoked.inviter_id;

insert into public.audit_logs (
  actor_id,
  action,
  target_table,
  target_id,
  after_data,
  metadata
)
select
  null,
  'referral_unconfirmed_rewards_revoked',
  'referral_bindings',
  pending.inviter_id::text,
  pg_catalog.jsonb_build_object(
    'reward_tokens', pg_catalog.sum(pending.reward_tokens),
    'reward_count', pg_catalog.count(*),
    'max_rewards', 10
  ),
  pg_catalog.jsonb_build_object('email_confirmation_required', true)
from referral_unconfirmed_rewards_to_revoke as pending
group by pending.inviter_id;

delete from private.referral_bindings as binding
using referral_unconfirmed_rewards_to_revoke as pending
where binding.id = pending.id;
