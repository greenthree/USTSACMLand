-- Daily problem learning loop: public scheduled feed, private completion
-- identities, member-only discussion, and audited administrator moderation.

create type public.daily_problem_status as enum ('draft', 'published', 'archived');

create table public.daily_problems (
  id bigint generated always as identity primary key,
  problem_date date not null,
  title text not null,
  source_platform text not null,
  external_problem_id text not null,
  source_url text not null,
  difficulty text,
  tags text[] not null default '{}'::text[],
  training_note text not null,
  estimated_minutes integer,
  status public.daily_problem_status not null default 'draft',
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version bigint not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint daily_problems_problem_date_unique unique (problem_date),
  constraint daily_problems_title_valid check (
    char_length(btrim(title)) between 1 and 200 and title = btrim(title)
  ),
  constraint daily_problems_source_platform_valid check (
    char_length(btrim(source_platform)) between 1 and 40
      and source_platform = btrim(source_platform)
  ),
  constraint daily_problems_external_problem_id_valid check (
    char_length(btrim(external_problem_id)) between 1 and 100
      and external_problem_id = btrim(external_problem_id)
  ),
  constraint daily_problems_source_url_valid check (
    char_length(source_url) between 10 and 2000
      and source_url ~ '^https://[^[:space:]]+$'
      and source_url !~ '^https://[^/]*@'
  ),
  constraint daily_problems_difficulty_valid check (
    difficulty is null
      or (
        char_length(btrim(difficulty)) between 1 and 40
        and difficulty = btrim(difficulty)
      )
  ),
  constraint daily_problems_tags_count check (cardinality(tags) <= 12),
  constraint daily_problems_tags_no_null check (array_position(tags, null) is null),
  constraint daily_problems_training_note_valid check (
    char_length(btrim(training_note)) between 1 and 10000
      and training_note = btrim(training_note)
  ),
  constraint daily_problems_estimated_minutes_valid check (
    estimated_minutes is null or estimated_minutes between 1 and 600
  ),
  constraint daily_problems_status_metadata check (
    (status = 'draft' and published_at is null and archived_at is null)
    or (status = 'published' and published_at is not null and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  constraint daily_problems_version_valid check (version > 0),
  constraint daily_problems_timestamps_valid check (updated_at >= created_at)
);

create table public.daily_problem_completions (
  problem_id bigint not null references public.daily_problems (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  completed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (problem_id, profile_id)
);

create table public.daily_problem_comments (
  id bigint generated always as identity primary key,
  problem_id bigint not null references public.daily_problems (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  is_visible boolean not null default true,
  hidden_at timestamptz,
  hidden_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint daily_problem_comments_body_valid check (
    char_length(btrim(body)) between 1 and 2000 and body = btrim(body)
  ),
  constraint daily_problem_comments_visibility_metadata check (
    (is_visible and hidden_at is null and hidden_by is null)
      or (not is_visible and hidden_at is not null)
  ),
  constraint daily_problem_comments_timestamps_valid check (updated_at >= created_at)
);

create index daily_problems_public_feed_idx
  on public.daily_problems (problem_date desc, id desc)
  where status = 'published';
create index daily_problems_created_by_idx
  on public.daily_problems (created_by) where created_by is not null;
create index daily_problems_updated_by_idx
  on public.daily_problems (updated_by) where updated_by is not null;
create index daily_problem_completions_profile_completed_idx
  on public.daily_problem_completions (profile_id, completed_at desc);
create index daily_problem_comments_problem_visible_idx
  on public.daily_problem_comments (problem_id, is_visible, id desc);
create index daily_problem_comments_author_idx
  on public.daily_problem_comments (author_id, id desc);
create index daily_problem_comments_hidden_by_idx
  on public.daily_problem_comments (hidden_by) where hidden_by is not null;

alter table public.daily_problems enable row level security;
alter table public.daily_problem_completions enable row level security;
alter table public.daily_problem_comments enable row level security;

revoke all on table public.daily_problems
  from public, anon, authenticated, service_role;
revoke all on table public.daily_problem_completions
  from public, anon, authenticated, service_role;
revoke all on table public.daily_problem_comments
  from public, anon, authenticated, service_role;
revoke all on sequence public.daily_problems_id_seq
  from public, anon, authenticated, service_role;
revoke all on sequence public.daily_problem_comments_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.set_daily_problem_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := greatest(
    pg_catalog.clock_timestamp(),
    old.updated_at + interval '1 microsecond'
  );
  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function public.set_daily_problem_comment_updated_at()
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

create trigger daily_problems_set_updated_at
before update on public.daily_problems
for each row execute function public.set_daily_problem_updated_at();

create trigger daily_problem_comments_set_updated_at
before update on public.daily_problem_comments
for each row execute function public.set_daily_problem_comment_updated_at();

revoke all on function public.set_daily_problem_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function public.set_daily_problem_comment_updated_at()
  from public, anon, authenticated, service_role;

create or replace function public.require_daily_problem_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = actor_id
      and profile.review_status = 'approved'
  ) then
    raise exception 'Approved member access required.' using errcode = '42501';
  end if;

  return actor_id;
end;
$$;

revoke all on function public.require_daily_problem_member()
  from public, anon, authenticated, service_role;

create or replace function public.read_daily_problem_feed(
  row_limit integer default 20,
  before_problem_date date default null
)
returns table (
  problem_id bigint,
  problem_date date,
  title text,
  source_platform text,
  external_problem_id text,
  source_url text,
  difficulty text,
  tags text[],
  training_note text,
  estimated_minutes integer,
  completion_count bigint,
  comment_count bigint,
  my_completed_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(row_limit, 20), 1), 100);
  viewer_id uuid := (select auth.uid());
  viewer_is_approved boolean;
  beijing_date date := (
    pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai'
  )::date;
begin
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = viewer_id
      and profile.review_status = 'approved'
  ) into viewer_is_approved;

  return query
  select
    problem.id,
    problem.problem_date,
    problem.title,
    problem.source_platform,
    problem.external_problem_id,
    problem.source_url,
    problem.difficulty,
    problem.tags,
    problem.training_note,
    problem.estimated_minutes,
    (
      select count(*)
      from public.daily_problem_completions as completion
      where completion.problem_id = problem.id
    ),
    (
      select count(*)
      from public.daily_problem_comments as comment
      where comment.problem_id = problem.id
        and comment.is_visible
    ),
    case when viewer_is_approved then own_completion.completed_at else null end,
    problem.published_at,
    problem.updated_at
  from public.daily_problems as problem
  left join public.daily_problem_completions as own_completion
    on own_completion.problem_id = problem.id
    and own_completion.profile_id = viewer_id
    and viewer_is_approved
  where problem.status = 'published'
    and problem.published_at <= pg_catalog.clock_timestamp()
    and problem.problem_date <= beijing_date
    and (before_problem_date is null or problem.problem_date < before_problem_date)
  order by problem.problem_date desc, problem.id desc
  limit safe_limit;
end;
$$;

create or replace function public.set_own_daily_problem_completion(
  target_problem_id bigint,
  requested_completed boolean
)
returns table (
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.require_daily_problem_member();
  target_problem public.daily_problems%rowtype;
  saved_completed_at timestamptz;
  beijing_date date := (
    pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai'
  )::date;
begin
  if target_problem_id is null or target_problem_id < 1 then
    raise exception 'A positive daily problem ID is required.' using errcode = '22023';
  end if;
  if requested_completed is null then
    raise exception 'Completion state is required.' using errcode = '22004';
  end if;

  select problem.*
  into target_problem
  from public.daily_problems as problem
  where problem.id = target_problem_id
  for share;

  if not found
    or target_problem.status <> 'published'
    or target_problem.published_at > pg_catalog.clock_timestamp()
    or target_problem.problem_date > beijing_date then
    raise exception 'Daily problem is not available.' using errcode = 'P0002';
  end if;

  if requested_completed then
    insert into public.daily_problem_completions as completion (
      problem_id,
      profile_id
    ) values (
      target_problem_id,
      actor_id
    )
    on conflict (problem_id, profile_id) do update
    set completed_at = completion.completed_at
    returning completion.completed_at into saved_completed_at;

    return query select saved_completed_at;
    return;
  end if;

  delete from public.daily_problem_completions as completion
  where completion.problem_id = target_problem_id
    and completion.profile_id = actor_id;
  return query select null::timestamptz;
end;
$$;

create or replace function public.list_daily_problem_comments(
  target_problem_id bigint,
  row_limit integer default 50,
  before_comment_id bigint default null
)
returns table (
  comment_id bigint,
  problem_id bigint,
  author_id uuid,
  author_name text,
  author_label text,
  body text,
  visibility text,
  can_delete boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.require_daily_problem_member();
  actor_is_admin boolean := public.is_admin();
  safe_limit integer := least(greatest(coalesce(row_limit, 50), 1), 100);
  beijing_date date := (
    pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai'
  )::date;
begin
  if target_problem_id is null or target_problem_id < 1 then
    raise exception 'A positive daily problem ID is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.daily_problems as problem
    where problem.id = target_problem_id
      and problem.status = 'published'
      and problem.published_at <= pg_catalog.clock_timestamp()
      and problem.problem_date <= beijing_date
  ) then
    raise exception 'Daily problem is not available.' using errcode = 'P0002';
  end if;

  return query
  select
    comment.id,
    comment.problem_id,
    comment.author_id,
    coalesce(profile.full_name, '已注销成员'),
    coalesce(profile.full_name, '已注销成员'),
    comment.body,
    case when comment.is_visible then 'visible'::text else 'hidden'::text end,
    comment.author_id = actor_id,
    comment.created_at,
    comment.updated_at
  from public.daily_problem_comments as comment
  left join public.profiles as profile on profile.id = comment.author_id
  where comment.problem_id = target_problem_id
    and (actor_is_admin or comment.is_visible)
    and (before_comment_id is null or comment.id < before_comment_id)
  order by comment.id desc
  limit safe_limit;
end;
$$;

create or replace function public.create_daily_problem_comment(
  target_problem_id bigint,
  comment_body text
)
returns table (
  comment_id bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.require_daily_problem_member();
  normalized_body text := btrim(coalesce(comment_body, ''));
  target_problem public.daily_problems%rowtype;
  saved_comment public.daily_problem_comments%rowtype;
  beijing_date date := (
    pg_catalog.clock_timestamp() at time zone 'Asia/Shanghai'
  )::date;
begin
  if target_problem_id is null or target_problem_id < 1 then
    raise exception 'A positive daily problem ID is required.' using errcode = '22023';
  end if;
  if char_length(normalized_body) not between 1 and 2000 then
    raise exception 'Comment body must contain 1 to 2000 characters.'
      using errcode = '22001';
  end if;

  select problem.*
  into target_problem
  from public.daily_problems as problem
  where problem.id = target_problem_id
  for share;

  if not found
    or target_problem.status <> 'published'
    or target_problem.published_at > pg_catalog.clock_timestamp()
    or target_problem.problem_date > beijing_date then
    raise exception 'Daily problem is not available.' using errcode = 'P0002';
  end if;

  insert into public.daily_problem_comments (
    problem_id,
    author_id,
    body
  ) values (
    target_problem_id,
    actor_id,
    normalized_body
  )
  returning * into saved_comment;

  return query select saved_comment.id, saved_comment.created_at, saved_comment.updated_at;
end;
$$;

create or replace function public.delete_own_daily_problem_comment(
  target_comment_id bigint,
  expected_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.require_daily_problem_member();
  target_comment public.daily_problem_comments%rowtype;
begin
  if target_comment_id is null or target_comment_id < 1 then
    raise exception 'A positive daily problem comment ID is required.' using errcode = '22023';
  end if;
  if expected_updated_at is null then
    raise exception 'Expected comment version is required.' using errcode = '22004';
  end if;

  select comment.*
  into target_comment
  from public.daily_problem_comments as comment
  where comment.id = target_comment_id
  for update;

  if not found then
    raise exception 'Daily problem comment not found.' using errcode = 'P0002';
  end if;
  if target_comment.author_id <> actor_id then
    raise exception 'Only the comment author can delete this comment.' using errcode = '42501';
  end if;
  if target_comment.updated_at is distinct from expected_updated_at then
    raise exception 'Comment changed after it was loaded. Refresh and try again.'
      using errcode = 'PT409';
  end if;

  delete from public.daily_problem_comments as comment
  where comment.id = target_comment_id;
  return true;
end;
$$;

create or replace function public.admin_list_daily_problems(
  row_limit integer default 50,
  before_problem_id bigint default null
)
returns table (
  problem_id bigint,
  problem_date date,
  title text,
  source_platform text,
  external_problem_id text,
  source_url text,
  difficulty text,
  tags text[],
  training_note text,
  estimated_minutes integer,
  status public.daily_problem_status,
  completion_count bigint,
  comment_count bigint,
  hidden_comment_count bigint,
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  created_by_label text,
  updated_by uuid,
  updated_by_label text,
  version bigint,
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
    problem.id,
    problem.problem_date,
    problem.title,
    problem.source_platform,
    problem.external_problem_id,
    problem.source_url,
    problem.difficulty,
    problem.tags,
    problem.training_note,
    problem.estimated_minutes,
    problem.status,
    (
      select count(*)
      from public.daily_problem_completions as completion
      where completion.problem_id = problem.id
    ),
    (
      select count(*)
      from public.daily_problem_comments as comment
      where comment.problem_id = problem.id and comment.is_visible
    ),
    (
      select count(*)
      from public.daily_problem_comments as comment
      where comment.problem_id = problem.id and not comment.is_visible
    ),
    problem.published_at,
    problem.archived_at,
    problem.created_by,
    coalesce(creator_profile.full_name, creator.email::text, '系统'),
    problem.updated_by,
    coalesce(editor_profile.full_name, editor.email::text, '系统'),
    problem.version,
    problem.created_at,
    problem.updated_at
  from public.daily_problems as problem
  left join auth.users as creator on creator.id = problem.created_by
  left join public.profiles as creator_profile on creator_profile.id = problem.created_by
  left join auth.users as editor on editor.id = problem.updated_by
  left join public.profiles as editor_profile on editor_profile.id = problem.updated_by
  where before_problem_id is null or problem.id < before_problem_id
  order by problem.id desc
  limit safe_limit;
end;
$$;

create or replace function public.admin_upsert_daily_problem(
  target_problem_id bigint,
  problem_date date,
  problem_title text,
  problem_source_platform text,
  problem_external_problem_id text,
  problem_source_url text,
  problem_difficulty text,
  problem_tags text[],
  problem_training_note text,
  problem_estimated_minutes integer,
  requested_status public.daily_problem_status,
  expected_updated_at timestamptz
)
returns table (
  problem_id bigint,
  problem_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  checked_at timestamptz := pg_catalog.clock_timestamp();
  normalized_title text := btrim(coalesce(problem_title, ''));
  normalized_source_platform text := btrim(coalesce(problem_source_platform, ''));
  normalized_external_problem_id text := btrim(coalesce(problem_external_problem_id, ''));
  normalized_source_url text := btrim(coalesce(problem_source_url, ''));
  normalized_difficulty text := nullif(btrim(coalesce(problem_difficulty, '')), '');
  normalized_training_note text := btrim(coalesce(problem_training_note, ''));
  normalized_tags text[];
  current_problem public.daily_problems%rowtype;
  saved_problem public.daily_problems%rowtype;
  before_data jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  perform public.consume_admin_rate_limit(actor_id, 'daily_problem.write', 30, 60);

  select coalesce(array_agg(normalized.tag order by normalized.first_ordinal), '{}'::text[])
  into normalized_tags
  from (
    select btrim(input.tag) as tag, min(input.ordinality) as first_ordinal
    from unnest(coalesce(problem_tags, '{}'::text[]))
      with ordinality as input(tag, ordinality)
    where btrim(input.tag) <> ''
    group by btrim(input.tag)
  ) as normalized;

  if problem_date is null then
    raise exception 'Daily problem date is required.' using errcode = '22004';
  end if;
  if char_length(normalized_title) not between 1 and 200 then
    raise exception 'Daily problem title must contain 1 to 200 characters.'
      using errcode = '22001';
  end if;
  if char_length(normalized_source_platform) not between 1 and 40 then
    raise exception 'Source platform must contain 1 to 40 characters.'
      using errcode = '22001';
  end if;
  if char_length(normalized_external_problem_id) not between 1 and 100 then
    raise exception 'External problem ID must contain 1 to 100 characters.'
      using errcode = '22001';
  end if;
  if char_length(normalized_source_url) not between 10 and 2000
    or normalized_source_url !~ '^https://[^[:space:]]+$'
    or normalized_source_url ~ '^https://[^/]*@' then
    raise exception 'Daily problem source URL must be an HTTPS URL.'
      using errcode = '22023';
  end if;
  if normalized_difficulty is not null
    and char_length(normalized_difficulty) > 40 then
    raise exception 'Difficulty must contain at most 40 characters.'
      using errcode = '22001';
  end if;
  if cardinality(normalized_tags) > 12
    or exists (
      select 1 from unnest(normalized_tags) as tag(value)
      where char_length(tag.value) > 40
    ) then
    raise exception 'Provide at most 12 tags of at most 40 characters each.'
      using errcode = '22023';
  end if;
  if char_length(normalized_training_note) not between 1 and 10000 then
    raise exception 'Training note must contain 1 to 10000 characters.'
      using errcode = '22001';
  end if;
  if problem_estimated_minutes is not null
    and problem_estimated_minutes not between 1 and 600 then
    raise exception 'Estimated minutes must be between 1 and 600 when provided.'
      using errcode = '22023';
  end if;
  if requested_status is null then
    raise exception 'Daily problem status is required.' using errcode = '22004';
  end if;

  if target_problem_id is null then
    if expected_updated_at is not null then
      raise exception 'A new daily problem cannot have an expected version.'
        using errcode = '22023';
    end if;
    if requested_status = 'archived' then
      raise exception 'A new daily problem cannot start archived.' using errcode = '22023';
    end if;

    insert into public.daily_problems (
      problem_date,
      title,
      source_platform,
      external_problem_id,
      source_url,
      difficulty,
      tags,
      training_note,
      estimated_minutes,
      status,
      published_at,
      created_by,
      updated_by,
      created_at,
      updated_at
    ) values (
      problem_date,
      normalized_title,
      normalized_source_platform,
      normalized_external_problem_id,
      normalized_source_url,
      normalized_difficulty,
      normalized_tags,
      normalized_training_note,
      problem_estimated_minutes,
      requested_status,
      case when requested_status = 'published' then checked_at else null end,
      actor_id,
      actor_id,
      checked_at,
      checked_at
    )
    returning * into saved_problem;

    insert into public.audit_logs (
      actor_id,
      action,
      target_table,
      target_id,
      after_data,
      metadata
    ) values (
      actor_id,
      'insert',
      'daily_problems',
      saved_problem.id::text,
      to_jsonb(saved_problem),
      pg_catalog.jsonb_build_object('source', 'admin_daily_problem_rpc')
    );
  else
    if target_problem_id < 1 then
      raise exception 'Daily problem ID must be positive.' using errcode = '22023';
    end if;
    if expected_updated_at is null then
      raise exception 'Expected daily problem version is required.' using errcode = '22004';
    end if;

    select problem.*
    into current_problem
    from public.daily_problems as problem
    where problem.id = target_problem_id
    for update;

    if not found then
      raise exception 'Daily problem not found.' using errcode = 'P0002';
    end if;
    if current_problem.updated_at is distinct from expected_updated_at then
      raise exception 'Daily problem changed after it was loaded. Refresh and try again.'
        using errcode = 'PT409';
    end if;
    if current_problem.published_at is not null and requested_status = 'draft' then
      raise exception 'A published daily problem can only remain published or be archived.'
        using errcode = '22023';
    end if;

    before_data := to_jsonb(current_problem);

    update public.daily_problems as problem
    set
      problem_date = admin_upsert_daily_problem.problem_date,
      title = normalized_title,
      source_platform = normalized_source_platform,
      external_problem_id = normalized_external_problem_id,
      source_url = normalized_source_url,
      difficulty = normalized_difficulty,
      tags = normalized_tags,
      training_note = normalized_training_note,
      estimated_minutes = problem_estimated_minutes,
      status = requested_status,
      published_at = case
        when requested_status = 'published'
          then coalesce(current_problem.published_at, checked_at)
        else current_problem.published_at
      end,
      archived_at = case
        when requested_status = 'archived'
          then coalesce(current_problem.archived_at, checked_at)
        else null
      end,
      updated_by = actor_id
    where problem.id = target_problem_id
    returning problem.* into saved_problem;

    insert into public.audit_logs (
      actor_id,
      action,
      target_table,
      target_id,
      before_data,
      after_data,
      metadata
    ) values (
      actor_id,
      'update',
      'daily_problems',
      saved_problem.id::text,
      before_data,
      to_jsonb(saved_problem),
      pg_catalog.jsonb_build_object('source', 'admin_daily_problem_rpc')
    );
  end if;

  return query select saved_problem.id, saved_problem.updated_at;
end;
$$;

create or replace function public.admin_delete_daily_problem(
  target_problem_id bigint,
  expected_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_problem public.daily_problems%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  perform public.consume_admin_rate_limit(actor_id, 'daily_problem.write', 30, 60);

  if target_problem_id is null or target_problem_id < 1 then
    raise exception 'A positive daily problem ID is required.' using errcode = '22023';
  end if;
  if expected_updated_at is null then
    raise exception 'Expected daily problem version is required.' using errcode = '22004';
  end if;

  select problem.*
  into target_problem
  from public.daily_problems as problem
  where problem.id = target_problem_id
  for update;

  if not found then
    raise exception 'Daily problem not found.' using errcode = 'P0002';
  end if;
  if target_problem.updated_at is distinct from expected_updated_at then
    raise exception 'Daily problem changed after it was loaded. Refresh and try again.'
      using errcode = 'PT409';
  end if;
  if target_problem.published_at is not null then
    raise exception 'Published daily problems cannot be deleted; archive them instead.'
      using errcode = '22023';
  end if;

  delete from public.daily_problems as problem
  where problem.id = target_problem_id;

  insert into public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    before_data,
    metadata
  ) values (
    actor_id,
    'delete',
    'daily_problems',
    target_problem.id::text,
    to_jsonb(target_problem),
    pg_catalog.jsonb_build_object('source', 'admin_daily_problem_rpc')
  );
  return true;
end;
$$;

create or replace function public.admin_set_daily_problem_comment_visibility(
  target_comment_id bigint,
  requested_visible boolean,
  moderation_reason text,
  expected_updated_at timestamptz
)
returns table (
  comment_id bigint,
  comment_visible boolean,
  comment_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text := btrim(coalesce(moderation_reason, ''));
  target_comment public.daily_problem_comments%rowtype;
  saved_comment public.daily_problem_comments%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  perform public.consume_admin_rate_limit(
    actor_id,
    'daily_problem_comment.moderate',
    60,
    60
  );

  if target_comment_id is null or target_comment_id < 1 then
    raise exception 'A positive daily problem comment ID is required.' using errcode = '22023';
  end if;
  if requested_visible is null then
    raise exception 'Comment visibility is required.' using errcode = '22004';
  end if;
  if char_length(normalized_reason) not between 1 and 500 then
    raise exception 'Moderation reason must contain 1 to 500 characters.'
      using errcode = '22001';
  end if;
  if expected_updated_at is null then
    raise exception 'Expected comment version is required.' using errcode = '22004';
  end if;

  select comment.*
  into target_comment
  from public.daily_problem_comments as comment
  where comment.id = target_comment_id
  for update;

  if not found then
    raise exception 'Daily problem comment not found.' using errcode = 'P0002';
  end if;
  if target_comment.updated_at is distinct from expected_updated_at then
    raise exception 'Comment changed after it was loaded. Refresh and try again.'
      using errcode = 'PT409';
  end if;

  if target_comment.is_visible = requested_visible then
    return query select target_comment.id, target_comment.is_visible, target_comment.updated_at;
    return;
  end if;

  update public.daily_problem_comments as comment
  set
    is_visible = requested_visible,
    hidden_at = case when requested_visible then null else pg_catalog.clock_timestamp() end,
    hidden_by = case when requested_visible then null else actor_id end
  where comment.id = target_comment_id
  returning comment.* into saved_comment;

  insert into public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    before_data,
    after_data,
    metadata
  ) values (
    actor_id,
    case when requested_visible then 'restore' else 'hide' end,
    'daily_problem_comments',
    saved_comment.id::text,
    pg_catalog.jsonb_build_object(
      'problem_id', target_comment.problem_id,
      'author_id', target_comment.author_id,
      'is_visible', target_comment.is_visible,
      'updated_at', target_comment.updated_at
    ),
    pg_catalog.jsonb_build_object(
      'problem_id', saved_comment.problem_id,
      'author_id', saved_comment.author_id,
      'is_visible', saved_comment.is_visible,
      'updated_at', saved_comment.updated_at
    ),
    pg_catalog.jsonb_build_object(
      'source', 'admin_daily_problem_rpc',
      'reason', normalized_reason
    )
  );

  return query select saved_comment.id, saved_comment.is_visible, saved_comment.updated_at;
end;
$$;

revoke all on function public.read_daily_problem_feed(integer, date)
  from public, anon, authenticated, service_role;
revoke all on function public.set_own_daily_problem_completion(bigint, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.list_daily_problem_comments(bigint, integer, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.create_daily_problem_comment(bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_own_daily_problem_comment(bigint, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_daily_problems(integer, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_upsert_daily_problem(
  bigint,
  date,
  text,
  text,
  text,
  text,
  text,
  text[],
  text,
  integer,
  public.daily_problem_status,
  timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.admin_delete_daily_problem(bigint, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_set_daily_problem_comment_visibility(
  bigint,
  boolean,
  text,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.read_daily_problem_feed(integer, date)
  to anon, authenticated, service_role;
grant execute on function public.set_own_daily_problem_completion(bigint, boolean)
  to authenticated;
grant execute on function public.list_daily_problem_comments(bigint, integer, bigint)
  to authenticated;
grant execute on function public.create_daily_problem_comment(bigint, text)
  to authenticated;
grant execute on function public.delete_own_daily_problem_comment(bigint, timestamptz)
  to authenticated;
grant execute on function public.admin_list_daily_problems(integer, bigint)
  to authenticated;
grant execute on function public.admin_upsert_daily_problem(
  bigint,
  date,
  text,
  text,
  text,
  text,
  text,
  text[],
  text,
  integer,
  public.daily_problem_status,
  timestamptz
) to authenticated;
grant execute on function public.admin_delete_daily_problem(bigint, timestamptz)
  to authenticated;
grant execute on function public.admin_set_daily_problem_comment_visibility(
  bigint,
  boolean,
  text,
  timestamptz
) to authenticated;

-- Clear all Auth references before ON DELETE actions run, then scrub every
-- audit row containing the former identity. Daily problem tables intentionally
-- have no generic audit trigger, so this cleanup cannot re-introduce the UUID.
create or replace function public.prepare_auth_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.daily_problems
  set
    created_by = case when created_by = old.id then null else created_by end,
    updated_by = case when updated_by = old.id then null else updated_by end
  where created_by = old.id or updated_by = old.id;

  update public.daily_problem_comments
  set hidden_by = null
  where hidden_by = old.id;

  update public.announcements
  set
    created_by = case when created_by = old.id then null else created_by end,
    updated_by = case when updated_by = old.id then null else updated_by end
  where created_by = old.id or updated_by = old.id;

  update public.profiles
  set approved_by = null
  where approved_by = old.id;

  update public.sync_jobs
  set requested_by = null
  where requested_by = old.id;

  perform public.scrub_account_deletion_audit(old.id);
  return old;
end;
$$;

revoke all on function public.prepare_auth_user_deletion()
  from public, anon, authenticated, service_role;

comment on table public.daily_problems is
  'Administrator-managed daily problem schedule. Browser access is RPC-only.';
comment on table public.daily_problem_completions is
  'Private per-member completion identities, written only through an identity-derived RPC.';
comment on table public.daily_problem_comments is
  'Member discussion with author-owned deletion and administrator visibility moderation.';
comment on function public.read_daily_problem_feed(integer, date) is
  'Returns the published Beijing-date feed with aggregate counts and only the caller own completion timestamp.';
comment on function public.set_own_daily_problem_completion(bigint, boolean) is
  'Idempotently sets or clears the approved caller own completion record.';
comment on function public.list_daily_problem_comments(bigint, integer, bigint) is
  'Lists visible discussion for approved members; approved administrators also see hidden comments.';
comment on function public.create_daily_problem_comment(bigint, text) is
  'Creates a discussion comment with the author derived from auth.uid().';
comment on function public.delete_own_daily_problem_comment(bigint, timestamptz) is
  'Optimistically deletes only the approved caller own discussion comment.';
comment on function public.admin_upsert_daily_problem(
  bigint,
  date,
  text,
  text,
  text,
  text,
  text,
  text[],
  text,
  integer,
  public.daily_problem_status,
  timestamptz
) is 'Creates or optimistically updates a rate-limited, audited daily problem.';
comment on function public.admin_delete_daily_problem(bigint, timestamptz) is
  'Physically deletes only never-published daily problems; published records must be archived.';
comment on function public.admin_set_daily_problem_comment_visibility(
  bigint,
  boolean,
  text,
  timestamptz
) is 'Optimistically hides or restores a member comment with rate limiting and audit metadata.';
comment on function public.prepare_auth_user_deletion() is
  'Clears all cross-account Auth references, including daily learning resources, before audit anonymization.';
