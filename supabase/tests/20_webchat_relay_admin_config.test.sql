begin;

create extension if not exists pgtap with schema extensions;

select plan(42);

select has_table(
  'private',
  'webchat_relay_config',
  'the private WebChat relay configuration singleton exists'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'webchat_relay_config'
  ),
  'row level security is enabled on the private relay configuration'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'private'
      and tablename = 'webchat_relay_config'
  ),
  0,
  'the private relay configuration has no browser-facing RLS policies'
);

select ok(
  not pg_catalog.has_table_privilege(
    'anon', 'private.webchat_relay_config', 'SELECT'
  )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'private.webchat_relay_config', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.webchat_relay_config', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'service_role', 'private.webchat_relay_config', 'UPDATE'
    ),
  'application roles cannot read or forge the private singleton directly'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'vault.secrets', 'SELECT')
    and not pg_catalog.has_table_privilege('authenticated', 'vault.secrets', 'SELECT')
    and not pg_catalog.has_table_privilege(
      'anon', 'vault.decrypted_secrets', 'SELECT'
    )
    and not pg_catalog.has_table_privilege(
      'authenticated', 'vault.decrypted_secrets', 'SELECT'
    ),
  'browser roles cannot query encrypted or decrypted Vault relations directly'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'vault.create_secret(text,text,text,uuid)', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
    'authenticated', 'vault.create_secret(text,text,text,uuid)', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'anon', 'vault.update_secret(uuid,text,text,text,uuid)', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated', 'vault.update_secret(uuid,text,text,text,uuid)', 'EXECUTE'
    ),
  'browser roles cannot create or rotate Vault secrets directly'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.read_webchat_relay_config()', 'EXECUTE'
  )
    and not pg_catalog.has_function_privilege(
      'authenticated', 'public.read_webchat_relay_config()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated', 'public.read_webchat_relay_runtime_config()', 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.admin_update_webchat_relay_config(uuid,text,text,text,bigint,text,boolean,integer,bigint)',
      'EXECUTE'
    ),
  'browser roles cannot call relay configuration RPCs'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.read_webchat_relay_config()', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'service_role', 'public.read_webchat_relay_runtime_config()', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role',
      'public.admin_update_webchat_relay_config(uuid,text,text,text,bigint,text,boolean,integer,bigint)',
      'EXECUTE'
    ),
  'the service role can call the three bounded relay configuration RPCs'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'read_webchat_relay_config',
        'read_webchat_relay_runtime_config',
        'admin_update_webchat_relay_config'
      ])
      and not procedure.prosecdef
  ),
  'all relay configuration RPCs are SECURITY DEFINER functions'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'read_webchat_relay_config',
        'read_webchat_relay_runtime_config',
        'admin_update_webchat_relay_config'
      ])
      and coalesce(procedure.proconfig::text, '') not like '%search_path=%'
  ),
  'all relay configuration RPCs pin their search path'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002001',
    'authenticated', 'authenticated', 'relay-admin@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Relay Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002002',
    'authenticated', 'authenticated', 'relay-member@example.test', 'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Relay Member"}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000002003',
    'authenticated', 'authenticated', 'relay-suspended-admin@example.test',
    'test-password', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Suspended Relay Administrator"}'::jsonb,
    now(), now(), '', '', '', ''
  );

update public.profiles
set
  role = case
    when id in (
      '00000000-0000-0000-0000-000000002001',
      '00000000-0000-0000-0000-000000002003'
    )
      then 'admin'::public.app_role
    else 'member'::public.app_role
  end,
  review_status = case
    when id = '00000000-0000-0000-0000-000000002003'
      then 'suspended'::public.profile_review_status
    else 'approved'::public.profile_review_status
  end,
  approved_at = case
    when id = '00000000-0000-0000-0000-000000002003' then null
    else now()
  end
where id in (
  '00000000-0000-0000-0000-000000002001',
  '00000000-0000-0000-0000-000000002002',
  '00000000-0000-0000-0000-000000002003'
);

delete from vault.secrets where name = 'webchat_relay_api_key';

set local role service_role;

