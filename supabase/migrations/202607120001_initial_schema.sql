-- Core application schema, authorization boundaries, and public read models.

create type public.app_role as enum ('member', 'admin');
create type public.profile_review_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.platform_name as enum (
  'codeforces',
  'nowcoder',
  'atcoder',
  'xcpc_elo',
  'luogu',
  'qoj'
);
create type public.account_verification_status as enum ('pending', 'verified', 'invalid', 'disabled');
create type public.stat_freshness_status as enum ('fresh', 'stale', 'unavailable');
create type public.sync_job_scope as enum ('account', 'member', 'platform', 'all');
create type public.sync_job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.sync_trigger_type as enum ('scheduled', 'manual', 'registration', 'account_changed', 'retry');
create type public.sync_run_status as enum ('running', 'succeeded', 'failed', 'skipped');
create type public.sync_error_code as enum (
  'not_found',
  'auth_required',
  'auth_expired',
  'rate_limited',
  'schema_changed',
  'timeout',
  'network_error',
  'invalid_response',
  'invalid_account',
  'external_worker_required',
  'not_configured',
  'source_unavailable',
  'upstream_error',
  'unknown'
);
create type public.announcement_status as enum ('draft', 'published', 'archived');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  qq text,
  major text,
  role public.app_role not null default 'member',
  review_status public.profile_review_status not null default 'pending',
  is_public boolean not null default true,
  review_note text,
  review_requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_valid check (
    full_name is null or (char_length(btrim(full_name)) between 1 and 64 and full_name = btrim(full_name))
  ),
  constraint profiles_qq_valid check (qq is null or qq ~ '^[1-9][0-9]{4,11}$'),
  constraint profiles_major_valid check (
    major is null or (char_length(btrim(major)) between 1 and 100 and major = btrim(major))
  ),
  constraint profiles_review_note_length check (review_note is null or char_length(review_note) <= 1000),
  constraint profiles_approval_metadata check (
    review_status <> 'approved' or approved_at is not null
  )
);

create unique index profiles_qq_unique_idx on public.profiles (qq) where qq is not null;
create index profiles_review_public_idx on public.profiles (review_status, is_public);
create index profiles_approved_by_idx on public.profiles (approved_by) where approved_by is not null;

create table public.platform_accounts (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  platform public.platform_name not null,
  external_id text not null,
  normalized_external_id text not null,
  status public.account_verification_status not null default 'pending',
  verified_at timestamptz,
  verification_error_code public.sync_error_code,
  verification_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_accounts_profile_platform_unique unique (profile_id, platform),
  constraint platform_accounts_platform_external_unique unique (platform, normalized_external_id),
  constraint platform_accounts_external_id_length check (char_length(external_id) between 1 and 128),
  constraint platform_accounts_normalized_id_length check (char_length(normalized_external_id) between 1 and 128),
  constraint platform_accounts_external_id_format check (
    case platform
      when 'codeforces' then external_id ~ '^[A-Za-z0-9_.-]{3,24}$'
      when 'nowcoder' then external_id ~ '^[0-9]+$'
      when 'atcoder' then external_id ~ '^[A-Za-z0-9_]{1,30}$'
      when 'xcpc_elo' then external_id ~ '^xcpc_[A-Fa-f0-9]{16}$'
      when 'luogu' then external_id ~ '^[0-9]+$'
      when 'qoj' then external_id ~ '^[A-Za-z0-9_.-]{1,50}$'
    end
  ),
  constraint platform_accounts_verification_metadata check (
    (status = 'verified' and verified_at is not null)
    or (status <> 'verified' and verified_at is null)
  ),
  constraint platform_accounts_error_message_length check (
    verification_error_message is null or char_length(verification_error_message) <= 2000
  )
);

create index platform_accounts_status_idx on public.platform_accounts (status, updated_at);

