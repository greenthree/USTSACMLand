begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select is(
  (select enabled from private.referral_program_config where singleton),
  false,
  'the production migration baseline pauses new referrals'
);

select is(
  (select change_reason from private.referral_program_config where singleton),
  '安全暂停：等待真实邮箱确认或等价的注册滥用防护',
  'the pause records an actionable reason'
);

set local role anon;
create temporary table paused_public_referral_state as
select * from public.check_referral_code('');
reset role;

select ok(
  exists (
    select 1 from paused_public_referral_state
    where not program_enabled and not available
  ),
  'anonymous registration observes the paused state without a code'
);

select ok(
  exists (
    select 1 from public.audit_logs
    where action = 'referral_program_config_update'
      and target_table = 'referral_program_config'
      and target_id = 'singleton'
      and metadata ->> 'source' = 'security_migration'
      and metadata ->> 'reason' = '安全暂停：等待真实邮箱确认或等价的注册滥用防护'
  ),
  'the emergency pause is recorded in the administrator audit trail'
);

select * from finish();

rollback;
