-- Manage XCPC ELO identities from the approved member name instead of user-entered IDs.

alter table public.platform_accounts
drop constraint platform_accounts_external_id_format;

alter table public.platform_accounts
add constraint platform_accounts_external_id_format check (
  case platform
    when 'codeforces' then external_id ~ '^[A-Za-z0-9_.-]{3,24}$'
    when 'nowcoder' then external_id ~ '^[0-9]+$'
    when 'atcoder' then external_id ~ '^[A-Za-z0-9_]{1,30}$'
    when 'xcpc_elo' then external_id ~ '^(xcpc_[A-Fa-f0-9]{16}|auto:[A-Fa-f0-9]{32})$'
    when 'luogu' then external_id ~ '^[0-9]+$'
    when 'qoj' then external_id ~ '^[A-Za-z0-9_.-]{1,50}$'
  end
);

create or replace function public.ensure_xcpc_name_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  placeholder_id text := 'auto:' || pg_catalog.md5(
    new.id::text
    || ':' || coalesce(new.full_name, '')
    || ':' || pg_catalog.clock_timestamp()::text
    || ':' || pg_catalog.random()::text
  );
begin
  if tg_op = 'INSERT' and new.full_name is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.full_name is not distinct from old.full_name then
    return new;
  end if;

  if new.full_name is null then
    update public.platform_accounts
    set external_id = placeholder_id
    where profile_id = new.id
      and platform = 'xcpc_elo'::public.platform_name;

    return new;
  end if;

  insert into public.platform_accounts (
    profile_id,
    platform,
    external_id,
    normalized_external_id
  )
  values (
    new.id,
    'xcpc_elo'::public.platform_name,
    placeholder_id,
    placeholder_id
  )
  on conflict (profile_id, platform) do update
  set external_id = excluded.external_id;

  return new;
end;
$$;

drop trigger if exists profiles_ensure_xcpc_name_account on public.profiles;
create trigger profiles_ensure_xcpc_name_account
after insert or update of full_name on public.profiles
for each row execute function public.ensure_xcpc_name_account();

-- Existing stable IDs are retained for auditability, but every existing XCPC
-- account must be revalidated by the new name-and-organization matcher.
update public.platform_accounts
set
  status = 'pending',
  verified_at = null,
  verification_error_code = null,
  verification_error_message = null
where platform = 'xcpc_elo'::public.platform_name;

insert into public.platform_accounts (
  profile_id,
  platform,
  external_id,
  normalized_external_id
)
select
  p.id,
  'xcpc_elo'::public.platform_name,
  'auto:' || pg_catalog.md5(p.id::text || ':' || p.full_name),
  'auto:' || pg_catalog.md5(p.id::text || ':' || p.full_name)
from public.profiles as p
where p.full_name is not null
on conflict (profile_id, platform) do nothing;

drop policy if exists platform_accounts_insert_self on public.platform_accounts;
create policy platform_accounts_insert_self on public.platform_accounts
for insert to authenticated
with check (
  profile_id = (select auth.uid())
  and platform <> 'xcpc_elo'::public.platform_name
  and (select public.can_edit_own_data())
);

drop policy if exists platform_accounts_update_self on public.platform_accounts;
create policy platform_accounts_update_self on public.platform_accounts
for update to authenticated
using (
  profile_id = (select auth.uid())
  and platform <> 'xcpc_elo'::public.platform_name
  and (select public.can_edit_own_data())
)
with check (
  profile_id = (select auth.uid())
  and platform <> 'xcpc_elo'::public.platform_name
  and (select public.can_edit_own_data())
);

drop policy if exists platform_accounts_delete_self on public.platform_accounts;
create policy platform_accounts_delete_self on public.platform_accounts
for delete to authenticated
using (
  profile_id = (select auth.uid())
  and platform <> 'xcpc_elo'::public.platform_name
  and (select public.can_edit_own_data())
);

create or replace function public.admin_set_platform_account_status(
  target_account_id bigint,
  next_status public.account_verification_status,
  error_message text,
  expected_updated_at timestamptz
)
returns public.account_verification_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_error_message text := nullif(btrim(error_message), '');
  current_status public.account_verification_status;
  current_updated_at timestamptz;
  target_profile_id uuid;
  target_platform public.platform_name;
  updated_status public.account_verification_status;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if target_account_id is null then
    raise exception 'Target platform account is required.' using errcode = '22004';
  end if;

  if next_status is null then
    raise exception 'Target verification status is required.' using errcode = '22004';
  end if;

  if expected_updated_at is null then
    raise exception 'Expected platform account update time is required.' using errcode = '22004';
  end if;

  if normalized_error_message is not null and char_length(normalized_error_message) > 2000 then
    raise exception 'Verification error message exceeds 2000 characters.' using errcode = '22001';
  end if;

  if next_status in ('pending', 'verified')
    and normalized_error_message is not null then
    raise exception '% accounts cannot carry verification error metadata.', next_status
      using errcode = '22023';
  end if;

  if next_status = 'invalid' and normalized_error_message is null then
    raise exception 'Invalid accounts require an error message.'
      using errcode = '22023';
  end if;

  select a.status, a.updated_at, a.profile_id, a.platform
  into current_status, current_updated_at, target_profile_id, target_platform
  from public.platform_accounts as a
  where a.id = target_account_id
  for update;

  if not found then
    raise exception 'Platform account not found.' using errcode = 'P0002';
  end if;

  if target_platform = 'xcpc_elo'::public.platform_name then
    raise exception 'XCPC ELO verification is maintained by automatic name matching.'
      using errcode = '42501';
  end if;

  if current_updated_at is distinct from expected_updated_at then
    raise exception 'Platform account changed after it was loaded. Refresh and try again.'
      using errcode = '40001';
  end if;

  update public.platform_accounts
  set
    status = next_status,
    verified_at = case when next_status = 'verified' then verified_at else null end,
    verification_error_code = case
      when next_status = 'invalid' then 'invalid_account'::public.sync_error_code
      else null
    end,
    verification_error_message = case
      when next_status in ('invalid', 'disabled') then normalized_error_message
      else null
    end
  where id = target_account_id
  returning status into updated_status;

  if current_status = 'verified' and next_status <> 'verified' then
    update public.platform_stats
    set
      status = 'unavailable',
      error_code = case
        when next_status = 'invalid' then 'invalid_account'::public.sync_error_code
        else null
      end,
      error_message = case
        when next_status in ('invalid', 'disabled') then normalized_error_message
        else 'Platform account verification is pending.'
      end
    where profile_id = target_profile_id
      and platform = target_platform;
  end if;

  return updated_status;
end;
$$;

comment on function public.ensure_xcpc_name_account() is
  'Creates and invalidates the service-managed XCPC ELO account whenever a profile name changes.';

comment on function public.admin_set_platform_account_status(
  bigint,
  public.account_verification_status,
  text,
  timestamptz
) is
  'Updates non-XCPC account verification state; XCPC ELO verification is service-managed by name and organization.';
