begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

-- Seven eligible synthetic Keys deliberately have different priorities.
insert into private.firecrawl_api_keys (
  id, label, vault_secret_id, enabled, priority, health_status
)
select ('53000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'Rotation test Key ' || i,
  vault.create_secret('fc-rotation-synthetic-' || i, 'rotation-pgtap-' || i),
  true, i, 'healthy'
from generate_series(1, 7) i;

-- These must remain ineligible even with the best priority / oldest last use.
insert into private.firecrawl_api_keys (
  label, vault_secret_id, enabled, priority, health_status, cooldown_until,
  credits_remaining, credits_total
)
values
  ('Rotation disabled', vault.create_secret('fc-disabled-synthetic'), false, 1, 'healthy', null, 100, 100),
  ('Rotation cooling', vault.create_secret('fc-cooling-synthetic'), true, 1, 'rate_limited', now() + interval '1 hour', 100, 100),
  ('Rotation invalid', vault.create_secret('fc-invalid-synthetic'), true, 1, 'auth_failed', null, 100, 100),
  ('Rotation empty', vault.create_secret('fc-empty-synthetic'), true, 1, 'healthy', null, 0, 100);

create temporary table rotation_claims (request_number integer, selected_key_id uuid);
do $$
begin
  for i in 1..14 loop
    insert into rotation_claims
    select i, key_id
    from public.select_firecrawl_runtime_key('luogu', 'luogu:rotation:request:' || i);
  end loop;
end;
$$;

select is((select count(*) from rotation_claims), 14::bigint, 'fourteen requests each claim one Key');
select is(
  (select count(distinct selected_key_id) from rotation_claims where request_number <= 7),
  7::bigint, 'all seven priorities rotate before any Key is reused'
);
select results_eq(
  $$select request_number, selected_key_id from rotation_claims order by request_number$$,
  $$select i, ('53000000-0000-4000-8000-' || lpad((((i - 1) % 7) + 1)::text, 12, '0'))::uuid
    from generate_series(1, 14) i$$,
  'two complete rotations use last-selection time before configured priority'
);
select is(
  (select count(*) from private.firecrawl_key_assignments where operation_id like 'luogu:rotation:request:%' and purpose = 'luogu'),
  14::bigint, 'each request has a durable Luogu assignment'
);
select ok(
  not exists (
    select 1 from rotation_claims
    where selected_key_id not in (
      select id from private.firecrawl_api_keys where label like 'Rotation test Key %'
    ) or selected_key_id is null
  ), 'disabled, cooling, invalid and empty Keys are skipped'
);
select throws_ok(
  $$select * from public.select_firecrawl_runtime_key('luogu', 'luogu:rotation:request:1')$$,
  '55000', 'This LUOGU operation already claimed a Firecrawl key.',
  'replaying one request cannot select another Key'
);

select is(
  (select key_id from public.select_firecrawl_runtime_key('qoj', 'qoj:rotation:attempt:1')),
  '53000000-0000-4000-8000-000000000001'::uuid,
  'QOJ still uses configured priority before last use'
);
select throws_ok(
  $$select * from public.select_firecrawl_runtime_key('qoj', 'qoj:rotation:attempt:1')$$,
  '55000', 'This QOJ operation already claimed a Firecrawl key.',
  'QOJ cannot switch Keys within an attempt'
);
select is(
  (select key_id from public.select_firecrawl_runtime_key('nowcoder')),
  '53000000-0000-4000-8000-000000000001'::uuid,
  'Nowcoder still uses configured priority'
);

select public.record_firecrawl_key_observation(
  '53000000-0000-4000-8000-000000000002', 'luogu', false, 'rate_limited'
);
select is(
  (select health_status from private.firecrawl_api_keys where id = '53000000-0000-4000-8000-000000000002'),
  'rate_limited', 'the limited Key retains its own failure state'
);
select ok(
  (select cooldown_until > now() from private.firecrawl_api_keys where id = '53000000-0000-4000-8000-000000000002'),
  'a limited Key enters cooldown'
);
select is(
  (select key_id from public.select_firecrawl_runtime_key('luogu', 'luogu:other-attempt:request:1')),
  '53000000-0000-4000-8000-000000000003'::uuid,
  'a later independent request skips the cooling Key'
);

update private.firecrawl_api_keys set enabled = false;
select ok(
  (select pool_configured and key_id is null and api_key is null
    from public.select_firecrawl_runtime_key('luogu', 'luogu:empty:request:1')),
  'an exhausted configured pool returns no credential'
);
select throws_ok(
  $$select * from public.select_firecrawl_runtime_key('luogu', 'luogu:empty:request:1')$$,
  '55000', 'This LUOGU operation already claimed a Firecrawl key.',
  'a failed selection also consumes only that request claim'
);
select throws_ok(
  $$select * from public.select_firecrawl_runtime_key('luogu', null)$$,
  '22023', 'A valid Firecrawl operation ID is required for LUOGU.',
  'request rotation still requires an operation ID'
);
select ok(
  not has_function_privilege('anon', 'public.select_firecrawl_runtime_key(text,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.select_firecrawl_runtime_key(text,text)', 'execute')
    and has_function_privilege('service_role', 'public.select_firecrawl_runtime_key(text,text)', 'execute'),
  'the selector remains service-only'
);
select is(
  (select count(*) from private.firecrawl_api_keys where label like 'Rotation test Key %'),
  7::bigint, 'rotation does not remove configured Keys'
);
select ok(
  not has_table_privilege('service_role', 'private.firecrawl_api_keys', 'select')
    and not has_table_privilege('authenticated', 'private.firecrawl_key_assignments', 'select'),
  'private Key metadata and claims remain inaccessible to browser roles'
);

select * from finish();
rollback;
