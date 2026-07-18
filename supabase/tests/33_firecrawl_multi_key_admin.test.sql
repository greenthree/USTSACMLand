begin;

create extension if not exists pgtap with schema extensions;

select plan(51);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000331',
    'authenticated', 'authenticated', 'firecrawl-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Firecrawl Admin"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000332',
    'authenticated', 'authenticated', 'firecrawl-member@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Firecrawl Member"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  qq = case id
    when '00000000-0000-4000-8000-000000000331' then '16666660001'
    else '16666660002'
  end,
  full_name = case id
    when '00000000-0000-4000-8000-000000000331' then 'Firecrawl Admin'
    else 'Firecrawl Member'
  end,
  grade = '24级',
  major = '计算机科学与技术',
  role = case id
    when '00000000-0000-4000-8000-000000000331' then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = 'approved',
  approved_at = now()
where id in (
  '00000000-0000-4000-8000-000000000331',
  '00000000-0000-4000-8000-000000000332'
);

create temporary table firecrawl_fixture (
  fixture_name text primary key,
  key_id uuid not null,
  secret_id uuid
) on commit drop;

grant select on firecrawl_fixture to authenticated;

select has_table('private', 'firecrawl_api_keys', 'the private Firecrawl key table exists');

select has_table(
  'private',
  'firecrawl_key_assignments',
  'the private one-shot Firecrawl assignment table exists'
);

select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'private.firecrawl_api_keys'::regclass),
  true,
  'the private Firecrawl key table has row-level security enabled'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policy
    where polrelid in (
      'private.firecrawl_api_keys'::regclass,
      'private.firecrawl_key_assignments'::regclass
    )
  ),
  0,
  'private Firecrawl tables expose no permissive RLS policy'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'private.firecrawl_api_keys', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'private.firecrawl_api_keys', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'private.firecrawl_api_keys', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'private.firecrawl_api_keys', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'private.firecrawl_api_keys', 'DELETE'),
  'browser roles have no direct Firecrawl key table privileges'
);

select ok(
  not pg_catalog.has_table_privilege('service_role', 'private.firecrawl_api_keys', 'SELECT')
    and not pg_catalog.has_table_privilege('service_role', 'private.firecrawl_api_keys', 'UPDATE')
    and not pg_catalog.has_table_privilege('service_role', 'private.firecrawl_key_assignments', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'private.firecrawl_key_assignments', 'SELECT'),
  'the service role must use bounded Firecrawl RPCs instead of the private table'
);

select ok(
  pg_catalog.has_function_privilege('service_role', 'public.admin_list_firecrawl_api_keys(uuid)', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.admin_upsert_firecrawl_api_key(uuid,uuid,text,text,boolean,integer,bigint,text)', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.admin_delete_firecrawl_api_key(uuid,uuid,bigint,text)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', 'public.admin_list_firecrawl_api_keys(uuid)', 'EXECUTE'),
  'administrator Firecrawl RPCs are service-role-only'
);

select ok(
  pg_catalog.has_function_privilege('service_role', 'public.select_firecrawl_runtime_key(text,text)', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.list_firecrawl_runtime_keys()', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.read_firecrawl_runtime_key(uuid)', 'EXECUTE')
    and pg_catalog.has_function_privilege('service_role', 'public.record_firecrawl_key_observation(uuid,text,boolean,text,bigint,bigint,timestamptz,text)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', 'public.select_firecrawl_runtime_key(text,text)', 'EXECUTE'),
  'decrypted runtime key RPCs are service-role-only'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT'),
  'browser roles cannot inspect Vault secrets'
);

select throws_ok(
  $$
    select * from public.admin_upsert_firecrawl_api_key(
      '00000000-0000-4000-8000-000000000332', null, 'Forbidden',
      'fc-member-key-aaaaaaaaaaaa', false, 100, null, 'member cannot configure keys'
    )
  $$,
  '42501',
  'Administrator access required.',
  'a member cannot be smuggled through the service-role administrator RPC'
);

select throws_ok(
  $$
    select * from public.admin_upsert_firecrawl_api_key(
      '00000000-0000-4000-8000-000000000331', null, 'Untested enabled',
      'fc-untested-key-aaaaaaaaaa', true, 100, null, 'must be checked first'
    )
  $$,
  '22023',
  'A new Firecrawl key must pass a health check before it can be enabled.',
  'a new untested Key cannot be enabled immediately'
);

