-- Keep the emergency pause effective until a privileged operator explicitly
-- verifies real email confirmation or an equivalent registration abuse control.
-- The flag is intentionally not writable through any browser-facing RPC.

alter table private.referral_program_config
  add column if not exists reopen_allowed boolean not null default false,
  add column if not exists reopen_block_reason text not null default
    '推荐计划处于安全暂停状态，等待真实邮箱确认或等价的注册滥用防护。';

do $$
declare
  previous_config private.referral_program_config%rowtype;
  next_config private.referral_program_config%rowtype;
  pause_reason constant text :=
    '安全暂停：等待真实邮箱确认或等价的注册滥用防护';
  block_reason constant text :=
    '推荐计划处于安全暂停状态，等待真实邮箱确认或等价的注册滥用防护。';
begin
  select config.* into previous_config
  from private.referral_program_config as config
  where config.singleton
  for update;

  if not found then
    return;
  end if;

  update private.referral_program_config as config
  set
    enabled = false,
    reopen_allowed = false,
    reopen_block_reason = block_reason,
    version = case
      when previous_config.enabled then config.version + 1
      else config.version
    end,
    updated_at = case
      when previous_config.enabled then pg_catalog.clock_timestamp()
      else config.updated_at
    end,
    updated_by = case
      when previous_config.enabled then null
      else config.updated_by
    end,
    change_reason = case
      when previous_config.enabled then pause_reason
      else config.change_reason
    end
  where config.singleton
  returning config.* into next_config;

  if not previous_config.enabled then
    return;
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
    null,
    'referral_program_config_update',
    'referral_program_config',
    'singleton',
    pg_catalog.jsonb_build_object(
      'enabled', previous_config.enabled,
      'version', previous_config.version
    ),
    pg_catalog.jsonb_build_object(
      'enabled', next_config.enabled,
      'version', next_config.version
    ),
    pg_catalog.jsonb_build_object(
      'reason', pause_reason,
      'source', 'security_migration'
    )
  );
end;
$$;

create or replace function private.guard_referral_program_reopen()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not old.enabled and new.enabled and not old.reopen_allowed then
    raise exception '%', old.reopen_block_reason using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists referral_program_reopen_guard on private.referral_program_config;
create trigger referral_program_reopen_guard
before update of enabled on private.referral_program_config
for each row
execute function private.guard_referral_program_reopen();

-- Fail the migration itself unless the newly installed trigger rejects a
-- re-enable attempt. The expected exception rolls back only the nested update,
-- so the production configuration remains paused and unchanged.
do $$
begin
  if not exists (
    select 1
    from private.referral_program_config as config
    where config.singleton
      and not config.enabled
      and not config.reopen_allowed
  ) then
    raise exception 'Referral safety gate requires a paused singleton configuration.'
      using errcode = '55000';
  end if;

  begin
    update private.referral_program_config as config
    set enabled = true
    where config.singleton;

    raise exception 'Referral safety gate self-check unexpectedly allowed reopening.'
      using errcode = '23514';
  exception
    when sqlstate '55000' then
      null;
  end;
end;
$$;

revoke all on function private.guard_referral_program_reopen()
from public, anon, authenticated, service_role;

comment on column private.referral_program_config.reopen_allowed is
  'Privileged operational gate; browser-facing administrators cannot change this flag.';
comment on column private.referral_program_config.reopen_block_reason is
  'Actionable reason shown to operators while reopening is blocked.';
comment on function private.guard_referral_program_reopen() is
  'Rejects every referral re-enable until the privileged reopen gate is explicitly unlocked.';
