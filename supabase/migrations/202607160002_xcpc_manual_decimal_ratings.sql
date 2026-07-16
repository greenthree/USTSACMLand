-- Keep administrator-supplied XCPC ELO values consistent with the upstream
-- decimal Rating contract while retaining integer-only input for the other
-- Rating platforms.

do $$
declare
  old_signature regprocedure := 'public.admin_set_manual_platform_stats_unlimited(uuid,public.platform_name,integer,integer,integer,timestamp with time zone,text,timestamp with time zone)'::regprocedure;
  function_definition text;
  numeric_definition text;
begin
  select pg_catalog.pg_get_functiondef(old_signature::oid)
  into function_definition;

  if position('manual_current_rating integer' in function_definition) = 0
    or position('manual_max_rating integer' in function_definition) = 0 then
    raise exception 'Could not locate the integer manual Rating parameters';
  end if;

  numeric_definition := replace(
    replace(
      function_definition,
      'manual_current_rating integer',
      'manual_current_rating numeric'
    ),
    'manual_max_rating integer',
    'manual_max_rating numeric'
  );

  execute numeric_definition;
end;
$$;

revoke all on function public.admin_set_manual_platform_stats_unlimited(
  uuid,
  public.platform_name,
  numeric,
  numeric,
  integer,
  timestamptz,
  text,
  timestamptz
) from public, anon, authenticated;

drop function public.admin_set_manual_platform_stats(
  uuid,
  public.platform_name,
  integer,
  integer,
  integer,
  timestamptz,
  text,
  timestamptz
);

drop function public.admin_set_manual_platform_stats_unlimited(
  uuid,
  public.platform_name,
  integer,
  integer,
  integer,
  timestamptz,
  text,
  timestamptz
);

create function public.admin_set_manual_platform_stats(
  target_profile_id uuid,
  target_platform public.platform_name,
  manual_current_rating numeric,
  manual_max_rating numeric,
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

  if target_platform = 'xcpc_elo'::public.platform_name
    and (
      (manual_current_rating is not null
        and pg_catalog.trunc(manual_current_rating, 2) <> manual_current_rating)
      or (manual_max_rating is not null
        and pg_catalog.trunc(manual_max_rating, 2) <> manual_max_rating)
    ) then
    raise exception 'XCPC ELO Rating supports at most two decimal places.'
      using errcode = '22023';
  end if;

  if target_platform in (
    'codeforces'::public.platform_name,
    'nowcoder'::public.platform_name,
    'atcoder'::public.platform_name
  ) and (
    (manual_current_rating is not null
      and pg_catalog.trunc(manual_current_rating) <> manual_current_rating)
    or (manual_max_rating is not null
      and pg_catalog.trunc(manual_max_rating) <> manual_max_rating)
  ) then
    raise exception 'Rating must be a non-negative integer for platform %.', target_platform
      using errcode = '22023';
  end if;

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

revoke all on function public.admin_set_manual_platform_stats(
  uuid,
  public.platform_name,
  numeric,
  numeric,
  integer,
  timestamptz,
  text,
  timestamptz
) from public, anon;

grant execute on function public.admin_set_manual_platform_stats(
  uuid,
  public.platform_name,
  numeric,
  numeric,
  integer,
  timestamptz,
  text,
  timestamptz
) to authenticated;

comment on function public.admin_set_manual_platform_stats_unlimited(
  uuid,
  public.platform_name,
  numeric,
  numeric,
  integer,
  timestamptz,
  text,
  timestamptz
) is 'Writes validated administrator-supplied statistics; XCPC ELO preserves two decimal Rating places.';

comment on function public.admin_set_manual_platform_stats(
  uuid,
  public.platform_name,
  numeric,
  numeric,
  integer,
  timestamptz,
  text,
  timestamptz
) is 'Rate-limited administrator manual statistics entry with two-decimal XCPC ELO support.';