create table public.sync_jobs (
  id bigint generated always as identity primary key,
  scope public.sync_job_scope not null,
  profile_id uuid references public.profiles (id) on delete cascade,
  platform public.platform_name,
  status public.sync_job_status not null default 'queued',
  trigger_type public.sync_trigger_type not null,
  requested_by uuid references auth.users (id) on delete set null,
  priority smallint not null default 0,
  attempt_count smallint not null default 0,
  max_attempts smallint not null default 3,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  last_error_code public.sync_error_code,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_jobs_scope_fields check (
    (scope = 'account' and profile_id is not null and platform is not null)
    or (scope = 'member' and profile_id is not null and platform is null)
    or (scope = 'platform' and profile_id is null and platform is not null)
    or (scope = 'all' and profile_id is null and platform is null)
  ),
  constraint sync_jobs_attempts_valid check (
    attempt_count >= 0 and max_attempts between 1 and 10 and attempt_count <= max_attempts
  ),
  constraint sync_jobs_priority_valid check (priority between -100 and 100),
  constraint sync_jobs_timestamps_valid check (
    (finished_at is null or started_at is null or finished_at >= started_at)
    and (status <> 'queued' or (started_at is null and finished_at is null))
    and (status <> 'running' or (started_at is not null and finished_at is null))
    and (status not in ('succeeded', 'failed', 'cancelled') or finished_at is not null)
  ),
  constraint sync_jobs_dedupe_key_length check (dedupe_key is null or char_length(dedupe_key) <= 256),
  constraint sync_jobs_error_message_length check (
    last_error_message is null or char_length(last_error_message) <= 4000
  ),
  constraint sync_jobs_payload_object check (jsonb_typeof(payload) = 'object')
);