select throws_ok(
  $$select * from public.select_firecrawl_runtime_key(null, null)$$,
  '22023',
  'Unsupported Firecrawl key purpose.',
  'a NULL runtime purpose cannot bypass the allowlist'
);

select throws_ok(
  $$select public.record_firecrawl_key_observation(null, null, true, null, null, null, null, null)$$,
  '22023',
  'Unsupported Firecrawl observation purpose.',
  'a NULL observation purpose cannot bypass the allowlist'
);

select throws_ok(
  $$select * from public.select_firecrawl_runtime_key('qoj', null)$$,
  '22023',
  'A valid Firecrawl operation ID is required for QOJ.',
  'QOJ cannot claim a Key without a stable operation ID'
);

with created as (
  select * from public.admin_upsert_firecrawl_api_key(
    '00000000-0000-4000-8000-000000000331', null, 'Primary pool',
    'fc-primary-key-aaaaaaaaaaaa', false, 100, null, 'create primary pool key'
  )
)
insert into firecrawl_fixture (fixture_name, key_id, secret_id)
select 'primary', created.id, null
from created;

update firecrawl_fixture as fixture
set secret_id = config.vault_secret_id
from private.firecrawl_api_keys as config
where fixture.fixture_name = 'primary'
  and config.id = fixture.key_id;

select is(
  (select count(*)::integer from private.firecrawl_api_keys),
  1,
  'creating a Key stores one private metadata row'
);

select is(
  (
    select secret.decrypted_secret
    from firecrawl_fixture as fixture
    join vault.decrypted_secrets as secret on secret.id = fixture.secret_id
    where fixture.fixture_name = 'primary'
  ),
  'fc-primary-key-aaaaaaaaaaaa',
  'the API Key value is stored only in Vault'
);

select ok(
  (
    select pg_catalog.to_jsonb(listed)::text
    from public.admin_list_firecrawl_api_keys('00000000-0000-4000-8000-000000000331') as listed
    where listed.label = 'Primary pool'
  ) !~ '(fc-primary|vault_secret|api_key)',
  'the administrator list returns only redacted Key metadata'
);

select ok(
  not exists (
    select 1 from public.audit_logs as log
    where log.target_table = 'firecrawl_api_keys'
      and (coalesce(log.before_data, '{}'::jsonb) || coalesce(log.after_data, '{}'::jsonb) || log.metadata)::text
        like '%fc-primary-key-aaaaaaaaaaaa%'
  ),
  'creation audit data never copies the API Key'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'poolConfigured', selected.pool_configured,
      'keyId', selected.key_id,
      'apiKey', selected.api_key
    )
    from public.select_firecrawl_runtime_key('qoj', 'qoj:disabled:1') as selected
  ),
  '{"apiKey": null, "keyId": null, "poolConfigured": true}'::jsonb,
  'a configured but disabled pool suppresses the legacy environment fallback'
);

select public.record_firecrawl_key_observation(
  (select key_id from firecrawl_fixture where fixture_name = 'primary'),
  'admin_check', true, null, 409, 1000, '2026-07-24T12:37:07.733Z', null
);

select is(
  (select version from private.firecrawl_api_keys where id = (select key_id from firecrawl_fixture where fixture_name = 'primary')),
  0::bigint,
  'runtime health observations do not advance the administrator configuration version'
);

select is(
  (
    select pg_catalog.jsonb_build_object(
      'health', health_status,
      'remaining', credits_remaining,
      'total', credits_total,
      'failures', consecutive_failures
    )
    from private.firecrawl_api_keys
    where id = (select key_id from firecrawl_fixture where fixture_name = 'primary')
  ),
  '{"health": "healthy", "remaining": 409, "total": 1000, "failures": 0}'::jsonb,
  'a successful check stores sanitized health and quota fields'
);

select is(
  (
    select enabled
    from public.admin_upsert_firecrawl_api_key(
      '00000000-0000-4000-8000-000000000331',
      (select key_id from firecrawl_fixture where fixture_name = 'primary'),
      'Primary pool', null, true, 100, 0, 'enable checked primary key'
    )
  ),
  true,
  'a successfully checked Key can be enabled with optimistic locking'
);

