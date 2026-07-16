-- Canonicalize numeric UIDs before uniqueness checks and align database limits
-- with the upstream adapters.

create or replace function public.canonicalize_numeric_platform_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.platform in ('nowcoder'::public.platform_name, 'luogu'::public.platform_name)
    and btrim(new.external_id) ~ '^[0-9]+$' then
    new.external_id := coalesce(nullif(ltrim(btrim(new.external_id), '0'), ''), '0');
  end if;
  return new;
end;
$$;

drop trigger if exists platform_accounts_canonicalize_numeric
  on public.platform_accounts;
create trigger platform_accounts_canonicalize_numeric
before insert or update on public.platform_accounts
for each row execute function public.canonicalize_numeric_platform_account();

do $$
declare
  alias_conflict_count integer;
  overlong_uid_count integer;
begin
  select count(*)::integer
  into alias_conflict_count
  from (
    select
      account.platform,
      coalesce(nullif(ltrim(account.external_id, '0'), ''), '0') as canonical_uid
    from public.platform_accounts as account
    where account.platform in (
      'nowcoder'::public.platform_name,
      'luogu'::public.platform_name
    )
    group by
      account.platform,
      coalesce(nullif(ltrim(account.external_id, '0'), ''), '0')
    having count(*) > 1
  ) as conflicts;

  if alias_conflict_count > 0 then
    raise exception 'Numeric platform UID canonicalization found % ownership conflict(s).',
      alias_conflict_count
      using
        errcode = '23505',
        hint = 'Resolve rows whose UIDs differ only by leading zeros before applying this migration.';
  end if;

  select count(*)::integer
  into overlong_uid_count
  from public.platform_accounts as account
  where account.platform in (
      'nowcoder'::public.platform_name,
      'luogu'::public.platform_name
    )
    and char_length(coalesce(nullif(ltrim(account.external_id, '0'), ''), '0')) > 20;

  if overlong_uid_count > 0 then
    raise exception 'Numeric platform UID canonicalization found % UID(s) longer than 20 digits.',
      overlong_uid_count
      using
        errcode = '23514',
        hint = 'Correct or remove invalid overlong UIDs before applying this migration.';
  end if;
end;
$$;

update public.platform_accounts
set external_id = coalesce(nullif(ltrim(external_id, '0'), ''), '0')
where platform in ('nowcoder'::public.platform_name, 'luogu'::public.platform_name)
  and external_id ~ '^0+[0-9]+$';

alter table public.platform_accounts
drop constraint platform_accounts_external_id_format;

alter table public.platform_accounts
add constraint platform_accounts_external_id_format check (
  case platform
    when 'codeforces' then external_id ~ '^[A-Za-z0-9_.-]{3,24}$'
    when 'nowcoder' then external_id ~ '^(0|[1-9][0-9]{0,19})$'
    when 'atcoder' then external_id ~ '^[A-Za-z0-9_]{1,30}$'
    when 'xcpc_elo' then external_id ~ '^(xcpc_[A-Fa-f0-9]{16}|auto:[A-Fa-f0-9]{32})$'
    when 'luogu' then external_id ~ '^(0|[1-9][0-9]{0,19})$'
    when 'qoj' then external_id ~ '^[A-Za-z0-9_.-]{1,50}$'
  end
);

revoke all on function public.canonicalize_numeric_platform_account() from public;

comment on function public.canonicalize_numeric_platform_account() is
  'Removes leading zero aliases from Nowcoder and Luogu UIDs before account uniqueness checks.';

create or replace function public.block_platform_account_change_during_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_role text := (select auth.role());
  target_profile_id uuid := case when tg_op = 'DELETE' then old.profile_id else new.profile_id end;
  previous_platform public.platform_name := old.platform;
  next_platform public.platform_name := case when tg_op = 'DELETE' then old.platform else new.platform end;
begin
  if requester_role = 'service_role'
    or (requester_role is null and session_user in ('postgres', 'supabase_admin')) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if exists (
    select 1
    from public.sync_jobs as job
    where job.profile_id = target_profile_id
      and job.status in ('queued', 'running')
      and (
        job.scope = 'member'
        or job.platform = previous_platform
        or job.platform = next_platform
      )
  ) then
    raise exception 'Platform accounts cannot change while member synchronization is active.'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists platform_accounts_block_active_sync_update
  on public.platform_accounts;
create trigger platform_accounts_block_active_sync_update
before update of external_id, profile_id, platform on public.platform_accounts
for each row execute function public.block_platform_account_change_during_sync();

drop trigger if exists platform_accounts_block_active_sync_delete
  on public.platform_accounts;
create trigger platform_accounts_block_active_sync_delete
before delete on public.platform_accounts
for each row execute function public.block_platform_account_change_during_sync();

revoke all on function public.block_platform_account_change_during_sync() from public;

comment on function public.block_platform_account_change_during_sync() is
  'Prevents browser and administrator account edits from racing an active member synchronization.';
