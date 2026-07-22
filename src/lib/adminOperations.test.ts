import type { AdminSourceHealth, AuditEntry } from '../types/domain'
import {
  buildAuditCsv,
  groupSourceHealth,
  mapAdminActiveSyncJob,
  mapAdminAuditEntry,
  mapAdminOverview,
  mapAdminSourceHealth,
  mapAdminSyncRun,
} from './adminOperations'

describe('admin operations mapping', () => {
  it('maps overview counters returned as bigint-compatible values', () => {
    expect(
      mapAdminOverview({
        approved_member_count: '12',
        pending_member_count: 3,
        failed_job_count_24h: '2',
        running_job_count: 1,
        overdue_stat_count: '4',
        credential_error_count: 2,
        verified_account_count: '51',
      }),
    ).toEqual({
      approvedMemberCount: 12,
      pendingMemberCount: 3,
      failedJobCount24h: 2,
      runningJobCount: 1,
      overdueStatCount: 4,
      credentialErrorCount: 2,
      verifiedAccountCount: 51,
    })
  })

  it('maps database run statuses and preserves retry fields', () => {
    expect(
      mapAdminSyncRun({
        run_id: '42',
        job_id: 21,
        profile_id: 'member-1',
        member_name: '测试成员',
        platform: 'qoj',
        run_status: 'succeeded',
        job_status: 'succeeded',
        trigger_type: 'retry',
        requested_by: 'admin-1',
        duration_ms: '1800',
        started_at: '2026-07-13T12:00:00Z',
        finished_at: '2026-07-13T12:00:02Z',
        error_code: null,
        error_message: null,
        source_version: 'qoj-worker-v1',
      }),
    ).toMatchObject({
      id: 42,
      jobId: 21,
      profileId: 'member-1',
      status: 'success',
      triggerType: 'retry',
      durationMs: 1800,
    })

    expect(
      mapAdminSyncRun({
        run_id: 43,
        job_id: 22,
        profile_id: 'member-2',
        member_name: null,
        platform: 'atcoder',
        run_status: 'skipped',
        job_status: 'cancelled',
        trigger_type: 'scheduled',
        requested_by: null,
        duration_ms: null,
        started_at: '2026-07-13T12:05:00Z',
        finished_at: '2026-07-13T12:05:00Z',
        error_code: null,
        error_message: null,
        source_version: null,
      }),
    ).toMatchObject({
      memberName: '未填写姓名',
      status: 'skipped',
      jobStatus: 'cancelled',
    })

    expect(
      mapAdminSyncRun({
        run_id: 44,
        job_id: 23,
        profile_id: 'member-3',
        member_name: '等待重试成员',
        platform: 'codeforces',
        run_status: 'failed',
        job_status: 'queued',
        trigger_type: 'scheduled',
        requested_by: null,
        duration_ms: 3_000,
        started_at: '2026-07-13T12:10:00Z',
        finished_at: '2026-07-13T12:10:03Z',
        error_code: 'timeout',
        error_message: 'temporary timeout',
        source_version: null,
      }),
    ).toMatchObject({
      status: 'queued',
      jobStatus: 'queued',
      errorCode: 'timeout',
    })
  })

  it('maps active queue progress without requiring a run row', () => {
    expect(
      mapAdminActiveSyncJob({
        job_id: '51',
        profile_id: 'member-1',
        member_name: '排队成员',
        scope: 'account',
        platform: 'codeforces',
        status: 'queued',
        trigger_type: 'scheduled',
        attempt_count: '1',
        max_attempts: '3',
        scheduled_for: '2026-07-15T10:02:00Z',
        started_at: null,
        created_at: '2026-07-15T10:00:00Z',
        last_error_code: 'timeout',
      }),
    ).toEqual({
      id: 51,
      profileId: 'member-1',
      memberName: '排队成员',
      scope: 'account',
      platform: 'codeforces',
      status: 'queued',
      triggerType: 'scheduled',
      attemptCount: 1,
      maxAttempts: 3,
      scheduledAt: '2026-07-15T10:02:00Z',
      startedAt: null,
      createdAt: '2026-07-15T10:00:00Z',
      errorCode: 'timeout',
    })
  })

  it('maps numeric source-health fields and groups them with weighted duration', () => {
    expect(
      mapAdminSourceHealth({
        platform: 'codeforces',
        total_runs: '5',
        succeeded_runs: '4',
        failed_runs: 1,
        success_rate: '80.0',
        average_duration_ms: '2500',
        last_success_at: '2026-07-13T12:00:00Z',
        last_failure_at: '2026-07-13T11:00:00Z',
        latest_error_code: 'timeout',
      }),
    ).toMatchObject({
      totalRuns: 5,
      successRate: 80,
      averageDurationMs: 2500,
    })

    const rows: AdminSourceHealth[] = [
      {
        platform: 'codeforces',
        totalRuns: 2,
        succeededRuns: 1,
        failedRuns: 1,
        successRate: 50,
        averageDurationMs: 100,
        lastSuccessAt: '2026-07-13T10:00:00Z',
        lastFailureAt: '2026-07-13T11:00:00Z',
        latestErrorCode: 'timeout',
      },
      {
        platform: 'atcoder',
        totalRuns: 3,
        succeededRuns: 3,
        failedRuns: 0,
        successRate: 100,
        averageDurationMs: 200,
        lastSuccessAt: '2026-07-13T12:00:00Z',
        lastFailureAt: null,
        latestErrorCode: null,
      },
    ]

    const groups = groupSourceHealth(rows)
    expect(groups[0]).toMatchObject({
      id: 'official-api',
      platformLabel: 'Codeforces / AtCoder',
      totalRuns: 5,
      succeededRuns: 4,
      failedRuns: 1,
      successRate: 80,
      averageDurationMs: 160,
      lastSuccessAt: '2026-07-13T12:00:00Z',
      latestErrorCode: 'timeout',
    })
    expect(groups[1]).toMatchObject({
      id: 'page-parsing',
      totalRuns: 0,
      successRate: null,
      averageDurationMs: null,
    })
  })

  it('turns allowlisted audit details into a redacted summary', () => {
    const entry = mapAdminAuditEntry({
      id: '9',
      actor_id: 'admin-1',
      actor_label: '管理员',
      action: 'update',
      target_table: 'profiles',
      target_id: 'member-1',
      target_label: '测试成员',
      details: {
        before_role: 'member',
        after_role: 'member',
        before_review_status: 'pending',
        after_review_status: 'approved',
        profile_fields: ['qq', 'grade'],
        qq_value: '123456789',
      },
      created_at: '2026-07-13T12:00:00Z',
    })

    expect(entry).toMatchObject({
      id: 9,
      actor: '管理员',
      action: '更新成员资料',
      target: '测试成员',
    })
    expect(entry.summary).toContain('成员状态：待启用 -> 已启用')
    expect(entry.summary).toContain('更新字段：QQ、年级')
    expect(entry.summary).not.toContain('123456789')
  })

  it('labels sync audit entries without exposing raw metadata', () => {
    expect(
      mapAdminAuditEntry({
        id: 10,
        actor_id: null,
        actor_label: null,
        action: 'sync_requested',
        target_table: 'sync_jobs',
        target_id: '31',
        target_label: '31',
        details: {
          scope: 'all',
          trigger_type: 'manual',
          platform_count: 6,
          private_value: 'do-not-export',
        },
        created_at: '2026-07-13T13:00:00Z',
      }),
    ).toEqual({
      id: 10,
      actorId: null,
      actor: '系统',
      action: '全量同步',
      targetTable: 'sync_jobs',
      targetId: '31',
      target: '全部成员',
      createdAt: '2026-07-13T13:00:00Z',
      summary: '触发方式：手动；范围：全部成员；平台数：6',
    })
  })

  it('summarizes Firecrawl rotation using only allowlisted metadata', () => {
    const entry = mapAdminAuditEntry({
      id: 11,
      actor_id: 'admin-1',
      actor_label: '管理员',
      action: 'firecrawl_api_key_update',
      target_table: 'firecrawl_api_keys',
      target_id: '00000000-0000-4000-8000-000000000301',
      target_label: '主额度池',
      details: {
        before_enabled: true,
        after_enabled: false,
        before_priority: 100,
        after_priority: 90,
        changed_fields: ['apiKey', 'enabled', 'priority'],
        reason: '轮换生产密钥',
      },
      created_at: '2026-07-19T08:00:00Z',
    })

    expect(entry).toMatchObject({
      action: '轮换 Firecrawl Key',
      target: '主额度池',
      summary: '状态：停用；优先级：90；已轮换密钥；原因：轮换生产密钥',
    })
    expect(entry.summary).not.toContain('fc-secret')
    expect(entry.summary).not.toContain('Vault Secret ID')
  })

  it('summarizes a referral program switch without exposing internal identifiers', () => {
    const entry = mapAdminAuditEntry({
      id: 12,
      actor_id: 'admin-1',
      actor_label: '管理员',
      action: 'referral_program_config_update',
      target_table: 'referral_program_config',
      target_id: 'global',
      target_label: 'Referral program',
      details: {
        before_enabled: true,
        after_enabled: false,
        reason: '排查异常邀请记录',
      },
      created_at: '2026-07-22T13:00:00Z',
    })

    expect(entry).toMatchObject({
      action: '关闭推荐计划',
      target: '推荐计划',
      summary: '状态：全线关闭；原因：排查异常邀请记录',
    })
    expect(entry.summary).not.toContain('admin-1')
    expect(entry.summary).not.toContain('global')
  })
})

describe('admin audit CSV', () => {
  it('adds a BOM, escapes quotes and neutralizes spreadsheet formulas', () => {
    const entry: AuditEntry = {
      id: 1,
      actorId: 'actor-1',
      actor: '=2+2',
      action: '+SUM(A1:A2)',
      targetTable: 'profiles',
      targetId: 'member-1',
      target: '@member',
      createdAt: '2026-07-13T12:00:00Z',
      summary: '包含 "引号" 和换行\n第二行',
    }

    const csv = buildAuditCsv([entry])
    expect(csv.startsWith('\uFEFF"actor","action","target","created_at","summary"\r\n')).toBe(true)
    expect(csv).toContain('"\'=2+2"')
    expect(csv).toContain('"\'+SUM(A1:A2)"')
    expect(csv).toContain('"\'@member"')
    expect(csv).toContain('""引号""')
    expect(csv).not.toContain('do-not-export')
  })
})
