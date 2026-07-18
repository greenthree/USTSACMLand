import type { SupabaseClient } from '@supabase/supabase-js'
import { solvedPlatforms } from '../lib/platforms'
import {
  isPracticeIncrementCoverageStatus,
  type PracticeDateRange,
  type PracticeIncrementRecord,
} from '../lib/practiceIncrements'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import type { SolvedPlatform } from '../types/domain'

interface PublicPracticeIncrementRow {
  profile_id: string | null
  platform: Database['public']['Enums']['platform_name'] | null
  solved_delta: number | null
  baseline_solved_count: number | null
  end_solved_count: number | null
  baseline_recorded_at: string | null
  end_recorded_at: string | null
  coverage_status: string | null
}

const solvedPlatformSet = new Set<string>(solvedPlatforms)

function requireIntegerOrNull(value: number | null, field: string): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`公开刷题增量返回了无效的${field}`)
  }
  return value
}

export function requirePublicPracticeIncrementRows(
  rows: PublicPracticeIncrementRow[],
): PracticeIncrementRecord[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    if (!row.profile_id || !row.platform || !solvedPlatformSet.has(row.platform)) {
      throw new Error('公开刷题增量返回了无效的成员或平台')
    }
    if (!row.coverage_status || !isPracticeIncrementCoverageStatus(row.coverage_status)) {
      throw new Error('公开刷题增量返回了未知的数据覆盖状态')
    }
    const key = `${row.profile_id}:${row.platform}`
    if (seen.has(key)) throw new Error('公开刷题增量返回了重复记录')
    seen.add(key)

    const delta = requireIntegerOrNull(row.solved_delta, '新增题数')
    const baselineCount = requireIntegerOrNull(row.baseline_solved_count, '基线题数')
    const endCount = requireIntegerOrNull(row.end_solved_count, '区间末题数')
    const complete = row.coverage_status === 'complete' || row.coverage_status === 'count_decreased'
    if (complete && (delta === null || baselineCount === null || endCount === null)) {
      throw new Error('公开刷题增量返回了不完整的已统计记录')
    }
    if (!complete && delta !== null) {
      throw new Error('公开刷题增量为未覆盖记录返回了新增题数')
    }
    if (row.coverage_status === 'count_decreased' && delta !== 0) {
      throw new Error('公开刷题增量的题数回退记录必须按 0 计')
    }

    return {
      memberId: row.profile_id,
      platform: row.platform as SolvedPlatform,
      delta,
      baselineCount,
      endCount,
      baselineAt: row.baseline_recorded_at,
      endAt: row.end_recorded_at,
      coverageStatus: row.coverage_status,
    }
  })
}

export async function loadPublicPracticeIncrementsFromClient(
  client: SupabaseClient<Database>,
  range: PracticeDateRange,
  signal?: AbortSignal,
): Promise<PracticeIncrementRecord[]> {
  let query = client.rpc('get_public_practice_increments', {
    range_start_date: range.startDate,
    range_end_date: range.endDate,
  })
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(`刷题增量读取失败：${error.message}`)
  return requirePublicPracticeIncrementRows((data ?? []) as PublicPracticeIncrementRow[])
}

export async function loadPublicPracticeIncrements(
  range: PracticeDateRange,
  signal?: AbortSignal,
): Promise<PracticeIncrementRecord[]> {
  if (!supabase) throw new Error('刷题增量服务尚未配置')
  return loadPublicPracticeIncrementsFromClient(supabase, range, signal)
}
