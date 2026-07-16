-- A newly bound Luogu account remains pending when its first upstream request
-- fails. The atomic result RPC must still record that failure without allowing
-- a pending account to commit successful statistics or an incremental cursor.
do $$
declare
  function_signature regprocedure := 'public.commit_luogu_sync_result(bigint,text,bigint,bigint,bigint,boolean,integer,integer,integer,public.stat_freshness_status,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.sync_error_code,text,text,timestamp with time zone,integer,jsonb,text,bigint,integer,text[],timestamp with time zone)'::regprocedure;
  function_definition text;
  old_guard text := $guard$
    or account_row.status <> 'verified'
    or account_row.external_id <> expected_external_id
$guard$;
  new_guard text := $guard$
    or account_row.status = 'disabled'
    or (sync_succeeded and account_row.status <> 'verified')
    or account_row.external_id <> expected_external_id
$guard$;
begin
  select pg_get_functiondef(function_signature)
  into function_definition;

  if function_definition is null or strpos(function_definition, old_guard) = 0 then
    raise exception 'Could not locate the Luogu account status guard';
  end if;
  if strpos(replace(function_definition, old_guard, new_guard), old_guard) > 0 then
    raise exception 'Luogu account status guard replacement was incomplete';
  end if;

  execute replace(function_definition, old_guard, new_guard);
end;
$$;

comment on function public.commit_luogu_sync_result(
  bigint, text, bigint, bigint, bigint, boolean, integer, integer, integer,
  public.stat_freshness_status, timestamptz, timestamptz, timestamptz, timestamptz,
  public.sync_error_code, text, text, timestamptz, integer, jsonb, text, bigint,
  integer, text[], timestamptz
) is 'Atomically commits verified Luogu successes and records failures for non-disabled pending or verified accounts.';
