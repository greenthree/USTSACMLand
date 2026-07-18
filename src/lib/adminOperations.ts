import { platformLabels } from './platforms'
import { buildCsv } from './csv'
import { adminFunctionError } from './adminRateLimit'
import { supabase } from './supabase'
import {
  platforms,
  type AdminOverview,
  type AdminSourceHealth,
  type AdminSourceHealthGroup,
  type AdminSyncBatchResult,
  type AdminSyncRetryResult,
  type AuditEntry,
  type Platform,
  type SyncJobStatus,
  type SyncJobScope,
  type SyncQueueJob,
  type SyncRun,
  type SyncRunStatus,
  type SyncTriggerType,
} from '../types/domain'

interface AdminOverviewRow {
  approved_member_count: number | string | null
  pending_member_count: number | string | null
  failed_job_count_24h: number | string | null
  running_job_count: number | string | null
  overdue_stat_count: number | string | null
  credential_error_count: number | string | null
  verified_account_count: number | string | null
}

interface AdminSyncRunRow {
  run_id: number | string
  job_id: number | string
  profile_id: string
  member_name: string | null
  platform: Platform
  run_status: 'succeeded' | 'running' | 'failed' | 'skipped'
  job_status: SyncJobStatus
  trigger_type: SyncTriggerType
  requested_by: string | null
  duration_ms: number | string | null
  started_at: string
  finished_at: string | null
  error_code: string | null
  error_message: string | null
  source_version: string | null
}

interface AdminActiveSyncJobRow {
  job_id: number | string
  profile_id: string | null
  member_name: string | null
  scope: SyncJobScope
  platform: Platform | null
  status: 'queued' | 'running'
  trigger_type: SyncTriggerType
  attempt_count: number | string
  max_attempts: number | string
  scheduled_for: string
  started_at: string | null
  created_at: string
  last_error_code: string | null
}

interface AdminSourceHealthRow {
  platform: Platform
  total_runs: number | string | null
  succeeded_runs: number | string | null
  failed_runs: number | string | null
  success_rate: number | string | null
  average_duration_ms: number | string | null
  last_success_at: string | null
  last_failure_at: string | null
  latest_error_code: string | null
}

interface AdminAuditRow {
  id: number | string
  actor_id: string | null
  actor_label: string | null
  action: string
  target_table: string
  target_id: string | null
  target_label: string | null
  details: unknown
  created_at: string
}

interface RpcResponse {
  data: unknown
  error: { message: string } | null
}

type UntypedRpc = (functionName: string, args?: Record<string, unknown>) => PromiseLike<RpcResponse>

const emptyOverview: AdminOverview = {
  approvedMemberCount: 0,
  pendingMemberCount: 0,
  failedJobCount24h: 0,
  runningJobCount: 0,
  overdueStatCount: 0,
  credentialErrorCount: 0,
  verifiedAccountCount: 0,
}

const sourceGroups: Array<Pick<AdminSourceHealthGroup, 'id' | 'label' | 'platforms'>> = [
  {
    id: 'official-api',
    label: '官方 API',
    platforms: ['codeforces', 'atcoder'],
  },
  {
    id: 'page-parsing',
    label: '页面解析',
    platforms: ['nowcoder', 'luogu', 'xcpc_elo'],
  },
  {
    id: 'authenticated-browser',
    label: '认证浏览器',
    platforms: ['qoj'],
  },
]

const reviewStatusLabels: Record<string, string> = {
  pending: '待启用',
  approved: '已启用',
  rejected: '未启用',
  suspended: '已停用',
}

const accountStatusLabels: Record<string, string> = {
  pending: '待验证',
  verified: '已验证',
  invalid: '无效',
  disabled: '已停用',
}

const roleLabels: Record<string, string> = {
  member: '成员',
  admin: '管理员',
}

const profileFieldLabels: Record<string, string> = {
  full_name: '姓名',
  qq: 'QQ',
  major: '专业',
  grade: '年级',
  is_public: '公开状态',
}

const triggerLabels: Record<string, string> = {
  scheduled: '定时任务',
  manual: '手动',
  registration: '注册',
  account_changed: '账号变更',
  retry: '重试',
}

const scopeLabels: Record<string, string> = {
  account: '单个账号',
  member: '单个成员',
  platform: '单个平台',
  all: '全部成员',
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function platformValue(value: unknown): Platform | null {
  return typeof value === 'string' && platforms.includes(value as Platform)
    ? (value as Platform)
    : null
}

function rowsFromRpc<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  return data === null || data === undefined ? [] : [data as T]
}

