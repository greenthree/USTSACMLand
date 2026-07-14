-- Migration 202607140006 was already applied in production before the enum cast
-- was corrected. Patch the stored function body while remaining a no-op for
-- fresh databases that apply the corrected migration first.
do $$
declare
  function_signature regprocedure := 'public.commit_luogu_sync_result(bigint,text,bigint,bigint,bigint,boolean,integer,integer,integer,public.stat_freshness_status,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.sync_error_code,text,text,timestamp with time zone,integer,jsonb,text,bigint,integer,text[],timestamp with time zone)'::regprocedure;
  function_definition text;
  old_statement constant text := 'set status = case when sync_succeeded then ''succeeded'' else ''failed'' end,';
  new_statement constant text := 'set status = (case when sync_succeeded then ''succeeded'' else ''failed'' end)::public.sync_run_status,';
begin
  select pg_get_functiondef(function_signature::oid) into function_definition;

  if position(old_statement in function_definition) > 0 then
    execute replace(function_definition, old_statement, new_statement);
  elsif position(new_statement in function_definition) = 0 then
    raise exception 'Could not locate the Luogu sync status assignment';
  end if;
end;
$$;
