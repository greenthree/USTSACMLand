-- Manage announcements through audited administrator RPCs instead of granting
-- authenticated browser sessions direct table and sequence write access.

revoke all on table public.announcements from authenticated;
revoke all on sequence public.announcements_id_seq from authenticated;

create or replace function public.set_announcement_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := greatest(
    pg_catalog.clock_timestamp(),
    old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$$;

drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at
before update on public.announcements
for each row execute function public.set_announcement_updated_at();

revoke all on function public.set_announcement_updated_at()
  from public, anon, authenticated;

create or replace function public.admin_list_announcements(
  row_limit integer default 50,
  before_announcement_id bigint default null
)
returns table (
  announcement_id bigint,
  title text,
  body text,
  status public.announcement_status,
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid,
  created_by_label text,
  updated_by uuid,
  updated_by_label text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(row_limit, 50), 1), 100);
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select
    announcement.id,
    announcement.title,
    announcement.body,
    announcement.status,
    announcement.published_at,
    announcement.expires_at,
    announcement.created_by,
    coalesce(creator_profile.full_name, creator.email::text, '系统'),
    announcement.updated_by,
    coalesce(editor_profile.full_name, editor.email::text, '系统'),
    announcement.created_at,
    announcement.updated_at
  from public.announcements as announcement
  left join auth.users as creator on creator.id = announcement.created_by
  left join public.profiles as creator_profile on creator_profile.id = announcement.created_by
  left join auth.users as editor on editor.id = announcement.updated_by
  left join public.profiles as editor_profile on editor_profile.id = announcement.updated_by
  where before_announcement_id is null or announcement.id < before_announcement_id
  order by announcement.id desc
  limit safe_limit;
end;
$$;

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
declare
  normalized_title text := btrim(coalesce(announcement_title, ''));
  normalized_body text := btrim(coalesce(announcement_body, ''));
  normalized_published_at timestamptz := announcement_published_at;
  normalized_expires_at timestamptz := announcement_expires_at;
  current_updated_at timestamptz;
  saved_id bigint;
  saved_updated_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if char_length(normalized_title) not between 1 and 120 then
    raise exception 'Announcement title must contain 1 to 120 characters.'
      using errcode = '22001';
  end if;
  if char_length(normalized_body) not between 1 and 20000 then
    raise exception 'Announcement body must contain 1 to 20000 characters.'
      using errcode = '22001';
  end if;
  if announcement_status is null then
    raise exception 'Announcement status is required.' using errcode = '22004';
  end if;

  if announcement_status = 'draft' then
    if normalized_published_at is not null or normalized_expires_at is not null then
      raise exception 'Draft announcements cannot have publication or expiry times.'
        using errcode = '22023';
    end if;
  elsif announcement_status = 'published' and normalized_published_at is null then
    normalized_published_at := pg_catalog.clock_timestamp();
  end if;

  if normalized_expires_at is not null and normalized_published_at is null then
    raise exception 'An expiry time requires a publication time.' using errcode = '22023';
  end if;
  if normalized_expires_at is not null
    and normalized_expires_at <= normalized_published_at then
    raise exception 'Announcement expiry must be later than publication.'
      using errcode = '22023';
  end if;

  if target_announcement_id is null then
    if expected_updated_at is not null then
      raise exception 'A new announcement cannot have an expected version.'
        using errcode = '22023';
    end if;

    insert into public.announcements (
      title,
      body,
      status,
      published_at,
      expires_at,
      created_by,
      updated_by
    ) values (
      normalized_title,
      normalized_body,
      announcement_status,
      normalized_published_at,
      normalized_expires_at,
      (select auth.uid()),
      (select auth.uid())
    )
    returning id, updated_at into saved_id, saved_updated_at;
  else
    if target_announcement_id < 1 then
      raise exception 'Announcement ID must be positive.' using errcode = '22023';
    end if;
    if expected_updated_at is null then
      raise exception 'Expected announcement version is required.' using errcode = '22004';
    end if;

    select announcement.updated_at
    into current_updated_at
    from public.announcements as announcement
    where announcement.id = target_announcement_id
    for update;

    if not found then
      raise exception 'Announcement not found.' using errcode = 'P0002';
    end if;
    if current_updated_at is distinct from expected_updated_at then
      raise exception 'Announcement changed after it was loaded. Refresh and try again.'
        using errcode = '40001';
    end if;

    update public.announcements as announcement
    set
      title = normalized_title,
      body = normalized_body,
      status = announcement_status,
      published_at = normalized_published_at,
      expires_at = normalized_expires_at,
      updated_by = (select auth.uid())
    where announcement.id = target_announcement_id
    returning announcement.id, announcement.updated_at into saved_id, saved_updated_at;
  end if;

  return query select saved_id, saved_updated_at;
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
declare
  current_updated_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if target_announcement_id is null or target_announcement_id < 1 then
    raise exception 'A positive announcement ID is required.' using errcode = '22023';
  end if;
  if expected_updated_at is null then
    raise exception 'Expected announcement version is required.' using errcode = '22004';
  end if;

  select announcement.updated_at
  into current_updated_at
  from public.announcements as announcement
  where announcement.id = target_announcement_id
  for update;

  if not found then
    raise exception 'Announcement not found.' using errcode = 'P0002';
  end if;
  if current_updated_at is distinct from expected_updated_at then
    raise exception 'Announcement changed after it was loaded. Refresh and try again.'
      using errcode = '40001';
  end if;

  delete from public.announcements as announcement
  where announcement.id = target_announcement_id;
  return true;
end;
$$;

revoke all on function public.admin_list_announcements(integer, bigint)
  from public, anon, authenticated;
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

grant execute on function public.admin_list_announcements(integer, bigint)
  to authenticated;
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

comment on function public.admin_list_announcements(integer, bigint) is
  'Returns cursor-paginated announcement records for approved administrators.';
comment on function public.admin_upsert_announcement(
  bigint,
  text,
  text,
  public.announcement_status,
  timestamptz,
  timestamptz,
  timestamptz
) is 'Creates or optimistically updates an audited announcement for an approved administrator.';
comment on function public.admin_delete_announcement(bigint, timestamptz) is
  'Optimistically deletes an audited announcement for an approved administrator.';
