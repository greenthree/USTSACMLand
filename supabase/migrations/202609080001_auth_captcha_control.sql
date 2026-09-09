-- Keep the public Auth CAPTCHA switch in a private singleton and change the
-- hosted Supabase Auth setting only through the protected Edge Function.
create table private.auth_captcha_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  version bigint not null default 1,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid references auth.users (id) on delete set null,
  reason text not null default 'initial configuration',
  constraint auth_captcha_config_version_nonnegative check (version >= 0),
  constraint auth_captcha_config_reason_length check (char_length(reason) between 3 and 500)
);

insert into private.auth_captcha_config (singleton, enabled, reason)
values (true, false, '默认关闭，待完成生产验证')
on conflict (singleton) do nothing;

alter table private.auth_captcha_config enable row level security;
revoke all on table private.auth_captcha_config from public, anon, authenticated, service_role;

create or replace function public.read_auth_captcha_config()
returns table (
  enabled boolean,
  version bigint,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select config.enabled, config.version, config.updated_at
  from private.auth_captcha_config as config
  where config.singleton;
$$;

create or replace function public.admin_commit_auth_captcha_config(
  actor_id uuid,
  requested_enabled boolean,
  expected_version bigint,
  requested_reason text
)
returns table (
  enabled boolean,
  version bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_config private.auth_captcha_config%rowtype;
  normalized_reason text := nullif(pg_catalog.btrim(requested_reason), '');
begin
  perform public.consume_admin_rate_limit(actor_id, 'auth_captcha_config.write', 6, 300);

  if requested_enabled is null then
    raise exception 'Auth CAPTCHA state is required.' using errcode = '22004';
  end if;
  if expected_version is null or expected_version < 0 then
    raise exception 'Expected Auth CAPTCHA configuration version is required.' using errcode = '22004';
  end if;
  if normalized_reason is null or pg_catalog.char_length(normalized_reason) < 3 then
    raise exception 'Auth CAPTCHA configuration reason must contain at least 3 characters.'
      using errcode = '22023';
  end if;
  if pg_catalog.char_length(normalized_reason) > 500 then
    raise exception 'Auth CAPTCHA configuration reason exceeds 500 characters.'
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
  from private.auth_captcha_config as config
  where config.singleton
  for update;

  if not found then
    raise exception 'Auth CAPTCHA configuration singleton is missing.' using errcode = '55000';
  end if;
  if current_config.version is distinct from expected_version then
    raise exception 'Auth CAPTCHA configuration changed after it was loaded.'
      using errcode = '40001';
  end if;

  update private.auth_captcha_config
  set enabled = requested_enabled,
      version = current_config.version + 1,
      updated_at = pg_catalog.clock_timestamp(),
      updated_by = actor_id,
      reason = normalized_reason
  where singleton;

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
    'auth_captcha_config_updated',
    'auth_captcha_config',
    'singleton',
    pg_catalog.jsonb_build_object('enabled', current_config.enabled, 'version', current_config.version),
    pg_catalog.jsonb_build_object('enabled', requested_enabled, 'version', current_config.version + 1),
    pg_catalog.jsonb_build_object('reason', normalized_reason)
  );

  return query
  select config.enabled, config.version, config.updated_at
  from private.auth_captcha_config as config
  where config.singleton;
end;
$$;

revoke all on function public.read_auth_captcha_config() from public, anon, authenticated;
revoke all on function public.admin_commit_auth_captcha_config(uuid, boolean, bigint, text)
from public, anon, authenticated;
grant execute on function public.read_auth_captcha_config() to service_role;
grant execute on function public.admin_commit_auth_captcha_config(uuid, boolean, bigint, text)
to service_role;

comment on table private.auth_captcha_config is
  'Private singleton mirroring the hosted Supabase Auth CAPTCHA state; mutation is service-role controlled.';
comment on function public.read_auth_captcha_config() is
  'Returns the non-secret Auth CAPTCHA switch used by the public runtime configuration endpoint.';
comment on function public.admin_commit_auth_captcha_config(uuid, boolean, bigint, text) is
  'Commits an externally verified Auth CAPTCHA state transition with administrator authorization and audit logging.';
