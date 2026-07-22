import { adminRpcError } from './adminRateLimit'
import { supabase } from './supabase'

export interface AdminReferralProgramConfig {
  enabled: boolean
  version: number
  updatedAt: string
  updatedByLabel: string
  reason: string | null
}

interface AdminReferralProgramConfigRow {
  enabled: unknown
  version: unknown
  updated_at: unknown
  updated_by_label: unknown
  reason: unknown
}

interface RpcResponse {
  data: unknown
  error: { message: string; details?: string; code?: string } | null
}

type UntypedRpc = (functionName: string, args?: Record<string, unknown>) => PromiseLike<RpcResponse>

const demoConfig: AdminReferralProgramConfig = {
  enabled: true,
  version: 1,
  updatedAt: '2026-07-22T08:00:00+08:00',
  updatedByLabel: '演示管理员',
  reason: '演示环境默认开启',
}

function integer(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export function mapAdminReferralProgramConfig(value: unknown): AdminReferralProgramConfig {
  const row = (Array.isArray(value) ? value[0] : value) as
    AdminReferralProgramConfigRow | null | undefined
  const version = integer(row?.version)

  if (
    !row ||
    typeof row !== 'object' ||
    typeof row.enabled !== 'boolean' ||
    version === null ||
    typeof row.updated_at !== 'string' ||
    !Number.isFinite(Date.parse(row.updated_at)) ||
    (row.updated_by_label !== null && typeof row.updated_by_label !== 'string') ||
    (row.reason !== null && typeof row.reason !== 'string')
  ) {
    throw new Error('推荐计划配置服务返回了无效数据。')
  }

  return {
    enabled: row.enabled,
    version,
    updatedAt: row.updated_at,
    updatedByLabel:
      typeof row.updated_by_label === 'string' && row.updated_by_label.trim()
        ? row.updated_by_label.trim()
        : '系统',
    reason: typeof row.reason === 'string' && row.reason.trim() ? row.reason.trim() : null,
  }
}

export async function fetchAdminReferralProgramConfig(): Promise<AdminReferralProgramConfig> {
  if (!supabase) return { ...demoConfig }

  const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc
  const { data, error } = await rpc('admin_read_referral_program_config')
  if (error) throw adminRpcError('推荐计划配置读取失败', error)
  return mapAdminReferralProgramConfig(data)
}

export async function updateAdminReferralProgramConfig(
  requestedEnabled: boolean,
  expectedVersion: number,
  reason: string,
): Promise<AdminReferralProgramConfig> {
  const normalizedReason = reason.trim()
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new Error('推荐计划配置版本无效，请刷新后重试。')
  }
  if (normalizedReason.length < 3 || normalizedReason.length > 500) {
    throw new Error('变更原因需填写 3 至 500 个字符。')
  }

  if (!supabase) {
    return {
      ...demoConfig,
      enabled: requestedEnabled,
      version: expectedVersion + 1,
      updatedAt: new Date().toISOString(),
      reason: normalizedReason,
    }
  }

  const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc
  const { data, error } = await rpc('admin_update_referral_program_config', {
    requested_enabled: requestedEnabled,
    expected_version: expectedVersion,
    requested_reason: normalizedReason,
  })
  if (error) throw adminRpcError('推荐计划配置更新失败', error)
  return mapAdminReferralProgramConfig(data)
}