select is(
  (select key_id from public.select_firecrawl_runtime_key('qoj', 'qoj:primary:1')),
  (select key_id from firecrawl_fixture where fixture_name = 'primary'),
  'runtime selection returns the only enabled Key'
);

select throws_ok(
  $$select * from public.select_firecrawl_runtime_key('qoj', 'qoj:primary:1')$$,
  '55000',
  'This QOJ operation already claimed a Firecrawl key.',
  'the same QOJ operation cannot claim a replacement Key'
);

select is(
  (select api_key from public.read_firecrawl_runtime_key((select key_id from firecrawl_fixture where fixture_name = 'primary'))),
  'fc-primary-key-aaaaaaaaaaaa',
  'the bounded runtime RPC can decrypt the selected Key for the Edge runtime'
);

select isnt(
  (select last_selected_at from private.firecrawl_api_keys where id = (select key_id from firecrawl_fixture where fixture_name = 'primary')),
  null::timestamptz,
  'selection records least-recent-use state without changing the config version'
);

with created as (
  select * from public.admin_upsert_firecrawl_api_key(
    '00000000-0000-4000-8000-000000000331', null, 'Priority pool',
    'fc-priority-key-bbbbbbbbbbb', false, 50, null, 'create priority key'
  )
)
insert into firecrawl_fixture (fixture_name, key_id, secret_id)
select 'priority', created.id, null
from created;

update firecrawl_fixture as fixture
set secret_id = config.vault_secret_id
from private.firecrawl_api_keys as config
where fixture.fixture_name = 'priority'
  and config.id = fixture.key_id;

select is(
  (select count(*)::integer from private.firecrawl_api_keys),
  2,
  'a second independent Vault-backed Key can be configured'
);

select public.record_firecrawl_key_observation(
  (select key_id from firecrawl_fixture where fixture_name = 'priority'),
  'admin_check', true, null, 900, 1000, null, null
);
select * from public.admin_upsert_firecrawl_api_key(
  '00000000-0000-4000-8000-000000000331',
  (select key_id from firecrawl_fixture where fixture_name = 'priority'),
  'Priority pool', null, true, 50, 0, 'enable checked priority key'
);

select is(
  (select enabled from private.firecrawl_api_keys where id = (select key_id from firecrawl_fixture where fixture_name = 'priority')),
  true,
  'the second checked Key can be enabled independently'
);

with created as (
  select * from public.admin_upsert_firecrawl_api_key(
    '00000000-0000-4000-8000-000000000331', null, 'Exhausted pool',
    'fc-exhausted-key-fffffffff', false, 25, null, 'create quota exhaustion fixture'
  )
)
insert into firecrawl_fixture (fixture_name, key_id, secret_id)
select 'exhausted', created.id, null
from created;

update firecrawl_fixture as fixture
set secret_id = config.vault_secret_id
from private.firecrawl_api_keys as config
where fixture.fixture_name = 'exhausted'
  and config.id = fixture.key_id;

select public.record_firecrawl_key_observation(
  (select key_id from firecrawl_fixture where fixture_name = 'exhausted'),
  'admin_check', true, null, 100, 1000, null, 'critical'
);
select * from public.admin_upsert_firecrawl_api_key(
  '00000000-0000-4000-8000-000000000331',
  (select key_id from firecrawl_fixture where fixture_name = 'exhausted'),
  'Exhausted pool', null, true, 25, 0, 'enable checked exhaustion fixture'
);
select public.record_firecrawl_key_observation(
  (select key_id from firecrawl_fixture where fixture_name = 'exhausted'),
  'credit_monitor', true, null, 0, 1000, null, 'critical'
);

select is(
  (
    select pg_catalog.jsonb_build_object('enabled', enabled, 'remaining', credits_remaining, 'health', health_status)
    from private.firecrawl_api_keys
    where id = (select key_id from firecrawl_fixture where fixture_name = 'exhausted')
  ),
  '{"enabled": true, "health": "critical", "remaining": 0}'::jsonb,
  'a checked Key can record quota exhaustion without being silently marked healthy'
);

select is(
  (select key_id from public.select_firecrawl_runtime_key('nowcoder')),
  (select key_id from firecrawl_fixture where fixture_name = 'priority'),
  'selection skips a zero-credit Key before applying priority and least-recent use'
);

