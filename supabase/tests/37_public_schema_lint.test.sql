begin;

select plan(2);

select is(
  (
    select procedure.provolatile
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'read_daily_problem_feed'
      and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'row_limit integer, before_problem_date date'
  ),
  'v'::"char",
  'daily problem feed is volatile because it reads the wall clock and request identity'
);

select is(
  (
    select procedure.provolatile
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'list_daily_problem_comments'
      and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'target_problem_id bigint, row_limit integer, before_comment_id bigint'
  ),
  'v'::"char",
  'daily problem comments reader is volatile because it reads the wall clock and request identity'
);

select * from finish();
rollback;