async function callAdminRpc<T>(
  functionName: string,
  args: Record<string, unknown> | undefined,
  errorPrefix: string,
): Promise<T[]> {
  if (!supabase) return []

  // The production database types can lag one migration behind during local development.
  const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc
  const { data, error } = await rpc(functionName, args)
  if (error) throw await adminFunctionError(errorPrefix, error)
  return rowsFromRpc<T>(data)
}

export function mapAdminOverview(row: AdminOverviewRow): AdminOverview {
  return {
    approvedMemberCount: numberValue(row.approved_member_count),
    pendingMemberCount: numberValue(row.pending_member_count),
    failedJobCount24h: numberValue(row.failed_job_count_24h),
    runningJobCount: numberValue(row.running_job_count),
    overdueStatCount: numberValue(row.overdue_stat_count),
    credentialErrorCount: numberValue(row.credential_error_count),
    verifiedAccountCount: numberValue(row.verified_account_count),
  }
}

function mapRunStatus(
  status: AdminSyncRunRow['run_status'],
  jobStatus: SyncJobStatus,
): SyncRunStatus {
  if (jobStatus === 'queued') return 'queued'
  return status === 'succeeded' ? 'success' : status
}

export function mapAdminSyncRun(row: AdminSyncRunRow): SyncRun {
  return {
    id: numberValue(row.run_id),
    jobId: numberValue(row.job_id),
    profileId: row.profile_id,
    platform: row.platform,
    memberName: row.member_name?.trim() || '未填写姓名',
    status: mapRunStatus(row.run_status, row.job_status),
    jobStatus: row.job_status,
    triggerType: row.trigger_type,
    requestedBy: row.requested_by,
    durationMs: nullableNumber(row.duration_ms),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    sourceVersion: row.source_version,
  }
}

export function mapAdminActiveSyncJob(row: AdminActiveSyncJobRow): SyncQueueJob {
  return {
    id: numberValue(row.job_id),
    profileId: row.profile_id,
    memberName: row.member_name?.trim() || (row.scope === 'all' ? '全部成员' : '未填写姓名'),
    scope: row.scope,
    platform: row.platform,
    status: row.status,
    triggerType: row.trigger_type,
    attemptCount: numberValue(row.attempt_count),
    maxAttempts: numberValue(row.max_attempts, 1),
    scheduledAt: row.scheduled_for,
    startedAt: row.started_at,
    createdAt: row.created_at,
    errorCode: row.last_error_code,
  }
}

export function mapAdminSourceHealth(row: AdminSourceHealthRow): AdminSourceHealth {
  return {
    platform: row.platform,
    totalRuns: numberValue(row.total_runs),
    succeededRuns: numberValue(row.succeeded_runs),
    failedRuns: numberValue(row.failed_runs),
    successRate: nullableNumber(row.success_rate),
    averageDurationMs: nullableNumber(row.average_duration_ms),
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    latestErrorCode: row.latest_error_code,
  }
}

function latestTimestamp(values: Array<string | null>): string | null {
  return values.reduce<string | null>((latest, value) => {
    if (!value) return latest
    if (!latest || Date.parse(value) > Date.parse(latest)) return value
    return latest
  }, null)
}

export function groupSourceHealth(rows: AdminSourceHealth[]): AdminSourceHealthGroup[] {
  return sourceGroups.map((definition) => {
    const matches = rows.filter((row) => definition.platforms.includes(row.platform))
    const totalRuns = matches.reduce((total, row) => total + row.totalRuns, 0)
    const succeededRuns = matches.reduce((total, row) => total + row.succeededRuns, 0)
    const failedRuns = matches.reduce((total, row) => total + row.failedRuns, 0)
    const durationRows = matches.filter(
      (row) => row.averageDurationMs !== null && row.totalRuns > 0,
    )
    const durationSamples = durationRows.reduce((total, row) => total + row.totalRuns, 0)
    const lastFailureAt = latestTimestamp(matches.map((row) => row.lastFailureAt))
    const latestFailure = matches.find((row) => row.lastFailureAt === lastFailureAt)

    return {
      ...definition,
      platformLabel: definition.platforms.map((platform) => platformLabels[platform]).join(' / '),
      totalRuns,
      succeededRuns,
      failedRuns,
      successRate: totalRuns > 0 ? Math.round((succeededRuns / totalRuns) * 1000) / 10 : null,
      averageDurationMs:
        durationSamples > 0
          ? Math.round(
              durationRows.reduce(
                (total, row) => total + (row.averageDurationMs ?? 0) * row.totalRuns,
                0,
              ) / durationSamples,
            )
          : null,
      lastSuccessAt: latestTimestamp(matches.map((row) => row.lastSuccessAt)),
      lastFailureAt,
      latestErrorCode: latestFailure?.latestErrorCode ?? null,
    }
  })
}