select * from public.admin_upsert_firecrawl_api_key(
  '00000000-0000-4000-8000-000000000331',
  (select key_id from firecrawl_fixture where fixture_name = 'exhausted'),
  'Exhausted pool', null, false, 25, 1, 'disable exhausted key'
);

select throws_ok(
  $$
    select * from public.admin_upsert_firecrawl_api_key(
      '00000000-0000-4000-8000-000000000331',
      (select key_id from firecrawl_fixture where fixture_name = 'exhausted'),
      'Exhausted pool', null, true, 25, 2, 'reject exhausted reenable'
    )
  $$,
  '22023',
  'Only a successfully checked Firecrawl key can be enabled.',
  'an exhausted Key cannot be re-enabled without a fresh positive quota check'
);

select public.record_firecrawl_key_observation(
  (select key_id from firecrawl_fixture where fixture_name = 'priority'),
  'nowcoder', false, 'auth_expired', null, null, null, null
);

select is(
  (select health_status from private.firecrawl_api_keys where id = (select key_id from firecrawl_fixture where fixture_name = 'priority')),
  'auth_failed',
  'an authenticated Firecrawl rejection quarantines that Key for later tasks'
);

select is(
  (select key_id from public.select_firecrawl_runtime_key('qoj', 'qoj:after-auth:1')),
  (select key_id from firecrawl_fixture where fixture_name = 'primary'),
  'a later task skips an auth-failed Key and selects a healthy Key'
);

select is(
  (
    select config.vault_secret_id
    from public.admin_upsert_firecrawl_api_key(
      '00000000-0000-4000-8000-000000000331',
      (select key_id from firecrawl_fixture where fixture_name = 'primary'),
      'Primary pool', 'fc-primary-rotated-cccccccc', false, 100, 1,
      'rotate primary key after scheduled handoff'
    ) as updated
    join private.firecrawl_api_keys as config on config.id = updated.id
  ),
  (select secret_id from firecrawl_fixture where fixture_name = 'primary'),
  'rotation updates the existing Vault secret instead of creating a second secret'
);

select is(
  (
    select secret.decrypted_secret
    from firecrawl_fixture as fixture
    join vault.decrypted_secrets as secret on secret.id = fixture.secret_id
    where fixture.fixture_name = 'primary'
  ),
  'fc-primary-rotated-cccccccc',
  'rotation replaces the encrypted value'
);

select is(
  (
    select pg_catalog.jsonb_build_object('enabled', enabled, 'health', health_status, 'version', version)
    from private.firecrawl_api_keys
    where id = (select key_id from firecrawl_fixture where fixture_name = 'primary')
  ),
  '{"enabled": false, "health": "unknown", "version": 2}'::jsonb,
  'rotation forces the Key offline and resets health before reuse'
);

select throws_ok(
  $$
    select * from public.admin_upsert_firecrawl_api_key(
      '00000000-0000-4000-8000-000000000331',
      (select key_id from firecrawl_fixture where fixture_name = 'primary'),
      'Primary stale', 'fc-stale-key-dddddddddddd', false, 100, 1, 'stale rotation'
    )
  $$,
  '40001',
  'Firecrawl key changed after it was loaded.',
  'a stale editor cannot rotate a newer Vault key'
);

select is(
  (
    select secret.decrypted_secret
    from firecrawl_fixture as fixture
    join vault.decrypted_secrets as secret on secret.id = fixture.secret_id
    where fixture.fixture_name = 'primary'
  ),
  'fc-primary-rotated-cccccccc',
  'an optimistic-lock rejection preserves the current Vault value'
);

select throws_ok(
  $$
    select * from public.admin_upsert_firecrawl_api_key(
      '00000000-0000-4000-8000-000000000331',
      (select key_id from firecrawl_fixture where fixture_name = 'primary'),
      'Primary pool', null, false, 100, 2, 'no effective change'
    )
  $$,
  '22023',
  'At least one Firecrawl key field must change.',
  'a metadata no-op cannot create a misleading audit event'
);

select throws_ok(
  $$
    select * from public.admin_upsert_firecrawl_api_key(
      '00000000-0000-4000-8000-000000000331', null, 'priority POOL',
      'fc-duplicate-key-eeeeeeeeee', false, 200, null, 'duplicate label check'
    )
  $$,
  '23505',
  'A Firecrawl key with this label already exists.',
  'Key labels are unique without case ambiguity'
);

