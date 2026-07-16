create table public.admin_rate_limit_buckets (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  action_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (actor_id, action_key),
  constraint admin_rate_limit_action_key_format
    check (action_key ~ '^[a-z0-9_.:-]{1,80}$')
);

alter table public.admin_rate_limit_buckets enable row level security;
revoke all on table public.admin_rate_limit_buckets from public, anon, authenticated;

create or replace function public.consume_admin_rate_limit(
  rate_actor_id uuid,
  rate_action_key text,
  rate_max_requests integer,
  rate_window_seconds integer
)
returns table (
  remaining_requests integer,
  resets_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  checked_at timestamptz := pg_catalog.clock_timestamp();
  next_count integer;
  active_window_started_at timestamptz;
  retry_after_seconds integer;
begin
  if rate_actor_id is null then
    raise exception 'Administrator identity is required.' using errcode = '42501';
  end if;
  if rate_action_key is null or rate_action_key !~ '^[a-z0-9_.:-]{1,80}$' then
    raise exception 'A valid rate-limit action key is required.' using errcode = '22023';
  end if;
  if rate_max_requests is null or rate_max_requests < 1 or rate_max_requests > 10000 then
    raise exception 'Rate-limit maximum must be between 1 and 10000.' using errcode = '22023';
  end if;
  if rate_window_seconds is null or rate_window_seconds < 1 or rate_window_seconds > 86400 then
    raise exception 'Rate-limit window must be between 1 and 86400 seconds.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = rate_actor_id
      and profile.role = 'admin'
      and profile.review_status = 'approved'
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  insert into public.admin_rate_limit_buckets as bucket (
    actor_id,
    action_key,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    rate_actor_id,
    rate_action_key,
    checked_at,
    1,
    checked_at
  )
  on conflict (actor_id, action_key) do update
  set
    window_started_at = case
      when bucket.window_started_at
        <= checked_at - pg_catalog.make_interval(secs => rate_window_seconds)
      then checked_at
      else bucket.window_started_at
    end,
    request_count = case
      when bucket.window_started_at
        <= checked_at - pg_catalog.make_interval(secs => rate_window_seconds)
      then 1
      else bucket.request_count + 1
    end,
    updated_at = checked_at
  returning request_count, window_started_at
  into next_count, active_window_started_at;

  resets_at := active_window_started_at
    + pg_catalog.make_interval(secs => rate_window_seconds);
  remaining_requests := pg_catalog.greatest(rate_max_requests - next_count, 0);

  if next_count > rate_max_requests then
    retry_after_seconds := pg_catalog.greatest(
      1,
      pg_catalog.ceil(pg_catalog.extract(epoch from (resets_at - checked_at)))::integer
    );
    raise exception 'admin_rate_limited'
      using
        errcode = 'P0001',
        detail = pg_catalog.jsonb_build_object(
          'action', rate_action_key,
          'retry_after_seconds', retry_after_seconds
        )::text,
        hint = 'Wait for the current administrative rate-limit window to reset.';
  end if;

  return next;
end;
$$;

revoke all on function public.consume_admin_rate_limit(uuid, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_admin_rate_limit(uuid, text, integer, integer)
to service_role;

alter function public.admin_set_member_suspension(uuid, boolean, timestamptz, text)
rename to admin_set_member_suspension_unlimited;
alter function public.admin_update_member_profile(uuid, text, text, text, text, boolean, timestamptz)
rename to admin_update_member_profile_unlimited;
alter function public.admin_set_platform_account_status(
  bigint,
  public.account_verification_status,
  text,
  timestamptz
)
rename to admin_set_platform_account_status_unlimited;
alter function public.admin_upsert_member_platform_account(
  uuid,
  public.platform_name,
  text,
  timestamptz
)
rename to admin_upsert_member_platform_account_unlimited;
alter function public.admin_unbind_member_platform_account(uuid, public.platform_name, timestamptz)
rename to admin_unbind_member_platform_account_unlimited;
alter function public.admin_set_manual_platform_stats(
  uuid,
  public.platform_name,
  integer,
  integer,
  integer,
  timestamptz,
  text,
  timestamptz
)
rename to admin_set_manual_platform_stats_unlimited;
alter function public.admin_upsert_announcement(
  bigint,
  text,
  text,
  public.announcement_status,
  timestamptz,
  timestamptz,
  timestamptz
)
rename to admin_upsert_announcement_unlimited;
alter function public.admin_delete_announcement(bigint, timestamptz)
rename to admin_delete_announcement_unlimited;

revoke all on function public.admin_set_member_suspension_unlimited(
  uuid,
  boolean,
  timestamptz,
  text
) from public, anon, authenticated;
revoke all on function public.admin_update_member_profile_unlimited(
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_set_platform_account_status_unlimited(
  bigint,
  public.account_verification_status,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_upsert_member_platform_account_unlimited(
  uuid,
  public.platform_name,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_unbind_member_platform_account_unlimited(
  uuid,
  public.platform_name,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_set_manual_platform_stats_unlimited(
  uuid,
  public.platform_name,
  integer,
  integer,
  integer,
  timestamptz,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_upsert_announcement_unlimited(
  bigint,
  text,
  text,
  public.announcement_status,
  timestamptz,
  timestamptz,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_delete_announcement_unlimited(bigint, timestamptz)
from public, anon, authenticated;

create function public.admin_set_member_suspension(
  target_profile_id uuid,
  suspended boolean,
  expected_updated_at timestamptz,
  note text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.consume_admin_rate_limit(auth.uid(), 'member.write', 30, 60);
  return public.admin_set_member_suspension_unlimited(
    target_profile_id,
    suspended,
    expected_updated_at,
    note
  );
end;
$$;

create function public.admin_update_member_profile(
  target_profile_id uuid,
  member_full_name text,
  member_qq text,
  member_grade text,
  member_major text,
  member_is_public boolean,
  expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.consume_admin_rate_limit(auth.uid(), 'member.write', 30, 60);
  return public.admin_update_member_profile_unlimited(
    target_profile_id,
    member_full_name,
    member_qq,
    member_grade,
    member_major,
    member_is_public,
    expected_updated_at
  );
end;
$$;

create function public.admin_set_platform_account_status(
  target_account_id bigint,
  next_status public.account_verification_status,
  error_message text,
  expected_updated_at timestamptz
)
returns public.account_verification_status
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.consume_admin_rate_limit(auth.uid(), 'platform_account.write', 60, 60);
  return public.admin_set_platform_account_status_unlimited(
    target_account_id,
    next_status,
    error_message,
    expected_updated_at
  );
end;
$$;

create function public.admin_upsert_member_platform_account(
  target_profile_id uuid,
  target_platform public.platform_name,
  new_external_id text,
  expected_updated_at timestamptz default null
)
returns table (
  account_id bigint,
  account_status public.account_verification_status,
  account_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.consume_admin_rate_limit(auth.uid(), 'platform_account.write', 60, 60);
  return query
  select *
  from public.admin_upsert_member_platform_account_unlimited(
    target_profile_id,
    target_platform,
    new_external_id,
    expected_updated_at
  );
end;
$$;

create function public.admin_unbind_member_platform_account(
  target_profile_id uuid,
  target_platform public.platform_name,
  expected_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.consume_admin_rate_limit(auth.uid(), 'platform_account.write', 60, 60);
  return public.admin_unbind_member_platform_account_unlimited(
    target_profile_id,
    target_platform,
    expected_updated_at
  );
end;
$$;

create function public.admin_set_manual_platform_stats(
  target_profile_id uuid,
  target_platform public.platform_name,
  manual_current_rating integer,
  manual_max_rating integer,
  manual_solved_count integer,
  manual_source_observed_at timestamptz,
  manual_note text,
  expected_stat_updated_at timestamptz default null
)
returns table (
  stat_updated_at timestamptz,
  sync_run_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.consume_admin_rate_limit(auth.uid(), 'manual_stats.write', 30, 60);
  return query
  select *
  from public.admin_set_manual_platform_stats_unlimited(
    target_profile_id,
    target_platform,
    manual_current_rating,
    manual_max_rating,
    manual_solved_count,
    manual_source_observed_at,
    manual_note,
    expected_stat_updated_at
  );
end;
$$;

create function public.admin_upsert_announcement(
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
end;
$$;

create function public.admin_delete_announcement(
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
end;
$$;

revoke all on function public.admin_set_member_suspension(uuid, boolean, timestamptz, text)
from public, anon, authenticated;
revoke all on function public.admin_update_member_profile(
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_set_platform_account_status(
  bigint,
  public.account_verification_status,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_upsert_member_platform_account(
  uuid,
  public.platform_name,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_unbind_member_platform_account(
  uuid,
  public.platform_name,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_set_manual_platform_stats(
  uuid,
  public.platform_name,
  integer,
  integer,
  integer,
  timestamptz,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_upsert_announcement(
  bigint,
  text,
  text,
  public.announcement_status,
  timestamptz,
  timestamptz,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_delete_announcement(bigint, timestamptz)
from public, anon, authenticated;

grant execute on function public.admin_set_member_suspension(uuid, boolean, timestamptz, text)
to authenticated;
grant execute on function public.admin_update_member_profile(
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  timestamptz
) to authenticated;
grant execute on function public.admin_set_platform_account_status(
  bigint,
  public.account_verification_status,
  text,
  timestamptz
) to authenticated;
grant execute on function public.admin_upsert_member_platform_account(
  uuid,
  public.platform_name,
  text,
  timestamptz
) to authenticated;
grant execute on function public.admin_unbind_member_platform_account(
  uuid,
  public.platform_name,
  timestamptz
) to authenticated;
grant execute on function public.admin_set_manual_platform_stats(
  uuid,
  public.platform_name,
  integer,
  integer,
  integer,
  timestamptz,
  text,
  timestamptz
) to authenticated;
grant execute on function public.admin_upsert_announcement(
  bigint,
  text,
  text,
  public.announcement_status,
  timestamptz,
  timestamptz,
  timestamptz
) to authenticated;
grant execute on function public.admin_delete_announcement(bigint, timestamptz)
to authenticated;

comment on table public.admin_rate_limit_buckets is
  'Bounded per-administrator fixed-window counters for sensitive administrative writes.';
comment on function public.consume_admin_rate_limit(uuid, text, integer, integer) is
  'Atomically consumes one administrator rate-limit slot; callable directly only by the service role.';