function transitionSummary(
  label: string,
  before: string | null,
  after: string | null,
  labels: Record<string, string>,
): string | null {
  if (!after || before === after) return null
  const afterLabel = labels[after] ?? after
  return before
    ? `${label}：${labels[before] ?? before} -> ${afterLabel}`
    : `${label}：${afterLabel}`
}

function profileAuditSummary(details: Record<string, unknown>): string {
  const parts = [
    transitionSummary(
      '角色',
      stringValue(details.before_role),
      stringValue(details.after_role),
      roleLabels,
    ),
    transitionSummary(
      '成员状态',
      stringValue(details.before_review_status),
      stringValue(details.after_review_status),
      reviewStatusLabels,
    ),
  ].filter((part): part is string => Boolean(part))
  const fields = stringArray(details.profile_fields)
    .map((field) => profileFieldLabels[field])
    .filter((field): field is string => Boolean(field))
  if (fields.length > 0) parts.push(`更新字段：${fields.join('、')}`)
  return parts.join('；') || '成员记录已更新'
}

function accountAuditSummary(details: Record<string, unknown>): string {
  const platform = platformValue(details.platform)
  const parts = platform ? [platformLabels[platform]] : []
  const status = transitionSummary(
    '状态',
    stringValue(details.before_status),
    stringValue(details.after_status),
    accountStatusLabels,
  )
  if (status) parts.push(status)
  if (details.external_id_changed === true) parts.push('平台账号已变更')
  return parts.join('；') || '平台账号记录已更新'
}

function syncAuditSummary(details: Record<string, unknown>): string {
  const trigger = stringValue(details.trigger_type)
  const scope = stringValue(details.scope)
  const platform = platformValue(details.platform)
  const platformCount = nullableNumber(details.platform_count)
  const parts = [
    trigger ? `触发方式：${triggerLabels[trigger] ?? trigger}` : null,
    scope ? `范围：${scopeLabels[scope] ?? scope}` : null,
    platform ? `平台：${platformLabels[platform]}` : null,
    platformCount !== null ? `平台数：${platformCount}` : null,
  ].filter((part): part is string => Boolean(part))
  return parts.join('；') || '已请求同步任务'
}

function firecrawlAuditSummary(details: Record<string, unknown>): string {
  const reason = stringValue(details.reason)
  const beforeEnabled = details.before_enabled
  const afterEnabled = details.after_enabled
  const beforePriority = nullableNumber(details.before_priority)
  const afterPriority = nullableNumber(details.after_priority)
  const changedFields = stringArray(details.changed_fields)
  const parts = [
    beforeEnabled !== afterEnabled && typeof afterEnabled === 'boolean'
      ? afterEnabled
        ? '状态：启用'
        : '状态：停用'
      : null,
    beforePriority !== afterPriority && afterPriority !== null ? `优先级：${afterPriority}` : null,
    changedFields.includes('apiKey') ? '已轮换密钥' : null,
    reason ? `原因：${reason}` : null,
  ].filter((part): part is string => Boolean(part))
  return parts.join('；') || 'Firecrawl Key 配置已更新'
}

