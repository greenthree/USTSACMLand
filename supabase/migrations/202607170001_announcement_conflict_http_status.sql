-- PostgREST/Supavisor treats SQLSTATE 40001 as a retryable serialization
-- failure. Optimistic-lock conflicts are expected application errors, so
-- translate them at the browser-facing RPC boundary to an immediate HTTP 409.

create or replace function public.admin_upsert_announcement(
  target_announcement_id bigint,
  announcement_title text,
  announcement_body text,
  announcement_status public.announcement_status,
  announcement_published_at timestamptz,
  announcement_expires_at timestamptz,
  expected_updated_at timestamptz
)
returns table (
  announcement_id bigint,
  announcement_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.consume_admin_rate_limit(auth.uid(), 'announcement.write', 30, 60);
  return query
  select *
  from public.admin_upsert_announcement_unlimited(
    target_announcement_id,
    announcement_title,
    announcement_body,
    announcement_status,
    announcement_published_at,
    announcement_expires_at,
    expected_updated_at
  );
exception
  when serialization_failure then
    raise exception 'Announcement changed after it was loaded. Refresh and try again.'
      using errcode = 'PT409';
end;
$$;

create or replace function public.admin_delete_announcement(
  target_announcement_id bigint,
  expected_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.consume_admin_rate_limit(auth.uid(), 'announcement.write', 30, 60);
  return public.admin_delete_announcement_unlimited(
    target_announcement_id,
    expected_updated_at
  );
exception
  when serialization_failure then
    raise exception 'Announcement changed after it was loaded. Refresh and try again.'
      using errcode = 'PT409';
end;
$$;

revoke all on function public.admin_upsert_announcement(
  bigint,
  text,
  text,
  public.announcement_status,
  timestamptz,
  timestamptz,
  timestamptz
)
from public, anon, authenticated;

revoke all on function public.admin_delete_announcement(bigint, timestamptz)
from public, anon, authenticated;

grant execute on function public.admin_upsert_announcement(
  bigint,
  text,
  text,
  public.announcement_status,
  timestamptz,
  timestamptz,
  timestamptz
)
to authenticated, service_role;

grant execute on function public.admin_delete_announcement(bigint, timestamptz)
to authenticated, service_role;

comment on function public.admin_upsert_announcement(
  bigint,
  text,
  text,
  public.announcement_status,
  timestamptz,
  timestamptz,
  timestamptz
) is
  'Creates or updates an announcement, rate limits browser administrators, and returns optimistic-lock conflicts as HTTP 409.';

comment on function public.admin_delete_announcement(bigint, timestamptz) is
  'Deletes an announcement, rate limits browser administrators, and returns optimistic-lock conflicts as HTTP 409.';
