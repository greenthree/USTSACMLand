-- Administrator-only platform account review API.

create or replace function public.admin_list_platform_accounts()
returns table (
  id bigint,
  profile_id uuid,
  full_name text,
  email text,
  major text,
  platform public.platform_name,
  external_id text,
  status public.account_verification_status,
  verified_at timestamptz,
  verification_error_code public.sync_error_code,
  verification_error_message text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select
    a.id,
    a.profile_id,
    p.full_name,
    u.email::text,
    p.major,
    a.platform,
    a.external_id,
    a.status,
    a.verified_at,
    a.verification_error_code,
    a.verification_error_message,
    a.updated_at
  from public.platform_accounts as a
  join public.profiles as p on p.id = a.profile_id
  join auth.users as u on u.id = p.id
  order by
    case a.status
      when 'pending' then 0
      when 'invalid' then 1
      when 'disabled' then 2
      when 'verified' then 3
    end,
    a.updated_at desc,
    a.id;
end;
$$;

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

revoke all on function public.admin_list_platform_accounts()
  from public, anon, authenticated;
revoke all on function public.admin_set_platform_account_status(
  bigint,
  public.account_verification_status,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.admin_list_platform_accounts() to authenticated;
grant execute on function public.admin_set_platform_account_status(
  bigint,
  public.account_verification_status,
  text,
  timestamptz
) to authenticated;

comment on function public.admin_list_platform_accounts() is
  'Returns private platform account review data only after an explicit approved-admin check.';
comment on function public.admin_set_platform_account_status(
  bigint,
  public.account_verification_status,
  text,
  timestamptz
) is
  'Updates platform account verification state with optimistic locking while existing triggers maintain timestamps and audit logs.';
