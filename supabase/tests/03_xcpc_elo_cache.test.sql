begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

truncate table public.xcpc_elo_cache_players;
update public.xcpc_elo_cache_state
set
  active_version = 0,
  etag = null,
  last_modified = null,
  source_generated_at = null,
  validated_at = null,
  expires_at = null,
  refresh_owner = null,
  refresh_lease_expires_at = null,
  refresh_retry_after = null,
  last_error_code = null,
  last_error_message = null;

select is(
  (public.read_xcpc_elo_cache() ->> 'activeVersion')::integer,
  0,
  'an empty XCPC ELO cache reports version zero'
);

select is(
  (
    public.acquire_xcpc_elo_cache_refresh(
      '00000000-0000-0000-0000-000000000001', 3600, 180
    ) ->> 'acquired'
  )::boolean,
  true,
  'the first worker acquires the refresh lease'
);

select is(
  public.acquire_xcpc_elo_cache_refresh(
    '00000000-0000-0000-0000-000000000002', 3600, 180
  ) ->> 'reason',
  'leased',
  'a concurrent worker observes the active lease'
);

select throws_ok(
  $$
    select public.commit_xcpc_elo_cache_refresh(
      '00000000-0000-0000-0000-000000000002',
      3600,
      '"etag-1"',
      'Tue, 14 Jul 2026 00:00:00 GMT',
      '2026-07-14T00:00:00Z',
      '[{"player_id":"xcpc_1111111111111111","normalized_name":"张三","display_name":"张三","organization":"苏州科技大学","rating":1680.5,"max_rating":1720.25,"contests":8}]'::jsonb
    )
  $$,
  '40001',
  'XCPC ELO refresh lease is no longer owned by this worker.',
  'a worker cannot commit another worker lease'
);

select is(
  public.commit_xcpc_elo_cache_refresh(
    '00000000-0000-0000-0000-000000000001',
    3600,
    '"etag-1"',
    'Tue, 14 Jul 2026 00:00:00 GMT',
    '2026-07-14T00:00:00Z',
    '[{"player_id":"xcpc_1111111111111111","normalized_name":"张三","display_name":"张三","organization":"苏州科技大学","rating":1680.5,"max_rating":1720.25,"contests":8}]'::jsonb
  ),
  1::bigint,
  'the lease owner publishes cache version one'
);

select is(
  public.read_xcpc_elo_cache() #>> '{players,0,maxRating}',
  '1720.25',
  'the cache exposes the decimal historical maximum without rounding'
);

select is(
  public.acquire_xcpc_elo_cache_refresh(
    '00000000-0000-0000-0000-000000000002', 3600, 180
  ) ->> 'reason',
  'fresh',
  'a fresh cache skips upstream refresh'
);

update public.xcpc_elo_cache_state set expires_at = now() - interval '1 second';

select is(
  (
    public.acquire_xcpc_elo_cache_refresh(
      '00000000-0000-0000-0000-000000000002', 3600, 180
    ) ->> 'acquired'
  )::boolean,
  true,
  'an expired cache can be leased by another worker'
);

select is(
  public.validate_xcpc_elo_cache_refresh(
    '00000000-0000-0000-0000-000000000002',
    3600,
    '"etag-1"',
    'Tue, 14 Jul 2026 00:00:00 GMT'
  ),
  1::bigint,
  'a 304 validation retains the active version'
);

update public.xcpc_elo_cache_state set expires_at = now() - interval '1 second';
select public.acquire_xcpc_elo_cache_refresh(
  '00000000-0000-0000-0000-000000000003', 3600, 180
);

update public.xcpc_elo_cache_state
set refresh_lease_expires_at = now() - interval '1 second';

select is(
  (
    public.acquire_xcpc_elo_cache_refresh(
      '00000000-0000-0000-0000-000000000004', 3600, 180
    ) ->> 'acquired'
  )::boolean,
  true,
  'another worker can recover an expired refresh lease'
);

select throws_ok(
  $$
    select public.validate_xcpc_elo_cache_refresh(
      '00000000-0000-0000-0000-000000000003',
      3600,
      '"stale-worker-etag"',
      null
    )
  $$,
  '40001',
  'XCPC ELO refresh lease is no longer owned by this worker.',
  'the expired lease owner cannot publish a late validation'
);

select is(
  public.fail_xcpc_elo_cache_refresh(
    '00000000-0000-0000-0000-000000000004',
    'source_unavailable',
    'upstream unavailable',
    300
  ),
  true,
  'the lease owner records a refresh failure'
);

select is(
  public.acquire_xcpc_elo_cache_refresh(
    '00000000-0000-0000-0000-000000000005', 3600, 180
  ) ->> 'reason',
  'cooldown',
  'a refresh failure activates the shared cooldown'
);

select is(
  (public.read_xcpc_elo_cache() ->> 'activeVersion')::integer,
  1,
  'a refresh failure preserves the last successful version'
);

update public.xcpc_elo_cache_state set refresh_retry_after = null;
select public.acquire_xcpc_elo_cache_refresh(
  '00000000-0000-0000-0000-000000000005', 3600, 180
);

select is(
  public.commit_xcpc_elo_cache_refresh(
    '00000000-0000-0000-0000-000000000005',
    3600,
    '"etag-2"',
    'Tue, 14 Jul 2026 01:00:00 GMT',
    '2026-07-14T01:00:00Z',
    '[{"player_id":"xcpc_2222222222222222","normalized_name":"李四","display_name":"李四","organization":"苏州科技大学","rating":1700.75,"max_rating":1750.5,"contests":9}]'::jsonb
  ),
  2::bigint,
  'a later refresh atomically publishes a new version'
);

select results_eq(
  $$
    select version, player_id
    from public.xcpc_elo_cache_players
    order by version, player_id
  $$,
  $$ values (2::bigint, 'xcpc_2222222222222222'::text) $$,
  'publishing a new version removes inactive cached players'
);

select * from finish();

rollback;
