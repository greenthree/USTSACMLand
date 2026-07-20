begin;

create extension if not exists pgtap with schema extensions;

select plan(1);

select ok(
  pg_catalog.to_regprocedure('public.admin_read_webchat_pilot_observation()') is null,
  'the retired continuous observation RPC is absent'
);

select * from finish();

rollback;
