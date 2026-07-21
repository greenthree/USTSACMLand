import { supabase } from '../../lib/supabase'
import type {
  Platform,
  TrainingGoal,
  TrainingGoalInput,
  TrainingGoalLifecycleStatus,
  TrainingGoalMetric,
} from '../../types/domain'

interface RpcResponse {
  data: unknown
  error: { message: string; code?: string } | null
}

type UntypedRpc = (functionName: string, args?: Record<string, unknown>) => PromiseLike<RpcResponse>

interface TrainingGoalRow {
  goal_id: number | string
  title: string
  metric: TrainingGoalMetric
  platform: Platform | null
  baseline_value: number | string
  target_value: number | string
  start_date: string
  end_date: string
  lifecycle_status: TrainingGoalLifecycleStatus
  data_available: boolean
  current_value: number | string | null
  progress_value: number | string | null
  progress_percent: number | string | null
  regressed: boolean
  last_success_at: string | null
  data_message: string | null
  completed_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

interface SavedGoalRow {
  goal_id: number | string
  updated_at: string
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

function trainingGoalError(prefix: string, error: { message: string; code?: string }): Error {
  if (error.code === 'PT409') return new Error('目标已在其他页面更新，请刷新后重试。')
  if (error.code === '42501') return new Error('当前账号没有训练目标权限。')
  if (error.code === 'P0002') return new Error('当前平台还没有可用的成功同步数据。')
  if (error.code === '54000') return new Error('进行中的目标已达到 20 个，请先归档旧目标。')
  return new Error(`${prefix}：${error.message}`)
}

async function callRpc<T>(
  functionName: string,
  args: Record<string, unknown> | undefined,
  errorPrefix: string,
): Promise<T[]> {
  if (!supabase) return []
  const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc
  const { data, error } = await rpc(functionName, args)
  if (error) throw trainingGoalError(errorPrefix, error)
  return rowsFromRpc<T>(data)
}

function mapTrainingGoal(row: TrainingGoalRow): TrainingGoal {
  return {
    id: numberValue(row.goal_id),
    title: row.title,
    metric: row.metric,
    platform: row.platform,
    baselineValue: numberValue(row.baseline_value),
    targetValue: numberValue(row.target_value),
    startDate: row.start_date,
    endDate: row.end_date,
    lifecycleStatus: row.lifecycle_status,
    dataAvailable: row.data_available,
    currentValue: optionalNumber(row.current_value),
    progressValue: optionalNumber(row.progress_value),
    progressPercent: optionalNumber(row.progress_percent),
    regressed: row.regressed,
    lastSuccessAt: row.last_success_at,
    dataMessage: row.data_message,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function savedGoal(
  functionName: string,
  args: Record<string, unknown>,
  errorPrefix: string,
): Promise<SavedGoalRow> {
  const rows = await callRpc<SavedGoalRow>(functionName, args, errorPrefix)
  const row = rows[0]
  if (!row) throw new Error(`${errorPrefix}：服务端未返回目标版本。`)
  return row
}

export async function fetchTrainingGoals(): Promise<TrainingGoal[]> {
  const rows = await callRpc<TrainingGoalRow>(
    'list_own_training_goals',
    undefined,
    '训练目标读取失败',
  )
  return rows.map(mapTrainingGoal)
}

export async function createTrainingGoal(input: TrainingGoalInput): Promise<SavedGoalRow> {
  return savedGoal(
    'create_own_training_goal',
    {
      requested_title: input.title,
      requested_metric: input.metric,
      requested_platform: input.platform,
      requested_target_value: input.targetAmount,
      requested_end_date: input.endDate,
    },
    '训练目标创建失败',
  )
}

export async function updateTrainingGoal(
  goal: TrainingGoal,
  input: { title: string; targetValue: number; endDate: string },
): Promise<SavedGoalRow> {
  return savedGoal(
    'update_own_training_goal',
    {
      target_goal_id: goal.id,
      requested_title: input.title,
      requested_target_value: input.targetValue,
      requested_end_date: input.endDate,
      expected_updated_at: goal.updatedAt,
    },
    '训练目标保存失败',
  )
}

export async function completeTrainingGoal(goal: TrainingGoal): Promise<SavedGoalRow> {
  return savedGoal(
    'complete_own_training_goal',
    { target_goal_id: goal.id, expected_updated_at: goal.updatedAt },
    '训练目标完成失败',
  )
}

export async function archiveTrainingGoal(goal: TrainingGoal): Promise<SavedGoalRow> {
  return savedGoal(
    'archive_own_training_goal',
    { target_goal_id: goal.id, expected_updated_at: goal.updatedAt },
    '训练目标归档失败',
  )
}
