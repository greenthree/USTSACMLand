-- Reconfirm ownership immediately before the irreversible Auth deletion and
-- extend the short-lived recovery-floor lease without holding a database
-- transaction open across external HTTP requests.

create or replace function public.renew_account_deletion_recovery_lease(
  p_owner_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  renewed boolean;
  renewed_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_owner_token is null then
    return false;
  end if;

  update private.account_deletion_recovery_lease
  set expires_at = renewed_at + interval '5 minutes'
  where owner_token = p_owner_token
    and expires_at > renewed_at
  returning true into renewed;

  return coalesce(renewed, false);
end;
$$;

revoke all on function public.renew_account_deletion_recovery_lease(uuid) from public, anon, authenticated;
grant execute on function public.renew_account_deletion_recovery_lease(uuid) to service_role;

comment on function public.renew_account_deletion_recovery_lease(uuid) is
  'Reconfirms ownership and extends the account-deletion recovery-floor lease before Auth deletion.';
