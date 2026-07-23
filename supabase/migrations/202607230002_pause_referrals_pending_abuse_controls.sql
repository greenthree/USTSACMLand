-- Production Auth currently auto-confirms email registrations. Pause new
-- referral bindings until real email confirmation or an equivalent anti-abuse
-- qualification is enforced. Existing codes, bindings, and rewards remain.

do $$
declare
  previous_config private.referral_program_config%rowtype;
  next_config private.referral_program_config%rowtype;
  pause_reason constant text :=
    '安全暂停：等待真实邮箱确认或等价的注册滥用防护';
begin
  select config.* into previous_config
  from private.referral_program_config as config
  where config.singleton
  for update;

  if not found or not previous_config.enabled then
    return;
  end if;

  update private.referral_program_config as config
  set
    enabled = false,
    version = config.version + 1,
    updated_at = pg_catalog.clock_timestamp(),
    updated_by = null,
    change_reason = pause_reason
  where config.singleton
  returning config.* into next_config;

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