function auditAction(row: AdminAuditRow, details: Record<string, unknown>): string {
  if (row.target_table === 'profiles') {
    const fieldsChanged = stringArray(details.profile_fields).length > 0
    const beforeRole = stringValue(details.before_role)
    const afterRole = stringValue(details.after_role)
    const afterReviewStatus = stringValue(details.after_review_status)
    if (beforeRole !== afterRole && afterRole === 'admin') return '设置管理员'
    if (fieldsChanged) return '更新成员资料'
    if (afterReviewStatus === 'approved') return '启用成员'
    if (afterReviewStatus === 'rejected') return '设为未启用'
    if (afterReviewStatus === 'suspended') return '停用成员'
    if (afterReviewStatus === 'pending') return '恢复待启用状态'
    if (row.action === 'delete') return '删除成员'
    return '更新成员'
  }

  if (row.target_table === 'platform_accounts') {
    const beforeStatus = stringValue(details.before_status)
    const afterStatus = stringValue(details.after_status)
    if (row.action === 'insert') return '添加平台绑定'
    if (row.action === 'delete') return '删除平台绑定'
    if (details.external_id_changed === true) return '修改平台绑定'
    if (beforeStatus !== afterStatus && afterStatus === 'verified') return '验证平台账号'
    if (beforeStatus !== afterStatus && afterStatus === 'invalid') return '标记平台账号无效'
    if (beforeStatus !== afterStatus && afterStatus === 'disabled') return '停用平台账号'
    if (beforeStatus !== afterStatus && afterStatus === 'pending') return '恢复平台账号审核'
    return '更新平台账号'
  }

  if (row.target_table === 'sync_jobs' || row.action === 'sync_requested') {
    if (details.trigger_type === 'retry') return '重试同步'
    if (details.scope === 'all') return '全量同步'
    return '请求同步'
  }

  if (row.target_table === 'platform_stats' && row.action === 'manual_stats_updated') {
    return '手工录入平台数据'
  }

  if (row.target_table === 'announcements') {
    if (row.action === 'insert') return '创建公告'
    if (row.action === 'delete') return '删除公告'
    return '更新公告'
  }

  if (row.target_table === 'daily_problems') {
    if (row.action === 'insert') return '创建每日一题'
    if (row.action === 'delete') return '删除每日一题'
    if (details.after_status === 'archived') return '归档每日一题'
    if (details.after_status === 'published') return '发布每日一题'
    return '更新每日一题'
  }

  if (row.target_table === 'daily_problem_comments') {
    if (details.after_visibility === 'hidden') return '隐藏题目讨论'
    if (details.after_visibility === 'visible') return '恢复题目讨论'
    return '管理题目讨论'
  }

  if (row.target_table === 'firecrawl_api_keys') {
    if (row.action === 'firecrawl_api_key_create') return '新增 Firecrawl Key'
    if (row.action === 'firecrawl_api_key_delete') return '删除 Firecrawl Key'
    if (stringArray(details.changed_fields).includes('apiKey')) return '轮换 Firecrawl Key'
    if (details.before_enabled !== details.after_enabled) {
      return details.after_enabled === true ? '启用 Firecrawl Key' : '停用 Firecrawl Key'
    }
    return '更新 Firecrawl Key'
  }

  const actionLabels: Record<string, string> = {
    insert: '新增记录',
    update: '更新记录',
    delete: '删除记录',
  }
  return actionLabels[row.action] ?? row.action
}

function auditTarget(row: AdminAuditRow, details: Record<string, unknown>): string {
  if (row.target_table === 'sync_jobs') {
    if (details.scope === 'all') return '全部成员'
    const platform = platformValue(details.platform)
    if (details.scope === 'platform' && platform) return platformLabels[platform]
  }

  const target = row.target_label?.trim() || row.target_id || '--'
  if (row.target_table !== 'platform_accounts') return target
  const platform = platformValue(details.platform)
  return platform ? `${target} / ${platformLabels[platform]}` : target
}

export function mapAdminAuditEntry(row: AdminAuditRow): AuditEntry {
  const details = recordValue(row.details)
  const summary =
    row.target_table === 'profiles'
      ? profileAuditSummary(details)
      : row.target_table === 'platform_accounts'
        ? accountAuditSummary(details)
        : row.target_table === 'sync_jobs'
          ? syncAuditSummary(details)
          : row.target_table === 'firecrawl_api_keys'
            ? firecrawlAuditSummary(details)
            : `${auditAction(row, details)}。`

  return {
    id: numberValue(row.id),
    actorId: row.actor_id,
    actor: row.actor_label?.trim() || (row.actor_id ? '未知账号' : '系统'),
    action: auditAction(row, details),
    targetTable: row.target_table,
    targetId: row.target_id,
    target: auditTarget(row, details),
    createdAt: row.created_at,
    summary,
  }
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const rows = await callAdminRpc<AdminOverviewRow>(
    'admin_get_overview',
    undefined,
    '后台概览读取失败',
  )
  return rows[0] ? mapAdminOverview(rows[0]) : { ...emptyOverview }
}

