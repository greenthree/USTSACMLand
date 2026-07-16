-- Migration 202607140009 made successful source observations globally
-- idempotent, but the previously deployed Luogu commit RPC still reused the
-- retained successful source time for failure snapshots and handled conflicts
-- only by sync run. Patch the stored RPC without rewriting deployed history.

do $$
declare
  function_signature regprocedure := 'public.commit_luogu_sync_result(bigint,text,bigint,bigint,bigint,boolean,integer,integer,integer,public.stat_freshness_status,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.sync_error_code,text,text,timestamp with time zone,integer,jsonb,text,bigint,integer,text[],timestamp with time zone)'::regprocedure;
  function_definition text;
  old_statement constant text := $old$
    stat_status,
    stat_source_observed_at,
    run_finished_at
  )
  on conflict (profile_id, platform, sync_run_id) do update
  set current_rating = excluded.current_rating,
      max_rating = excluded.max_rating,
      solved_count = excluded.solved_count,
      status = excluded.status,
      source_observed_at = excluded.source_observed_at,
      recorded_at = excluded.recorded_at;
$old$;
  new_statement constant text := $new$
    stat_status,
    case when sync_succeeded then stat_source_observed_at else null end,
    run_finished_at
  )
  -- The table also has a per-run unique constraint, so targetless conflict
  -- handling keeps repeated commit calls idempotent under either invariant.
  on conflict do nothing;
$new$;
begin
  select pg_catalog.pg_get_functiondef(function_signature::oid)
  into function_definition;

  if position(old_statement in function_definition) > 0 then
    execute replace(function_definition, old_statement, new_statement);
  elsif position(new_statement in function_definition) = 0 then
    raise exception 'Could not locate the Luogu snapshot conflict handler';
  end if;
end;
$$;

comment on function public.commit_luogu_sync_result(
  bigint, text, bigint, bigint, bigint, boolean, integer, integer, integer,
  public.stat_freshness_status, timestamptz, timestamptz, timestamptz, timestamptz,
  public.sync_error_code, text, text, timestamptz, integer, jsonb, text, bigint,
  integer, text[], timestamptz
) is 'Atomically commits Luogu state and statistics with source-idempotent success snapshots and source-less failure snapshots.';
