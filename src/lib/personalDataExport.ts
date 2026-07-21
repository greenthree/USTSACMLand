import { supabase } from './supabase'
import type { Platform } from '../types/domain'
import type { Json } from '../types/database'

export interface DemoPersonalDataExportInput {
  userId: string
  email: string
  fullName: string
  qq: string
  grade: string
  major: string
  role: 'member' | 'admin'
  accounts: Record<Platform, string>
}

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function fetchOwnPersonalDataExport(): Promise<Json> {
  if (!supabase) throw new Error('个人数据导出暂不可用。')

  const rpc = supabase.rpc.bind(supabase) as unknown as (
    functionName: string,
  ) => Promise<{ data: Json | null; error: { message: string } | null }>
  const [accountExport, goalExport] = await Promise.all([
    rpc('export_own_data'),
    rpc('export_own_training_goals'),
  ])
  if (
    accountExport.error ||
    goalExport.error ||
    !isJsonObject(accountExport.data) ||
    !Array.isArray(goalExport.data)
  ) {
    throw new Error('个人数据导出失败，请稍后重试。')
  }
  return { ...accountExport.data, trainingGoals: goalExport.data }
}

export function buildDemoPersonalDataExport(
  input: DemoPersonalDataExportInput,
  exportedAt = new Date(),
): Json {
  return {
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    account: {
      id: input.userId,
      email: input.email,
      emailConfirmedAt: null,
      lastSignInAt: null,
      createdAt: null,
      updatedAt: null,
      userMetadata: {},
    },
    profile: {
      fullName: input.fullName,
      qq: input.qq,
      grade: input.grade,
      major: input.major,
      role: input.role,
      reviewStatus: 'approved',
      isPublic: true,
      reviewNote: null,
      reviewRequestedAt: null,
      approvedAt: null,
      createdAt: null,
      updatedAt: null,
    },
    platformAccounts: Object.entries(input.accounts).flatMap(([platform, externalId]) =>
      externalId
        ? [
            {
              platform,
              externalId,
              status: 'verified',
              verifiedAt: null,
              verificationErrorCode: null,
              verificationErrorMessage: null,
              createdAt: null,
              updatedAt: null,
            },
          ]
        : [],
    ),
    platformStats: [],
    statSnapshots: [],
    syncHistory: [],
    trainingGoals: [],
    dailyProblem: { completions: [], comments: [] },
    webchat: {
      access: null,
      dailyUsage: [],
      requests: [],
      conversations: [],
      retentionDays: 180,
    },
  }
}

export function personalDataExportFilename(exportedAt = new Date()): string {
  const timestamp = exportedAt.toISOString().replace(/[:.]/g, '-').replace('T', '_')
  return `usts-acm-land-personal-data_${timestamp}.json`
}

export function downloadPersonalDataExport(data: Json, exportedAt = new Date()): string {
  const filename = personalDataExportFilename(exportedAt)
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.rel = 'noopener'
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  return filename
}