create index sync_jobs_profile_id_idx on public.sync_jobs (profile_id) where profile_id is not null;
create index sync_jobs_requested_by_idx on public.sync_jobs (requested_by) where requested_by is not null;
create index sync_jobs_queue_idx on public.sync_jobs (status, priority desc, scheduled_for);
create unique index sync_jobs_active_dedupe_idx on public.sync_jobs (dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');

create table public.sync_runs (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.sync_jobs (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  platform public.platform_name not null,
  platform_account_id bigint references public.platform_accounts (id) on delete set null,
  attempt smallint not null default 1,
  status public.sync_run_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  http_status smallint,
  error_code public.sync_error_code,
  error_message text,
  source_version text,
  metrics jsonb default '{}'::jsonb,
  constraint sync_runs_job_profile_platform_attempt_unique unique (job_id, profile_id, platform, attempt),
  constraint sync_runs_attempt_valid check (attempt between 1 and 10),
  constraint sync_runs_timestamps_valid check (
    (finished_at is null or finished_at >= started_at)
    and (status = 'running' or finished_at is not null)
    and (status <> 'running' or finished_at is null)
  ),
  constraint sync_runs_duration_valid check (duration_ms is null or duration_ms >= 0),
  constraint sync_runs_http_status_valid check (http_status is null or http_status between 100 and 599),
  constraint sync_runs_error_message_length check (error_message is null or char_length(error_message) <= 4000),
  constraint sync_runs_metrics_object check (metrics is null or jsonb_typeof(metrics) = 'object')
);

create index sync_runs_profile_platform_started_idx on public.sync_runs (profile_id, platform, started_at desc);
create index sync_runs_platform_account_id_idx on public.sync_runs (platform_account_id)
  where platform_account_id is not null;
create index sync_runs_status_started_idx on public.sync_runs (status, started_at desc);

create table public.platform_stats (
  profile_id uuid not null,
  platform public.platform_name not null,
  current_rating integer,
  max_rating integer,
  solved_count integer,
  status public.stat_freshness_status not null default 'unavailable',
  source_observed_at timestamptz,
  fetched_at timestamptz not null default now(),
  last_success_at timestamptz,
  stale_after timestamptz,
  error_code public.sync_error_code,
  error_message text,
  source_version text,
  updated_at timestamptz not null default now(),
  primary key (profile_id, platform),
  constraint platform_stats_account_fkey foreign key (profile_id, platform)
    references public.platform_accounts (profile_id, platform) on delete cascade,
  constraint platform_stats_rating_order check (
    current_rating is null or max_rating is null or max_rating >= current_rating
  ),
  constraint platform_stats_solved_nonnegative check (solved_count is null or solved_count >= 0),
  constraint platform_stats_success_timestamp check (
    status <> 'fresh' or last_success_at is not null
  ),
  constraint platform_stats_stale_after check (
    stale_after is null or last_success_at is null or stale_after >= last_success_at
  ),
  constraint platform_stats_error_message_length check (error_message is null or char_length(error_message) <= 4000)
);

create index platform_stats_platform_status_idx on public.platform_stats (platform, status);
create index platform_stats_platform_rating_idx on public.platform_stats (platform, current_rating desc nulls last);
create index platform_stats_platform_solved_idx on public.platform_stats (platform, solved_count desc nulls last);
create index platform_stats_stale_after_idx on public.platform_stats (stale_after)
  where stale_after is not null;

create table public.stat_snapshots (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  platform public.platform_name not null,
  sync_run_id bigint not null references public.sync_runs (id) on delete restrict,
  current_rating integer,
  max_rating integer,
  solved_count integer,
  status public.stat_freshness_status not null,
  source_observed_at timestamptz,
  recorded_at timestamptz not null default now(),
  constraint stat_snapshots_account_fkey foreign key (profile_id, platform)
    references public.platform_accounts (profile_id, platform) on delete cascade,
  constraint stat_snapshots_run_unique unique (profile_id, platform, sync_run_id),
  constraint stat_snapshots_rating_order check (
    current_rating is null or max_rating is null or max_rating >= current_rating
  ),
  constraint stat_snapshots_solved_nonnegative check (solved_count is null or solved_count >= 0)
);

create index stat_snapshots_profile_platform_recorded_idx
  on public.stat_snapshots (profile_id, platform, recorded_at desc);
create index stat_snapshots_sync_run_id_idx on public.stat_snapshots (sync_run_id);

create table public.announcements (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null,
  status public.announcement_status not null default 'draft',
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_valid check (char_length(btrim(title)) between 1 and 120 and title = btrim(title)),
  constraint announcements_body_valid check (char_length(body) between 1 and 20000),
  constraint announcements_publish_metadata check (status <> 'published' or published_at is not null),
  constraint announcements_expiry_valid check (
    expires_at is null or published_at is null or expires_at > published_at
  )
);

create index announcements_publication_idx on public.announcements (status, published_at desc, expires_at);
create index announcements_created_by_idx on public.announcements (created_by) where created_by is not null;
create index announcements_updated_by_idx on public.announcements (updated_by) where updated_by is not null;

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_table text not null,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_valid check (char_length(action) between 1 and 100),
  constraint audit_logs_target_table_valid check (char_length(target_table) between 1 and 100),
  constraint audit_logs_target_id_length check (target_id is null or char_length(target_id) <= 256),
  constraint audit_logs_before_object check (before_data is null or jsonb_typeof(before_data) = 'object'),
  constraint audit_logs_after_object check (after_data is null or jsonb_typeof(after_data) = 'object'),
  constraint audit_logs_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index audit_logs_actor_created_idx on public.audit_logs (actor_id, created_at desc)
  where actor_id is not null;
create index audit_logs_target_created_idx on public.audit_logs (target_table, target_id, created_at desc);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and review_status = 'approved'
  );
$$;

create or replace function public.can_edit_own_data()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and review_status <> 'suspended'
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_is_admin boolean := public.is_admin()
    or coalesce((select auth.role()), '') = 'service_role'
    or ((select auth.role()) is null and session_user in ('postgres', 'supabase_admin'));
begin
  if requester_is_admin then
    if new.review_status = 'approved' and old.review_status is distinct from 'approved' then
      if new.full_name is null or new.qq is null or new.major is null then
        raise exception 'A profile must contain full_name, qq, and major before approval.';
      end if;
      new.approved_at := now();
      new.approved_by := coalesce((select auth.uid()), new.approved_by, new.id);
      new.review_note := null;
    elsif new.review_status is distinct from 'approved' then
      new.approved_at := null;
      new.approved_by := null;
    end if;
  else
    if old.review_status = 'suspended' then
      raise exception 'Suspended profiles cannot be modified.';
    end if;

    if new.id is distinct from old.id
      or new.role is distinct from old.role
      or new.review_status is distinct from old.review_status
      or new.review_note is distinct from old.review_note
      or new.approved_at is distinct from old.approved_at
      or new.approved_by is distinct from old.approved_by then
      raise exception 'Managed profile fields can only be changed by an administrator.';
    end if;

    if new.full_name is distinct from old.full_name
      or new.qq is distinct from old.qq
      or new.major is distinct from old.major
      or new.review_requested_at is distinct from old.review_requested_at then
      new.review_status := 'pending';
      new.review_note := null;
      new.review_requested_at := now();
      new.approved_at := null;
      new.approved_by := null;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prepare_platform_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_is_admin boolean := public.is_admin()
    or coalesce((select auth.role()), '') = 'service_role'
    or ((select auth.role()) is null and session_user in ('postgres', 'supabase_admin'));
  external_id_changed boolean := false;
begin
  new.external_id := btrim(new.external_id);
  new.normalized_external_id := lower(new.external_id);

  if tg_op = 'INSERT' then
    if not requester_is_admin then
      new.status := 'pending';
      new.verified_at := null;
      new.verification_error_code := null;
      new.verification_error_message := null;
    end if;
  else
    external_id_changed := new.external_id is distinct from old.external_id;

    if not requester_is_admin then
      if new.profile_id is distinct from old.profile_id
        or new.platform is distinct from old.platform
        or new.status is distinct from old.status
        or new.verified_at is distinct from old.verified_at
        or new.verification_error_code is distinct from old.verification_error_code
        or new.verification_error_message is distinct from old.verification_error_message then
        raise exception 'Managed platform account fields can only be changed by an administrator.';
      end if;

      if external_id_changed then
        new.status := 'pending';
        new.verified_at := null;
        new.verification_error_code := null;
        new.verification_error_message := null;
      end if;
    elsif external_id_changed and new.status = old.status then
      new.status := 'pending';
      new.verified_at := null;
      new.verification_error_code := null;
      new.verification_error_message := null;
    end if;
  end if;

  if new.status = 'verified' then
    new.verified_at := coalesce(new.verified_at, now());
    new.verification_error_code := null;
    new.verification_error_message := null;
  else
    new.verified_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.invalidate_stats_after_account_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.external_id is distinct from old.external_id then
    update public.platform_stats
    set status = 'unavailable',
        error_code = null,
        error_message = 'Platform account changed; awaiting verification.'
    where profile_id = new.profile_id and platform = new.platform;
  end if;
  return new;
end;
$$;

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_data jsonb;
  new_data jsonb;
begin
  if tg_op <> 'INSERT' then
    old_data := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    new_data := to_jsonb(new);
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    target_table,
    target_id,
    before_data,
    after_data
  ) values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(new_data ->> 'id', old_data ->> 'id'),
    old_data,
    new_data
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger profiles_protect_fields
before update on public.profiles
for each row execute function public.protect_profile_fields();

