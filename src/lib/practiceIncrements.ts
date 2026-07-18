import { solvedPlatforms } from './platforms'
import type { Member, SolvedPlatform } from '../types/domain'

export const practiceRangeModes = ['lifetime', 'week', 'month', 'custom'] as const

export type PracticeRangeMode = (typeof practiceRangeModes)[number]
export type PracticeIncrementCoverageStatus =
  'complete' | 'unbound' | 'missing_baseline' | 'missing_end' | 'count_decreased' | 'unavailable'

export interface PracticeDateRange {
  startDate: string
  endDate: string
}

export interface PracticeIncrementRecord {
  memberId: string
  platform: SolvedPlatform
  delta: number | null
  baselineCount: number | null
  endCount: number | null
  baselineAt: string | null
  endAt: string | null
  coverageStatus: PracticeIncrementCoverageStatus
}

export interface PracticeIncrementPlatformStat {
  delta: number | null
  baselineCount: number | null
  endCount: number | null
  baselineAt: string | null
  endAt: string | null
  coverageStatus: PracticeIncrementCoverageStatus
}

export interface PracticeIncrementMember {
  member: Member
  stats: Record<SolvedPlatform, PracticeIncrementPlatformStat>
  totalDelta: number | null
  boundPlatformCount: number
  measuredPlatformCount: number
  adjustedPlatformCount: number
}

const dayMs = 24 * 60 * 60 * 1_000
const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/
const coverageStatuses = new Set<PracticeIncrementCoverageStatus>([
  'complete',
  'unbound',
  'missing_baseline',
  'missing_end',
  'count_decreased',
])

function parseIsoDate(value: string): Date | null {
  const match = isoDatePattern.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftIsoDate(value: string, days: number): string {
  const date = parseIsoDate(value)
  if (!date) throw new Error('Invalid ISO calendar date')
  date.setUTCDate(date.getUTCDate() + days)
  return formatIsoDate(date)
}

export function currentBeijingDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function practicePresetRange(
  mode: Extract<PracticeRangeMode, 'week' | 'month'>,
  today = currentBeijingDate(),
): PracticeDateRange {
  const date = parseIsoDate(today)
  if (!date) throw new Error('Invalid Beijing calendar date')

  if (mode === 'month') {
    return { startDate: `${today.slice(0, 7)}-01`, endDate: today }
  }

  const mondayOffset = (date.getUTCDay() + 6) % 7
  return { startDate: shiftIsoDate(today, -mondayOffset), endDate: today }
}

export function validatePracticeDateRange(
  range: PracticeDateRange,
  today = currentBeijingDate(),
): string | null {
  const start = parseIsoDate(range.startDate)
  const end = parseIsoDate(range.endDate)
  const todayDate = parseIsoDate(today)
  if (!start || !end || !todayDate) return '请选择有效的开始和结束日期。'
  if (start.getTime() > end.getTime()) return '开始日期不能晚于结束日期。'
  if (end.getTime() > todayDate.getTime()) return '结束日期不能晚于北京时间今天。'
  if ((end.getTime() - start.getTime()) / dayMs > 365) return '单次最多统计 366 天。'
  return null
}

export function formatPracticeDateRange(range: PracticeDateRange): string {
  const start = parseIsoDate(range.startDate)
  const end = parseIsoDate(range.endDate)
  if (!start || !end) return ''
  const formatPart = (date: Date) => `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
  return start.getUTCFullYear() === end.getUTCFullYear()
    ? `${start.getUTCFullYear()}年${formatPart(start)}—${formatPart(end)}`
    : `${start.getUTCFullYear()}年${formatPart(start)}—${end.getUTCFullYear()}年${formatPart(end)}`
}

export function isPracticeIncrementCoverageStatus(
  value: string,
): value is Exclude<PracticeIncrementCoverageStatus, 'unavailable'> {
  return coverageStatuses.has(value as PracticeIncrementCoverageStatus)
}

function unavailableStat(): PracticeIncrementPlatformStat {
  return {
    delta: null,
    baselineCount: null,
    endCount: null,
    baselineAt: null,
    endAt: null,
    coverageStatus: 'unavailable',
  }
}

export function buildPracticeIncrementMembers(
  members: Member[],
  records: PracticeIncrementRecord[],
): PracticeIncrementMember[] {
  const recordsByMember = new Map<string, Map<SolvedPlatform, PracticeIncrementRecord>>()
  for (const record of records) {
    const memberRecords = recordsByMember.get(record.memberId) ?? new Map()
    memberRecords.set(record.platform, record)
    recordsByMember.set(record.memberId, memberRecords)
  }

  return members.map((member) => {
    const memberRecords = recordsByMember.get(member.id)
    const stats = Object.fromEntries(
      solvedPlatforms.map((platform) => {
        const record = memberRecords?.get(platform)
        return [
          platform,
          record
            ? {
                delta: record.delta,
                baselineCount: record.baselineCount,
                endCount: record.endCount,
                baselineAt: record.baselineAt,
                endAt: record.endAt,
                coverageStatus: record.coverageStatus,
              }
            : unavailableStat(),
        ]
      }),
    ) as Record<SolvedPlatform, PracticeIncrementPlatformStat>

    let totalDelta = 0
    let measuredPlatformCount = 0
    let boundPlatformCount = 0
    let adjustedPlatformCount = 0
    for (const platform of solvedPlatforms) {
      const stat = stats[platform]
      if (stat.coverageStatus !== 'unbound') boundPlatformCount += 1
      if (stat.delta !== null) {
        totalDelta += stat.delta
        measuredPlatformCount += 1
      }
      if (stat.coverageStatus === 'count_decreased') adjustedPlatformCount += 1
    }

    return {
      member,
      stats,
      totalDelta: measuredPlatformCount > 0 ? totalDelta : null,
      boundPlatformCount,
      measuredPlatformCount,
      adjustedPlatformCount,
    }
  })
}

export function createDemoPracticeIncrementRecords(members: Member[]): PracticeIncrementRecord[] {
  return members.flatMap((member, memberIndex) =>
    solvedPlatforms.map((platform, platformIndex) => {
      const current = member.stats[platform]
      if (!current.externalId) {
        return {
          memberId: member.id,
          platform,
          delta: null,
          baselineCount: null,
          endCount: null,
          baselineAt: null,
          endAt: null,
          coverageStatus: 'unbound' as const,
        }
      }
      if (current.solved === null) {
        return {
          memberId: member.id,
          platform,
          delta: null,
          baselineCount: null,
          endCount: null,
          baselineAt: null,
          endAt: null,
          coverageStatus: 'missing_baseline' as const,
        }
      }
      const delta = Math.min(current.solved, (memberIndex + 1) * (platformIndex + 2))
      return {
        memberId: member.id,
        platform,
        delta,
        baselineCount: current.solved - delta,
        endCount: current.solved,
        baselineAt: null,
        endAt: current.updatedAt,
        coverageStatus: 'complete' as const,
      }
    }),
  )
}

export const practiceCoverageLabels: Record<PracticeIncrementCoverageStatus, string> = {
  complete: '统计完整',
  unbound: '未绑定',
  missing_baseline: '缺少区间前基线',
  missing_end: '区间内无成功同步',
  count_decreased: '累计题数发生回退，按 0 计',
  unavailable: '增量数据缺失',
}