select throws_ok(
  $$
    select public.record_firecrawl_key_observation(
      (select key_id from firecrawl_fixture where fixture_name = 'primary'),
      'admin_check', true, null, 1200, 1000, null, 'critical'
    )
  $$,
  '22023',
  'Firecrawl credit severity is invalid.',
  'a caller cannot forge a severity that contradicts the observed quota'
);

select public.record_firecrawl_key_observation(
  (select key_id from firecrawl_fixture where fixture_name = 'primary'),
  'admin_check', true, null, 1200, 1000, null, null
);

select is(
  (
    select pg_catalog.jsonb_build_object('remaining', credits_remaining, 'total', credits_total, 'health', health_status)
    from private.firecrawl_api_keys
    where id = (select key_id from firecrawl_fixture where fixture_name = 'primary')
  ),
  '{"remaining": 1200, "total": 1000, "health": "healthy"}'::jsonb,
  'provider bonuses above plan credits are accepted without a false low-credit severity'
);

select is(
  public.admin_delete_firecrawl_api_key(
    '00000000-0000-4000-8000-000000000331',
    (select key_id from firecrawl_fixture where fixture_name = 'priority'),
    1,
    'retire rejected priority key'
  ),
  (select key_id from firecrawl_fixture where fixture_name = 'priority'),
  'deletion returns the removed Key ID'
);

select is(
  (select count(*)::integer from private.firecrawl_api_keys where id = (select key_id from firecrawl_fixture where fixture_name = 'priority')),
  0,
  'deletion removes private Key metadata'
);

select is(
  (select count(*)::integer from vault.secrets where id = (select secret_id from firecrawl_fixture where fixture_name = 'priority')),
  0,
  'deletion also removes the corresponding Vault secret'
);

select ok(
  exists (
    select 1 from public.audit_logs as log
    where log.action = 'firecrawl_api_key_delete'
      and log.metadata ->> 'reason' = 'retire rejected priority key'
  ),
  'destructive Key changes retain the bounded administrator reason'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000331',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000331","role":"authenticated"}',
  true
);

select ok(
  exists (
    select 1
    from public.admin_list_audit_logs(100, null) as entry
    where entry.action = 'firecrawl_api_key_delete'
      and entry.target_label = 'Priority pool'
      and entry.details ->> 'reason' = 'retire rejected priority key'
      and entry.details::text !~ '(apiKey|vault|fc-priority)'
  ),
  'the browser audit projection shows the Key label and reason without secret material'
);

set local role authenticated;
select throws_ok(
  $$select * from public.read_firecrawl_runtime_key(
    (select key_id from firecrawl_fixture where fixture_name = 'primary')
  )$$,
  '42501',
  null,
  'an authenticated browser cannot invoke a decrypted runtime Key RPC'
);
reset role;

select is(
  (
    select pg_catalog.jsonb_build_object(
      'poolConfigured', listed.pool_configured,
      'keyId', listed.key_id,
      'apiKey', listed.api_key
    )
    from public.list_firecrawl_runtime_keys() as listed
  ),
  '{"apiKey": null, "keyId": null, "poolConfigured": true}'::jsonb,
  'an existing pool with no enabled usable Key never falls back to an environment secret'
);

select ok(
  not exists (
    select 1 from public.audit_logs as log
    where log.target_table = 'firecrawl_api_keys'
      and (coalesce(log.before_data, '{}'::jsonb) || coalesce(log.after_data, '{}'::jsonb) || log.metadata)::text
        ~ '(fc-primary|fc-priority|fc-stale|fc-duplicate)'
  ),
  'the entire Firecrawl administration audit remains free of raw Key material'
);

delete from auth.users where id = '00000000-0000-4000-8000-000000000331';

select is(
  (
    select pg_catalog.jsonb_build_object('createdBy', created_by, 'updatedBy', updated_by)
    from private.firecrawl_api_keys
    where id = (select key_id from firecrawl_fixture where fixture_name = 'primary')
  ),
  '{"createdBy": null, "updatedBy": null}'::jsonb,
  'deleting an administrator clears retained creator and updater identifiers'
);

select * from finish();

rollback;
