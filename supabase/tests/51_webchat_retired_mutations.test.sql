begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select is(
  (
    select config.requests_enabled
    from private.webchat_relay_config as config
    where config.singleton
  ),
  false,
  'retired WebChat relay configuration is persisted in the disabled state'
);

select is(
  (
    select state.image_uploads_paused
    from private.webchat_global_quota_state as state
    where state.singleton
  ),
  true,
  'retired WebChat image uploads are persisted in the paused state'
);

select ok(
  not exists (
    select 1
    from pg_catalog.unnest(array['anon', 'authenticated', 'service_role']) as role_name
    cross join pg_catalog.unnest(array[
      'public.create_own_webchat_conversation()',
      'public.rename_own_webchat_conversation(uuid,text)',
      'public.set_own_webchat_conversation_archived(uuid,boolean)',
      'public.upsert_own_webchat_message(uuid,text,text,text,jsonb)',
      'public.admin_update_webchat_member_access(uuid,boolean,integer,bigint,bigint,text)',
      'public.admin_update_webchat_relay_config(uuid,text,text,text,bigint,text,boolean,integer,bigint)'
    ]) as signature
    where pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE')
  ),
  'no application role can execute a retired WebChat creation or configuration writer'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.list_own_webchat_conversations(integer,timestamptz,uuid)',
    'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.load_own_webchat_messages(uuid)', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.delete_own_webchat_conversation(uuid)', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.delete_own_webchat_messages(uuid,text[])', 'EXECUTE'
    ),
  'members retain own-history reads and deletion RPCs for data protection'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.admin_get_webchat_member_access(uuid)', 'EXECUTE'
  )
    and pg_catalog.has_function_privilege(
      'authenticated', 'public.admin_list_webchat_pilot_members()', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role', 'public.read_webchat_relay_config()', 'EXECUTE'
    )
    and pg_catalog.has_function_privilege(
      'service_role', 'public.read_webchat_relay_runtime_config()', 'EXECUTE'
    ),
  'read-only administrator and runtime diagnostics remain available'
);

select * from finish();

rollback;
