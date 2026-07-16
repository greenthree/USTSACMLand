-- AtCoder contributes both Rating and accepted-problem counts. Migration
-- 202607140003 accidentally omitted it from the manual solved-count matrix,
-- and migration 202607150003 subsequently renamed the implementation while
-- adding the rate-limited public wrapper. Patch the stored implementation in
-- place so existing grants and wrapper behavior remain unchanged.

do $$
declare
  function_signature regprocedure := 'public.admin_set_manual_platform_stats_unlimited(uuid,public.platform_name,integer,integer,integer,timestamp with time zone,text,timestamp with time zone)'::regprocedure;
  function_definition text;
  old_statement constant text := $old$
  solved_supported boolean := target_platform in (
    'codeforces'::public.platform_name,
    'nowcoder'::public.platform_name,
    'luogu'::public.platform_name,
    'qoj'::public.platform_name
  );
$old$;
  new_statement constant text := $new$
  solved_supported boolean := target_platform in (
    'codeforces'::public.platform_name,
    'nowcoder'::public.platform_name,
    'atcoder'::public.platform_name,
    'luogu'::public.platform_name,
    'qoj'::public.platform_name
  );
$new$;
begin
  select pg_catalog.pg_get_functiondef(function_signature::oid)
  into function_definition;

  if position(old_statement in function_definition) > 0 then
    execute replace(function_definition, old_statement, new_statement);
  elsif position(new_statement in function_definition) = 0 then
    raise exception 'Could not locate the manual solved-count platform matrix';
  end if;
end;
$$;

comment on function public.admin_set_manual_platform_stats_unlimited(
  uuid,
  public.platform_name,
  integer,
  integer,
  integer,
  timestamptz,
  text,
  timestamptz
) is 'Writes validated administrator-supplied statistics; AtCoder supports both Rating and solved count.';
