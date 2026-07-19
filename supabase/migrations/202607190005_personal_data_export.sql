-- Authenticated members can download a versioned copy of their own account,
-- training, synchronization, and private WebChat data. The export boundary is
-- target-free and binds every query to auth.uid(); it never exposes passwords,
-- credentials, administrator identifiers, relay configuration, or other users.

create function public.export_own_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  actor_id uuid := auth.uid();
  exported_data jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'exportedAt', pg_catalog.statement_timestamp(),
    'account', pg_catalog.jsonb_build_object(
      'id', account.id,
      'email', account.email,
      'emailConfirmedAt', account.email_confirmed_at,
      'lastSignInAt', account.last_sign_in_at,
      'createdAt', account.created_at,
      'updatedAt', account.updated_at,
      'userMetadata', pg_catalog.coalesce(account.raw_user_meta_data, '{}'::jsonb)
    ),
    'profile', pg_catalog.jsonb_build_object(
      'fullName', profile.full_name,
      'qq', profile.qq,
      'grade', profile.grade,
      'major', profile.major,
      'role', profile.role,
      'reviewStatus', profile.review_status,
      'isPublic', profile.is_public,
      'reviewNote', profile.review_note,
      'reviewRequestedAt', profile.review_requested_at,
      'approvedAt', profile.approved_at,
      'createdAt', profile.created_at,
      'updatedAt', profile.updated_at
    ),
    'platformAccounts', (
      select pg_catalog.coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'platform', platform_account.platform,
            'externalId', platform_account.external_id,
            'status', platform_account.status,
            'verifiedAt', platform_account.verified_at,
            'verificationErrorCode', platform_account.verification_error_code,
            'verificationErrorMessage', platform_account.verification_error_message,
            'createdAt', platform_account.created_at,
            'updatedAt', platform_account.updated_at
          ) order by platform_account.platform
        ),
        '[]'::jsonb
      )
      from public.platform_accounts as platform_account
      where platform_account.profile_id = actor_id
    ),
    'platformStats', (
      select pg_catalog.coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'platform', stat.platform,
            'currentRating', stat.current_rating,
            'maxRating', stat.max_rating,
            'solvedCount', stat.solved_count,
            'status', stat.status,
            'sourceObservedAt', stat.source_observed_at,
            'fetchedAt', stat.fetched_at,
            'lastSuccessAt', stat.last_success_at,
            'staleAfter', stat.stale_after,
            'errorCode', stat.error_code,
            'errorMessage', stat.error_message,
            'sourceVersion', stat.source_version,
            'updatedAt', stat.updated_at
          ) order by stat.platform
        ),
        '[]'::jsonb
      )
      from public.platform_stats as stat
      where stat.profile_id = actor_id
    ),
    'statSnapshots', (
      select pg_catalog.coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', snapshot.id,
            'platform', snapshot.platform,
            'syncRunId', snapshot.sync_run_id,
            'currentRating', snapshot.current_rating,
            'maxRating', snapshot.max_rating,
            'solvedCount', snapshot.solved_count,
            'status', snapshot.status,
            'sourceObservedAt', snapshot.source_observed_at,
            'recordedAt', snapshot.recorded_at
          ) order by snapshot.recorded_at, snapshot.id
        ),
        '[]'::jsonb
      )
      from public.stat_snapshots as snapshot
      where snapshot.profile_id = actor_id
    ),
    'syncHistory', (
      select pg_catalog.coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', job.id,
            'scope', job.scope,
            'platform', job.platform,
            'status', job.status,
            'triggerType', job.trigger_type,
            'attemptCount', job.attempt_count,
            'maxAttempts', job.max_attempts,
            'scheduledFor', job.scheduled_for,
            'startedAt', job.started_at,
            'finishedAt', job.finished_at,
            'lastErrorCode', job.last_error_code,
            'lastErrorMessage', job.last_error_message,
            'createdAt', job.created_at,
            'updatedAt', job.updated_at,
            'runs', (
              select pg_catalog.coalesce(
                pg_catalog.jsonb_agg(
                  pg_catalog.jsonb_build_object(
                    'id', run.id,
                    'platform', run.platform,
                    'attempt', run.attempt,
                    'status', run.status,
                    'startedAt', run.started_at,
                    'finishedAt', run.finished_at,
                    'durationMs', run.duration_ms,
                    'httpStatus', run.http_status,
                    'errorCode', run.error_code,
                    'errorMessage', run.error_message,
                    'sourceVersion', run.source_version
                  ) order by run.attempt, run.id
                ),
                '[]'::jsonb
              )
              from public.sync_runs as run
              where run.job_id = job.id
                and run.profile_id = actor_id
            )
          ) order by job.created_at, job.id
        ),
        '[]'::jsonb
      )
      from public.sync_jobs as job
      where job.profile_id = actor_id
    ),
    'dailyProblem', pg_catalog.jsonb_build_object(
      'completions', (
        select pg_catalog.coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'problemId', problem.id,
              'problemDate', problem.problem_date,
              'title', problem.title,
              'sourcePlatform', problem.source_platform,
              'externalProblemId', problem.external_problem_id,
              'sourceUrl', problem.source_url,
              'difficulty', problem.difficulty,
              'tags', pg_catalog.to_jsonb(problem.tags),
              'completedAt', completion.completed_at
            ) order by completion.completed_at, problem.id
          ),
          '[]'::jsonb
        )
        from public.daily_problem_completions as completion
        join public.daily_problems as problem on problem.id = completion.problem_id
        where completion.profile_id = actor_id
      ),
      'comments', (
        select pg_catalog.coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', comment.id,
              'problemId', problem.id,
              'problemDate', problem.problem_date,
              'problemTitle', problem.title,
              'body', comment.body,
              'isVisible', comment.is_visible,
              'hiddenAt', comment.hidden_at,
              'createdAt', comment.created_at,
              'updatedAt', comment.updated_at
            ) order by comment.created_at, comment.id
          ),
          '[]'::jsonb
        )
        from public.daily_problem_comments as comment
        join public.daily_problems as problem on problem.id = comment.problem_id
        where comment.author_id = actor_id
      )
    ),
    'webchat', pg_catalog.jsonb_build_object(
      'access', (
        select pg_catalog.jsonb_build_object(
          'enabled', access.access_enabled,
          'pilotObservationEnabled', access.pilot_observation_enabled,
          'totalRequestLimit', access.total_request_limit,
          'totalTokenLimit', access.total_token_limit,
          'version', access.version,
          'updatedAt', access.updated_at
        )
        from private.webchat_member_access as access
        where access.user_id = actor_id
      ),
      'dailyUsage', (
        select pg_catalog.coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'usageDate', usage.usage_date,
              'requestCount', usage.request_count,
              'inputTokens', usage.input_tokens,
              'outputTokens', usage.output_tokens,
              'unknownTokens', usage.unknown_tokens,
              'totalTokens', usage.total_tokens,
              'reservedTokens', usage.reserved_tokens,
              'updatedAt', usage.updated_at
            ) order by usage.usage_date
          ),
          '[]'::jsonb
        )
        from private.webchat_daily_usage as usage
        where usage.user_id = actor_id
      ),
      'requests', (
        select pg_catalog.coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'requestId', request.request_id,
              'status', request.status,
              'quotaDate', request.quota_date,
              'requestCounted', request.request_counted,
              'claimedAt', request.claimed_at,
              'upstreamStartedAt', request.upstream_started_at,
              'finishedAt', request.finished_at,
              'reservedTokens', request.reserved_tokens,
              'inputTokens', request.input_tokens,
              'outputTokens', request.output_tokens,
              'totalTokens', request.total_tokens,
              'cachedInputTokens', request.cached_input_tokens,
              'cacheWriteTokens', request.cache_write_tokens,
              'chargedTokens', request.charged_tokens,
              'outcome', request.outcome,
              'updatedAt', request.updated_at
            ) order by request.claimed_at, request.request_id
          ),
          '[]'::jsonb
        )
        from private.webchat_requests as request
        where request.user_id = actor_id
      ),
      'conversations', (
        select pg_catalog.coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', conversation.id,
              'title', conversation.title,
              'status', conversation.status,
              'messageCount', conversation.message_count,
              'contentBytes', conversation.content_bytes,
              'version', conversation.version,
              'createdAt', conversation.created_at,
              'updatedAt', conversation.updated_at,
              'lastMessageAt', conversation.last_message_at,
              'messages', (
                select pg_catalog.coalesce(
                  pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                      'id', message.id,
                      'parentId', message.parent_id,
                      'position', message.position,
                      'format', message.format,
                      'content', message.content,
                      'createdAt', message.created_at,
                      'updatedAt', message.updated_at
                    ) order by message.position
                  ),
                  '[]'::jsonb
                )
                from private.webchat_messages as message
                where message.conversation_id = conversation.id
              )
            ) order by conversation.last_message_at, conversation.id
          ),
          '[]'::jsonb
        )
        from private.webchat_conversations as conversation
        where conversation.user_id = actor_id
      ),
      'retentionDays', 180
    )
  )
  into exported_data
  from public.profiles as profile
  join auth.users as account on account.id = profile.id
  where profile.id = actor_id;

  if exported_data is null then
    raise exception 'Member profile not found.' using errcode = '42501';
  end if;

  return exported_data;
end;
$$;

revoke all on function public.export_own_data()
from public, anon, authenticated, service_role;

grant execute on function public.export_own_data() to authenticated;

comment on function public.export_own_data() is
  'Returns a versioned JSON export of only the authenticated caller own account, training, synchronization, and private WebChat data without credentials or cross-user identifiers.';
