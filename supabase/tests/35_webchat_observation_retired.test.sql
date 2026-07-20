begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select ok(
  pg_catalog.to_regprocedure('public.admin_read_webchat_pilot_observation()') is null,
  'the continuous pilot observation RPC is retired'
);

select ok(
  pg_catalog.to_regprocedure('public.admin_get_webchat_member_policy(uuid)') is null,
  'the pilot-aware member policy reader is retired'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.admin_update_webchat_member_policy(uuid,boolean,boolean,integer,bigint,bigint,text)'
  ) is null,
  'the pilot-aware member policy writer is retired'
);

select ok(
  pg_catalog.to_regclass('private.webchat_pilot_observation_state') is null,
  'the private observation clock is removed'
);

select ok(
  pg_catalog.to_regclass('private.webchat_member_access_pilot_roster_idx') is null,
  'the formal roster index is removed'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_definition
    where constraint_definition.conrelid = 'private.webchat_member_access'::regclass
      and constraint_definition.conname = 'webchat_member_access_pilot_retired'
      and pg_catalog.pg_get_constraintdef(constraint_definition.oid)
        like '%NOT pilot_observation_enabled%'
  ),
  'the compatibility column is permanently constrained to false'
);

select throws_like(
  $$
    insert into private.webchat_member_access (
      user_id, access_enabled, pilot_observation_enabled,
      total_request_limit, total_token_limit
    ) values (
      '00000000-0000-0000-0000-000000003501', true, true, 30, 100000
    )
  $$,
  '%webchat_member_access_pilot_retired%',
  'direct writes cannot recreate a formal observation member'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.admin_update_webchat_member_access(uuid,boolean,integer,bigint,bigint,text)',
    'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon',
      'public.admin_update_webchat_member_access(uuid,boolean,integer,bigint,bigint,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'public.admin_update_webchat_member_access(uuid,boolean,integer,bigint,bigint,text)',
      'EXECUTE'
    ),
  'ordinary authenticated sessions retain only the administrator-checked access boundary'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.admin_update_webchat_member_access(uuid,boolean,integer,bigint,bigint,text)'::regprocedure
    ),
    'pilot_observation_enabled = false'
  ) > 0,
  'member access updates keep the retired compatibility flag disabled'
);

select * from finish();

rollback;
