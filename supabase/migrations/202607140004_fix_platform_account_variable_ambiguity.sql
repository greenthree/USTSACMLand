-- Disambiguate the normalized external ID variable from the table column.

create or replace function public.admin_upsert_member_platform_account(
  target_profile_id uuid,
  target_platform public.platform_name,
  new_external_id text,
  expected_updated_at timestamptz default null
)
returns table (
  account_id bigint,
  account_status public.account_verification_status,
  account_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_new_external_id text := nullif(btrim(new_external_id), '');
  target_role public.app_role;
  target_status public.profile_review_status;
  current_account_id bigint;
  current_external_id text;
  current_updated_at timestamptz;
  account_exists boolean;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if target_profile_id is null or target_platform is null then
    raise exception 'Target member and platform are required.' using errcode = '22004';
  end if;

  if target_platform = 'xcpc_elo'::public.platform_name then
    raise exception 'XCPC ELO accounts are maintained by automatic name matching.'
      using errcode = '42501';
  end if;

  if normalized_new_external_id is null or char_length(normalized_new_external_id) > 128 then
    raise exception 'Platform account ID must contain between 1 and 128 characters.'
      using errcode = '22023';
  end if;

  select p.role, p.review_status
  into target_role, target_status
  from public.profiles as p
  where p.id = target_profile_id
  for update;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  if target_role <> 'member' or target_status not in ('approved', 'suspended') then
    raise exception 'Only active or suspended member profiles can be managed.'
      using errcode = '42501';
  end if;

  select a.id, a.external_id, a.updated_at
  into current_account_id, current_external_id, current_updated_at
  from public.platform_accounts as a
  where a.profile_id = target_profile_id
    and a.platform = target_platform
  for update;
  account_exists := found;

  if account_exists then
    if expected_updated_at is null
      or current_updated_at is distinct from expected_updated_at then
      raise exception 'Platform account changed after it was loaded. Refresh and try again.'
        using errcode = '40001';
    end if;

    if current_external_id is distinct from normalized_new_external_id then
      update public.platform_accounts
      set external_id = normalized_new_external_id
      where id = current_account_id
      returning id, status, updated_at
      into account_id, account_status, account_updated_at;
    else
      select a.id, a.status, a.updated_at
      into account_id, account_status, account_updated_at
      from public.platform_accounts as a
      where a.id = current_account_id;
    end if;
  else
    if expected_updated_at is not null then
      raise exception 'Platform account changed after it was loaded. Refresh and try again.'
        using errcode = '40001';
    end if;

    insert into public.platform_accounts (
      profile_id,
      platform,
      external_id,
      normalized_external_id,
      status
    ) values (
      target_profile_id,
      target_platform,
      normalized_new_external_id,
      lower(normalized_new_external_id),
      'pending'
    )
    returning id, status, updated_at
    into account_id, account_status, account_updated_at;
  end if;

  return next;
end;
$$;