select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002002',
      'https://relay.example.test/v1',
      'gpt-5.6',
      'test_key_cccccccccccccccc',
      0,
      'Member configuration attempt'
    )
  $$,
  '42501',
  'Administrator access required.',
  'an ordinary member cannot update the relay configuration through service-side delegation'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002003',
      'https://relay.example.test/v1',
      'gpt-5.6',
      'test_key_dddddddddddddddd',
      0,
      'Suspended administrator attempt'
    )
  $$,
  '42501',
  'Administrator access required.',
  'a suspended administrator cannot update relay configuration'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002001',
      'https://a',
      'gpt-5.6',
      'test_key_eeeeeeeeeeeeeeee',
      0,
      'Reject undersized URL'
    )
  $$,
  '22023',
  'Relay base URL must be a credential-free HTTPS API root without query, fragment, or /responses suffix.',
  'relay URL validation rejects values outside the table constraint boundary'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002001',
      'https://relay.example.test/v1',
      'bad model',
      'test_key_ffffffffffffffff',
      0,
      'Reject invalid model'
    )
  $$,
  '22023',
  'Relay model has an invalid format.',
  'relay model validation rejects whitespace and unsupported characters'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002001',
      'https://relay.example.test/v1',
      'gpt-5.6',
      '   ',
      0,
      'Reject empty replacement key'
    )
  $$,
  '22023',
  'Replacement API key cannot be empty.',
  'an explicitly supplied replacement key cannot normalize to empty'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002001',
      'https://relay.example.test/v1',
      'gpt-5.6',
      'short',
      0,
      'Reject short replacement key'
    )
  $$,
  '22023',
  'Replacement API key has an invalid format.',
  'replacement API keys enforce the bounded non-whitespace format'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002001',
      'https://relay.example.test/v1',
      'gpt-5.6',
      'test_key_gggggggggggggggg',
      null,
      'Reject missing version'
    )
  $$,
  '22004',
  'Expected configuration version is required.',
  'an optimistic-lock version is mandatory'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002001',
      'https://relay.example.test/v1',
      'gpt-5.6',
      'test_key_hhhhhhhhhhhhhhhh',
      0,
      'x'
    )
  $$,
  '22023',
  'Configuration change reason must contain at least 3 characters.',
  'configuration changes require a bounded audit reason'
);

select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002001',
      'https://relay.example.test/v1',
      'gpt-5.6',
      null,
      0,
      'Configure metadata without a key'
    )
  $$,
  '22023',
  'A replacement API key is required until the relay secret is configured.',
  'the first relay configuration cannot commit without a valid Vault secret'
);

create temporary table relay_initial_update as
select * from public.admin_update_webchat_relay_config(
  '00000000-0000-0000-0000-000000002001',
  'https://relay.example.test/v1',
  'gpt-5.6',
  'test_key_iiiiiiiiiiiiiiii',
  0,
  'Configure the initial relay'
);

create temporary table relay_redacted_read as
select pg_catalog.to_jsonb(config) as payload
from public.read_webchat_relay_config() as config;

create temporary table relay_runtime_read as
select * from public.read_webchat_relay_runtime_config();

reset role;

select ok(
  exists (
    select 1
    from relay_initial_update
    where base_url = 'https://relay.example.test/v1'
      and model = 'gpt-5.6'
      and api_key_configured
      and version = 1
  ),
  'the initial administrator update returns redacted versioned metadata'
);

select ok(
  exists (
    select 1
    from private.webchat_relay_config
    where singleton
      and base_url = 'https://relay.example.test/v1'
      and model = 'gpt-5.6'
      and api_key_secret_id is not null
      and version = 1
      and updated_by = '00000000-0000-0000-0000-000000002001'
  ),
  'the private singleton stores metadata and only a Vault reference'
);

select ok(
  exists (
    select 1
    from private.webchat_relay_config as config
    join vault.decrypted_secrets as secret on secret.id = config.api_key_secret_id
    where config.singleton
      and secret.name = 'webchat_relay_api_key'
      and secret.description = 'USTS ACM Land WebChat relay API key'
      and secret.decrypted_secret = 'test_key_iiiiiiiiiiiiiiii'
  ),
  'the first update creates the named Vault secret with the supplied key'
);

select ok(
  exists (
    select 1
    from relay_redacted_read
    where payload ->> 'base_url' = 'https://relay.example.test/v1'
      and payload ->> 'model' = 'gpt-5.6'
      and (payload ->> 'api_key_configured')::boolean
      and not payload ? 'api_key'
      and payload::text not like '%test_key_iiiiiiii%'
  ),
  'the administrative reader returns configuration state without an API key field or value'
);

