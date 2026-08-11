-- Make the persisted kill switch fail closed before removing every application
-- writer. Keep historical relay metadata and Vault references for read-only
-- diagnostics, but invalidate any stale optimistic-lock snapshot.
update private.webchat_relay_config
set
  requests_enabled = false,
  version = version + 1,
  updated_at = pg_catalog.clock_timestamp()
where singleton and requests_enabled;

revoke all on function public.create_own_webchat_conversation()
from public, anon, authenticated, service_role;
revoke all on function public.rename_own_webchat_conversation(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.set_own_webchat_conversation_archived(uuid, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.upsert_own_webchat_message(uuid, text, text, text, jsonb)
from public, anon, authenticated, service_role;

revoke all on function public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_webchat_relay_config(
  uuid, text, text, text, bigint, text, boolean, integer, bigint
) from public, anon, authenticated, service_role;

comment on function public.create_own_webchat_conversation() is
  'Retired WebChat history writer retained for schema compatibility; no application role may execute it.';
comment on function public.rename_own_webchat_conversation(uuid, text) is
  'Retired WebChat history writer retained for schema compatibility; no application role may execute it.';
comment on function public.set_own_webchat_conversation_archived(uuid, boolean) is
  'Retired WebChat history writer retained for schema compatibility; no application role may execute it.';
comment on function public.upsert_own_webchat_message(uuid, text, text, text, jsonb) is
  'Retired WebChat history writer retained for schema compatibility; no application role may execute it.';
comment on function public.admin_update_webchat_member_access(
  uuid, boolean, integer, bigint, bigint, text
) is 'Retired WebChat authorization writer retained for schema compatibility; production administration is read-only.';
comment on function public.admin_update_webchat_relay_config(
  uuid, text, text, text, bigint, text, boolean, integer, bigint
) is 'Retired WebChat relay writer retained for schema compatibility; production administration is read-only.';
