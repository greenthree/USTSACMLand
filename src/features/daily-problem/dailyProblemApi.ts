import type {
  AdminDailyProblem,
  AdminDailyProblemInput,
  DailyProblem,
  DailyProblemComment,
  DailyProblemStatus,
} from '../../types/domain'
import { adminRpcError } from '../../lib/adminRateLimit'
import { supabase } from '../../lib/supabase'

interface RpcResponse {
  data: unknown
  error: { message: string; code?: string } | null
}

type UntypedRpc = (functionName: string, args?: Record<string, unknown>) => PromiseLike<RpcResponse>

interface DailyProblemRow {
  problem_id: number | string
  problem_date: string
  title: string
  source_platform?: string | null
  platform?: string | null
  external_problem_id?: string | null
  source_url: string
  difficulty: string | null
  tags: unknown
  training_note: string | null
  estimated_minutes: number | string | null
  completion_count: number | string | null
  comment_count: number | string | null
  my_completed_at?: string | null
}

interface DailyProblemCommentRow {
  comment_id: number | string
  problem_id?: number | string
  author_id?: string | null
  author_label?: string | null
  author_name?: string | null
  body: string
  visibility?: 'visible' | 'hidden' | null
  created_at: string
  updated_at?: string | null
  can_delete?: boolean | null
}

interface AdminDailyProblemRow extends DailyProblemRow {
  status: DailyProblemStatus
  created_at: string
  updated_at: string
}

interface CompletionRow {
  completed_at: string | null
}

interface SavedProblemRow {
  problem_id: number | string
  problem_updated_at?: string
  updated_at?: string
}

function rowsFromRpc<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  return data === null || data === undefined ? [] : [data as T]
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function mapProblem(row: DailyProblemRow): DailyProblem {
  return {
    id: numberValue(row.problem_id),
    date: row.problem_date,
    title: row.title,
    sourcePlatform: row.source_platform?.trim() || row.platform?.trim() || '题目平台',
    externalProblemId: row.external_problem_id?.trim() || '',
    sourceUrl: row.source_url,
    difficulty: row.difficulty?.trim() || '难度待定',
    tags: stringArray(row.tags),
    trainingNote: row.training_note?.trim() || '',
    estimatedMinutes: optionalNumber(row.estimated_minutes),
    completionCount: numberValue(row.completion_count),
    commentCount: numberValue(row.comment_count),
    completedAt: row.my_completed_at ?? null,
  }
}