create trigger platform_accounts_prepare
before insert or update on public.platform_accounts
for each row execute function public.prepare_platform_account();

create trigger platform_accounts_set_updated_at
before update on public.platform_accounts
for each row execute function public.set_updated_at();

create trigger platform_accounts_invalidate_stats
after update of external_id on public.platform_accounts
for each row execute function public.invalidate_stats_after_account_change();

create trigger platform_stats_set_updated_at
before update on public.platform_stats
for each row execute function public.set_updated_at();

create trigger sync_jobs_set_updated_at
before update on public.sync_jobs
for each row execute function public.set_updated_at();

create trigger announcements_set_updated_at
before update on public.announcements
for each row execute function public.set_updated_at();

create trigger profiles_audit
after update or delete on public.profiles
for each row execute function public.write_audit_log();

create trigger platform_accounts_audit
after insert or update or delete on public.platform_accounts
for each row execute function public.write_audit_log();

create trigger announcements_audit
after insert or update or delete on public.announcements
for each row execute function public.write_audit_log();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.platform_accounts enable row level security;
alter table public.platform_stats enable row level security;
alter table public.stat_snapshots enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.sync_runs enable row level security;
alter table public.announcements enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select_self on public.profiles
for select to authenticated
using (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()) and review_status <> 'suspended')
with check (id = (select auth.uid()));

create policy profiles_admin_all on public.profiles
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy platform_accounts_select_self on public.platform_accounts
for select to authenticated
using (profile_id = (select auth.uid()));

create policy platform_accounts_insert_self on public.platform_accounts
for insert to authenticated
with check (profile_id = (select auth.uid()) and (select public.can_edit_own_data()));

create policy platform_accounts_update_self on public.platform_accounts
for update to authenticated
using (profile_id = (select auth.uid()) and (select public.can_edit_own_data()))
with check (profile_id = (select auth.uid()) and (select public.can_edit_own_data()));