select ok(
  exists (
    select 1
    from relay_runtime_read
    where base_url = 'https://relay.example.test/v1'
      and model = 'gpt-5.6'
      and api_key = 'test_key_iiiiiiiiiiiiiiii'
      and version = 1
  ),
  'the service-only runtime reader resolves the Vault key for WebChat execution'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where actor_id = '00000000-0000-0000-0000-000000002001'
      and action = 'webchat_relay_config_update'
      and metadata ->> 'reason' = 'Configure the initial relay'
      and before_data = pg_catalog.jsonb_build_object(
        'baseUrl', null,
        'model', null,
        'apiKeyConfigured', false,
        'requestsEnabled', false,
        'globalDailyRequestLimit', 300,
        'globalDailyTokenLimit', 1000000
      )
  ),
  'the initial audit records the true pre-update configuration snapshot'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where actor_id = '00000000-0000-0000-0000-000000002001'
      and action = 'webchat_relay_config_update'
      and metadata ->> 'reason' = 'Configure the initial relay'
      and after_data = pg_catalog.jsonb_build_object(
        'baseUrl', 'https://relay.example.test/v1',
        'model', 'gpt-5.6',
        'apiKeyConfigured', true,
        'requestsEnabled', false,
        'globalDailyRequestLimit', 300,
        'globalDailyTokenLimit', 1000000
      )
  ),
  'the initial audit records the redacted post-update configuration snapshot'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where metadata ->> 'reason' = 'Configure the initial relay'
      and metadata -> 'changedFields' = '["baseUrl", "model", "apiKey"]'::jsonb
      and pg_catalog.concat(before_data, after_data, metadata)
        not like '%test_key_iiiiiiiiiiiiiiii%'
  ),
  'the initial audit lists changed fields without storing the replacement key'
);

create temporary table relay_initial_secret as
select api_key_secret_id as secret_id
from private.webchat_relay_config
where singleton;

set local role service_role;
create temporary table relay_rotated_update as
select * from public.admin_update_webchat_relay_config(
  '00000000-0000-0000-0000-000000002001',
  'https://relay.example.test/v1',
  'gpt-5.6',
  'test_key_jjjjjjjjjjjjjjjj',
  1,
  'Rotate the relay key'
);
reset role;

select ok(
  exists (
    select 1
    from relay_rotated_update
    where api_key_configured and version = 2
  ),
  'key rotation advances the optimistic-lock version'
);

select is(
  (select api_key_secret_id from private.webchat_relay_config where singleton),
  (select secret_id from relay_initial_secret),
  'key rotation updates the existing Vault secret instead of creating a second secret'
);

select is(
  (
    select secret.decrypted_secret
    from vault.decrypted_secrets as secret
    where secret.id = (select secret_id from relay_initial_secret)
  ),
  'test_key_jjjjjjjjjjjjjjjj',
  'the Vault update_secret call rotates the encrypted value'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where metadata ->> 'reason' = 'Rotate the relay key'
      and before_data = pg_catalog.jsonb_build_object(
        'baseUrl', 'https://relay.example.test/v1',
        'model', 'gpt-5.6',
        'apiKeyConfigured', true,
        'requestsEnabled', false,
        'globalDailyRequestLimit', 300,
        'globalDailyTokenLimit', 1000000
      )
  ),
  'rotation audit before_data keeps the pre-rotation metadata and key-presence flag'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where metadata ->> 'reason' = 'Rotate the relay key'
      and after_data = pg_catalog.jsonb_build_object(
        'baseUrl', 'https://relay.example.test/v1',
        'model', 'gpt-5.6',
        'apiKeyConfigured', true,
        'requestsEnabled', false,
        'globalDailyRequestLimit', 300,
        'globalDailyTokenLimit', 1000000
      )
      and metadata -> 'changedFields' = '["apiKey"]'::jsonb
      and pg_catalog.concat(before_data, after_data, metadata)
        not like '%test_key_iiiiiiiiiiiiiiii%'
      and pg_catalog.concat(before_data, after_data, metadata)
        not like '%test_key_jjjjjjjjjjjjjjjj%'
  ),
  'rotation audit is redacted and reports only the API-key field change'
);

set local role service_role;
create temporary table relay_metadata_update as
select * from public.admin_update_webchat_relay_config(
  '00000000-0000-0000-0000-000000002001',
  'https://relay.example.test/v2',
  'gpt-5.6',
  null,
  2,
  'Update relay metadata while retaining the key',
  true,
  200,
  800000
);
reset role;