export async function fetchAdminSyncRuns(
  rowLimit = 50,
  beforeRunId: number | null = null,
): Promise<SyncRun[]> {
  const rows = await callAdminRpc<AdminSyncRunRow>(
    'admin_list_sync_runs',
    { row_limit: rowLimit, before_run_id: beforeRunId },
    '同步记录读取失败',
  )
  return rows.map(mapAdminSyncRun)
}

export async function fetchAdminActiveSyncJobs(
  rowLimit = 50,
  beforeJobId: number | null = null,
): Promise<SyncQueueJob[]> {
  const rows = await callAdminRpc<AdminActiveSyncJobRow>(
    'admin_list_active_sync_jobs',
    { row_limit: rowLimit, before_job_id: beforeJobId },
    '同步队列读取失败',
  )
  return rows.map(mapAdminActiveSyncJob)
}

export async function fetchAdminSourceHealth(lookbackHours = 168): Promise<AdminSourceHealth[]> {
  const rows = await callAdminRpc<AdminSourceHealthRow>(
    'admin_get_source_health',
    { lookback_hours: lookbackHours },
    '数据源健康状态读取失败',
  )
  return rows.map(mapAdminSourceHealth)
}

export async function fetchAdminAuditEntries(
  rowLimit = 50,
  beforeLogId: number | null = null,
): Promise<AuditEntry[]> {
  const rows = await callAdminRpc<AdminAuditRow>(
    'admin_list_audit_logs',
    { row_limit: rowLimit, before_log_id: beforeLogId },
    '审计日志读取失败',
  )
  return rows.map(mapAdminAuditEntry)
}

export type AdminScopedSyncTarget =
  { scope: 'member'; memberId: string } | { scope: 'platform'; platform: Platform }

async function triggerAdminSync(
  body: Record<string, unknown>,
  errorPrefix: string,
): Promise<AdminSyncBatchResult> {
  if (!supabase) return { requested: 0, succeeded: 0, queued: 0, failed: 0 }

  const total: AdminSyncBatchResult = { requested: 0, succeeded: 0, queued: 0, failed: 0 }
  const seenCursors = new Set<number>()
  let cursor: number | null = null

  while (true) {
    const { data, error } = await supabase.functions.invoke('sync-stats', {
      body: {
        ...body,
        batch_size: 6,
        ...(cursor === null ? {} : { cursor }),
      },
    })
    if (error) {
      const mapped = await adminFunctionError(errorPrefix, error)
      throw total.requested > 0
        ? new Error(`${mapped.message}（此前已处理 ${total.requested} 个平台账号。）`)
        : mapped
    }

    const response = recordValue(data)
    total.requested += numberValue(response.requested)
    total.succeeded += numberValue(response.succeeded)
    total.queued += numberValue(response.queued)
    total.failed += numberValue(response.failed)

    const nextCursor = nullableNumber(response.nextCursor)
    if (nextCursor === null) return total
    if (nextCursor <= 0 || nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new Error(`${errorPrefix}：同步分页游标未继续前进。`)
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }
}

export async function triggerAdminFullSync(): Promise<AdminSyncBatchResult> {
  return triggerAdminSync({ scope: 'all' }, '全量同步失败')
}

export async function triggerAdminScopedSync(
  target: AdminScopedSyncTarget,
): Promise<AdminSyncBatchResult> {
  return triggerAdminSync(
    target.scope === 'member'
      ? { scope: 'member', member_id: target.memberId }
      : { scope: 'platform', platform: target.platform },
    '范围同步失败',
  )
}

export async function retryAdminSyncRun(
  run: Pick<SyncRun, 'profileId' | 'platform'>,
): Promise<AdminSyncRetryResult> {
  if (!supabase) return { jobId: null, memberId: run.profileId, status: 'success' }

  const { data, error } = await supabase.functions.invoke('sync-member', {
    body: {
      memberId: run.profileId,
      platforms: [run.platform],
      triggerType: 'retry',
    },
  })
  if (error) throw await adminFunctionError('同步重试失败', error)
  const response = recordValue(data)
  return {
    jobId: nullableNumber(response.jobId),
    memberId: stringValue(response.memberId) ?? run.profileId,
    status:
      response.status === 'failed' ? 'failed' : response.status === 'queued' ? 'queued' : 'success',
  }
}

export function buildAuditCsv(entries: AuditEntry[]): string {
  return buildCsv(
    ['actor', 'action', 'target', 'created_at', 'summary'],
    entries.map((entry) => [
      entry.actor,
      entry.action,
      entry.target,
      entry.createdAt,
      entry.summary,
    ]),
  )
}