create policy platform_accounts_delete_self on public.platform_accounts
for delete to authenticated
using (profile_id = (select auth.uid()) and (select public.can_edit_own_data()));

create policy platform_accounts_admin_all on public.platform_accounts
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy platform_stats_select_self on public.platform_stats
for select to authenticated
using (profile_id = (select auth.uid()));

create policy platform_stats_admin_all on public.platform_stats
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy stat_snapshots_select_self on public.stat_snapshots
for select to authenticated
using (profile_id = (select auth.uid()));

create policy stat_snapshots_admin_all on public.stat_snapshots
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy sync_jobs_select_related on public.sync_jobs
for select to authenticated
using (profile_id = (select auth.uid()) or requested_by = (select auth.uid()));

create policy sync_jobs_admin_all on public.sync_jobs
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy sync_runs_select_self on public.sync_runs
for select to authenticated
using (profile_id = (select auth.uid()));

create policy sync_runs_admin_all on public.sync_runs
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy announcements_admin_all on public.announcements
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy audit_logs_admin_select on public.audit_logs
for select to authenticated
using ((select public.is_admin()));

create view public.public_members
with (security_barrier = true)
as
select id, full_name, major, created_at, updated_at
from public.profiles
where review_status = 'approved' and is_public;

create view public.public_platform_accounts
with (security_barrier = true)
as
select a.profile_id, a.platform, a.external_id, a.verified_at
from public.platform_accounts as a
join public.profiles as p on p.id = a.profile_id
where p.review_status = 'approved'
  and p.is_public
  and a.status = 'verified';

create view public.public_platform_stats
with (security_barrier = true)
as
select
  s.profile_id,
  s.platform,
  s.current_rating,
  s.max_rating,
  s.solved_count,
  s.status,
  s.source_observed_at,
  s.fetched_at,
  s.last_success_at,
  s.stale_after,
  s.error_code,
  s.source_version,
  s.updated_at
from public.platform_stats as s
join public.profiles as p on p.id = s.profile_id
join public.platform_accounts as a
  on a.profile_id = s.profile_id and a.platform = s.platform
where p.review_status = 'approved'
  and p.is_public
  and a.status = 'verified';

create view public.public_stat_snapshots
with (security_barrier = true)
as
select
  s.id,
  s.profile_id,
  s.platform,
  s.current_rating,
  s.max_rating,
  s.solved_count,
  s.status,
  s.source_observed_at,
  s.recorded_at
from public.stat_snapshots as s
join public.profiles as p on p.id = s.profile_id
join public.platform_accounts as a
  on a.profile_id = s.profile_id and a.platform = s.platform
where p.review_status = 'approved'
  and p.is_public
  and a.status = 'verified';

create view public.public_announcements
with (security_barrier = true)
as
select id, title, body, published_at, expires_at, created_at, updated_at
from public.announcements
where status = 'published'
  and published_at <= now()
  and (expires_at is null or expires_at > now());

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.platform_accounts to authenticated;
grant select, insert, update, delete on public.platform_stats to authenticated;
grant select, insert, update, delete on public.stat_snapshots to authenticated;
grant select, insert, update, delete on public.sync_jobs to authenticated;
grant select, insert, update, delete on public.sync_runs to authenticated;
grant select, insert, update, delete on public.announcements to authenticated;
grant select on public.audit_logs to authenticated;

grant usage, select on sequence public.platform_accounts_id_seq to authenticated;
grant usage, select on sequence public.sync_jobs_id_seq to authenticated;
grant usage, select on sequence public.sync_runs_id_seq to authenticated;
grant usage, select on sequence public.stat_snapshots_id_seq to authenticated;
grant usage, select on sequence public.announcements_id_seq to authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_edit_own_data() to authenticated;

grant select on public.public_members to anon, authenticated;
grant select on public.public_platform_accounts to anon, authenticated;
grant select on public.public_platform_stats to anon, authenticated;
grant select on public.public_stat_snapshots to anon, authenticated;
grant select on public.public_announcements to anon, authenticated;

comment on view public.public_members is 'Approved public member fields; deliberately excludes QQ and review metadata.';
comment on view public.public_platform_stats is 'Sanitized current statistics for approved public members.';
comment on table public.audit_logs is 'Append-only application audit trail. Direct client inserts, updates, and deletes are not granted.';