select ok(
  exists (
    select 1
    from relay_metadata_update
    where base_url = 'https://relay.example.test/v2'
      and api_key_configured
      and requests_enabled
      and global_daily_request_limit = 200
      and global_daily_token_limit = 800000
      and version = 3
  ),
  'metadata can change without supplying a replacement when a valid key already exists'
);

select ok(
  exists (
    select 1
    from private.webchat_relay_config as config
    join vault.decrypted_secrets as secret on secret.id = config.api_key_secret_id
    where config.singleton
      and config.api_key_secret_id = (select secret_id from relay_initial_secret)
      and secret.decrypted_secret = 'test_key_jjjjjjjjjjjjjjjj'
  ),
  'a metadata-only update preserves the existing Vault secret ID and value'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where metadata ->> 'reason' = 'Update relay metadata while retaining the key'
      and metadata -> 'changedFields' = '["baseUrl", "requestsEnabled", "globalDailyRequestLimit", "globalDailyTokenLimit"]'::jsonb
      and before_data ->> 'baseUrl' = 'https://relay.example.test/v1'
      and after_data ->> 'baseUrl' = 'https://relay.example.test/v2'
      and (before_data ->> 'apiKeyConfigured')::boolean
      and (after_data ->> 'apiKeyConfigured')::boolean
      and not (before_data ->> 'requestsEnabled')::boolean
      and (after_data ->> 'requestsEnabled')::boolean
      and (after_data ->> 'globalDailyRequestLimit')::integer = 200
      and (after_data ->> 'globalDailyTokenLimit')::bigint = 800000
  ),
  'metadata-only changes audit the field delta while retaining the redacted key flag'
);

set local role service_role;
select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002001',
      'https://stale-relay.example.test/v1',
      'gpt-5.6',
      'test_key_kkkkkkkkkkkkkkkk',
      1,
      'Reject stale relay editor'
    )
  $$,
  '40001',
  'WebChat relay configuration changed after it was loaded.',
  'stale relay editors cannot rotate Vault or overwrite newer metadata'
);
reset role;

select ok(
  exists (
    select 1
    from private.webchat_relay_config as config
    join vault.decrypted_secrets as secret on secret.id = config.api_key_secret_id
    where config.singleton
      and config.base_url = 'https://relay.example.test/v2'
      and config.version = 3
      and secret.decrypted_secret = 'test_key_jjjjjjjjjjjjjjjj'
  ),
  'an optimistic-lock rejection leaves metadata and the Vault key unchanged'
);

set local role service_role;
select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002001',
      'https://relay.example.test/v2',
      'gpt-5.6',
      null,
      3,
      'No effective relay change',
      true,
      200,
      800000
    )
  $$,
  '22023',
  'At least one relay configuration field must change.',
  'metadata-only no-op updates are rejected without creating an audit row'
);
reset role;

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where action = 'webchat_relay_config_update'
      and actor_id = '00000000-0000-0000-0000-000000002001'
  ),
  3,
  'only the three committed relay changes produce success audit rows'
);

update public.admin_rate_limit_buckets
set
  window_started_at = pg_catalog.clock_timestamp(),
  request_count = 10,
  updated_at = pg_catalog.clock_timestamp()
where actor_id = '00000000-0000-0000-0000-000000002001'
  and action_key = 'webchat_config.write';

set local role service_role;
select throws_ok(
  $$
    select * from public.admin_update_webchat_relay_config(
      '00000000-0000-0000-0000-000000002001',
      'https://rate-limited-relay.example.test/v1',
      'gpt-5.6',
      null,
      3,
      'Rate limited relay change'
    )
  $$,
  'PT429',
  'admin_rate_limited',
  'relay configuration writes use the administrator rate-limit bucket'
);
reset role;

select ok(
  exists (
    select 1
    from private.webchat_relay_config as config
    join vault.decrypted_secrets as secret on secret.id = config.api_key_secret_id
    where config.singleton
      and config.base_url = 'https://relay.example.test/v2'
      and config.version = 3
      and secret.decrypted_secret = 'test_key_jjjjjjjjjjjjjjjj'
  ),
  'rate-limit rejection leaves relay metadata and the Vault key unchanged'
);

select is(
  (
    select request_count
    from public.admin_rate_limit_buckets
    where actor_id = '00000000-0000-0000-0000-000000002001'
      and action_key = 'webchat_config.write'
  ),
  10,
  'the rejected over-limit statement does not commit an extra rate-limit count'
);

select * from finish();

rollback;