function mapAdminProblem(row: AdminDailyProblemRow): AdminDailyProblem {
  return {
    ...mapProblem(row),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function callRpc<T>(
  functionName: string,
  args: Record<string, unknown> | undefined,
  errorPrefix: string,
): Promise<T[]> {
  if (!supabase) return []
  const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc
  const { data, error } = await rpc(functionName, args)
  if (error) throw new Error(`${errorPrefix}：${error.message}`)
  return rowsFromRpc<T>(data)
}

async function callAdminRpc<T>(
  functionName: string,
  args: Record<string, unknown> | undefined,
  errorPrefix: string,
): Promise<T[]> {
  if (!supabase) return []
  const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc
  const { data, error } = await rpc(functionName, args)
  if (error) throw adminRpcError(errorPrefix, error)
  return rowsFromRpc<T>(data)
}

export async function fetchDailyProblemFeed(
  rowLimit = 8,
  beforeProblemDate: string | null = null,
): Promise<DailyProblem[]> {
  const rows = await callRpc<DailyProblemRow>(
    'read_daily_problem_feed',
    {
      row_limit: rowLimit,
      before_problem_date: beforeProblemDate,
    },
    '每日一题读取失败',
  )
  return rows.map(mapProblem)
}

export async function fetchDailyProblemByDate(date: string): Promise<DailyProblem | null> {
  const nextDate = new Date(`${date}T00:00:00Z`)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)
  const [problem] = await fetchDailyProblemFeed(1, nextDate.toISOString().slice(0, 10))
  return problem?.date === date ? problem : null
}

export async function setDailyProblemCompletion(
  problemId: number,
  completed: boolean,
): Promise<string | null> {
  if (!supabase) return completed ? new Date().toISOString() : null
  const rows = await callRpc<CompletionRow>(
    'set_own_daily_problem_completion',
    {
      target_problem_id: problemId,
      requested_completed: completed,
    },
    '完成记录保存失败',
  )
  return rows[0]?.completed_at ?? null
}

export async function fetchDailyProblemComments(
  problemId: number,
  rowLimit = 50,
  beforeCommentId: number | null = null,
): Promise<DailyProblemComment[]> {
  if (!supabase) return []
  const [rows, sessionResult] = await Promise.all([
    callRpc<DailyProblemCommentRow>(
      'list_daily_problem_comments',
      {
        target_problem_id: problemId,
        row_limit: rowLimit,
        before_comment_id: beforeCommentId,
      },
      '题目讨论读取失败',
    ),
    supabase.auth.getSession(),
  ])
  const userId = sessionResult.data.session?.user.id ?? null
  return rows.map((row) => ({
    id: numberValue(row.comment_id),
    problemId: numberValue(row.problem_id, problemId),
    authorId: row.author_id ?? null,
    authorLabel: row.author_label?.trim() || row.author_name?.trim() || '集训队成员',
    body: row.body,
    visibility: row.visibility === 'hidden' ? 'hidden' : 'visible',
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    canDelete: row.can_delete === true || Boolean(userId && row.author_id === userId),
  }))
}

export async function createDailyProblemComment(
  problemId: number,
  body: string,
): Promise<{ id: number; createdAt: string }> {
  if (!supabase) return { id: Date.now(), createdAt: new Date().toISOString() }
  const rows = await callRpc<{ comment_id: number | string; created_at: string }>(
    'create_daily_problem_comment',
    { target_problem_id: problemId, comment_body: body },
    '讨论发布失败',
  )
  const row = rows[0]
  if (!row) throw new Error('讨论发布失败：服务端未返回讨论记录。')
  return { id: numberValue(row.comment_id), createdAt: row.created_at }
}

export async function deleteDailyProblemComment(
  commentId: number,
  expectedUpdatedAt: string,
): Promise<void> {
  if (!supabase) return
  const rows = await callRpc<boolean>(
    'delete_own_daily_problem_comment',
    { target_comment_id: commentId, expected_updated_at: expectedUpdatedAt },
    '讨论删除失败',
  )
  if (rows[0] !== true) throw new Error('讨论删除失败：服务端未确认删除。')
}

export async function setAdminDailyProblemCommentVisibility(
  commentId: number,
  visible: boolean,
  reason: string,
  expectedUpdatedAt: string,
): Promise<string> {
  if (!supabase) return new Date().toISOString()
  const rows = await callAdminRpc<{
    comment_id: number | string
    comment_updated_at?: string
    updated_at?: string
  }>(
    'admin_set_daily_problem_comment_visibility',
    {
      target_comment_id: commentId,
      requested_visible: visible,
      moderation_reason: reason,
      expected_updated_at: expectedUpdatedAt,
    },
    visible ? '讨论恢复失败' : '讨论隐藏失败',
  )
  const updatedAt = rows[0]?.comment_updated_at ?? rows[0]?.updated_at
  if (!updatedAt)
    throw new Error(`${visible ? '讨论恢复' : '讨论隐藏'}失败：服务端未返回更新时间。`)
  return updatedAt
}

export async function fetchAdminDailyProblems(
  rowLimit = 100,
  beforeProblemId: number | null = null,
): Promise<AdminDailyProblem[]> {
  const rows = await callAdminRpc<AdminDailyProblemRow>(
    'admin_list_daily_problems',
    { row_limit: rowLimit, before_problem_id: beforeProblemId },
    '每日一题列表读取失败',
  )
  return rows.map(mapAdminProblem)
}

export async function saveAdminDailyProblem(
  input: AdminDailyProblemInput,
): Promise<{ id: number; updatedAt: string }> {
  if (!supabase) {
    return { id: input.id ?? Date.now(), updatedAt: new Date().toISOString() }
  }
  const rows = await callAdminRpc<SavedProblemRow>(
    'admin_upsert_daily_problem',
    {
      target_problem_id: input.id,
      problem_date: input.date,
      problem_title: input.title,
      problem_source_platform: input.sourcePlatform,
      problem_external_problem_id: input.externalProblemId,
      problem_source_url: input.sourceUrl,
      problem_difficulty: input.difficulty,
      problem_tags: input.tags,
      problem_training_note: input.trainingNote,
      problem_estimated_minutes: input.estimatedMinutes,
      requested_status: input.status,
      expected_updated_at: input.expectedUpdatedAt,
    },
    '每日一题保存失败',
  )
  const row = rows[0]
  if (!row) throw new Error('每日一题保存失败：服务端未返回题目版本。')
  const updatedAt = row.problem_updated_at ?? row.updated_at
  if (!updatedAt) throw new Error('每日一题保存失败：服务端未返回更新时间。')
  return { id: numberValue(row.problem_id), updatedAt }
}

export async function deleteAdminDailyProblem(
  id: number,
  expectedUpdatedAt: string,
): Promise<void> {
  if (!supabase) return
  const rows = await callAdminRpc<boolean>(
    'admin_delete_daily_problem',
    { target_problem_id: id, expected_updated_at: expectedUpdatedAt },
    '每日一题删除失败',
  )
  if (rows[0] !== true) throw new Error('每日一题删除失败：服务端未确认删除。')
}
