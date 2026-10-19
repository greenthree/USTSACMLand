begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

-- Transaction-only synthetic Key; no production credentials or members.
insert into private.firecrawl_api_keys (id, label, vault_secret_id, enabled, priority, health_status)
select '51000000-0000-4000-8000-000000000001', 'Luogu test Key',
  vault.create_secret('fc-luogu-synthetic-key-only', 'luogu-pgtap-only'), true, 1, 'healthy';

select throws_ok(
  $$select * from public.select_firecrawl_runtime_key('luogu', null)$$,
  '22023', 'A valid Firecrawl operation ID is required for LUOGU.',
  'Luogu requires an operation claim'
);

select is(
  (select key_id from public.select_firecrawl_runtime_key('luogu', 'luogu:test:1')),
  '51000000-0000-4000-8000-000000000001'::uuid,
  'Luogu selects the eligible Key'
);

select is(
  (select purpose from private.firecrawl_key_assignments where operation_id = 'luogu:test:1'),
  'luogu', 'the assignment records the correct platform'
);

select throws_ok(
  $$select * from public.select_firecrawl_runtime_key('luogu', 'luogu:test:1')$$,
  '55000', 'This LUOGU operation already claimed a Firecrawl key.',
  'the same attempt cannot select a replacement Key'
);

select public.record_firecrawl_key_observation(
  '51000000-0000-4000-8000-000000000001', 'luogu', false, 'rate_limited'
);
select is(
  (select health_status from private.firecrawl_api_keys where id = '51000000-0000-4000-8000-000000000001'),
  'rate_limited', 'Luogu observations use the existing Key health policy'
);
select ok(
  (select cooldown_until > now() from private.firecrawl_api_keys where id = '51000000-0000-4000-8000-000000000001'),
  'rate-limited Keys enter cooldown'
);
select is(
  (select key_id from public.select_firecrawl_runtime_key('luogu', 'luogu:test:2')),
  null::uuid, 'an exhausted configured pool returns no Key'
);
select throws_ok(
  $$select * from public.select_firecrawl_runtime_key('luogu', 'luogu:test:2')$$,
  '55000', 'This LUOGU operation already claimed a Firecrawl key.',
  'a failed selection also consumes the attempt claim'
);

select public.record_firecrawl_key_observation(
  '51000000-0000-4000-8000-000000000001', 'luogu', true
);
select is(
  (select health_status from private.firecrawl_api_keys where id = '51000000-0000-4000-8000-000000000001'),
  'healthy', 'successful Luogu requests restore Key health'
);
select is(
  (select key_id from public.select_firecrawl_runtime_key('qoj', 'qoj:luogu-regression:1')),
  '51000000-0000-4000-8000-000000000001'::uuid,
  'QOJ selection remains compatible'
);
select ok(
  not has_function_privilege('anon', 'public.select_firecrawl_runtime_key(text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_firecrawl_key_observation(uuid,text,boolean,text,bigint,bigint,timestamptz,text)', 'execute'),
  'extending the allowlist preserves browser role restrictions'
);
select ok(
  has_function_privilege('service_role', 'public.select_firecrawl_runtime_key(text,text)', 'execute'),
  'the runtime entry remains service-only'
);

select * from finish();
rollback;
