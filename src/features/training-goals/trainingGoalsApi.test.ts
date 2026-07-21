const trainingGoalMocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: trainingGoalMocks.rpc },
}))

import {
  archiveTrainingGoal,
  completeTrainingGoal,
  createTrainingGoal,
  fetchTrainingGoals,
  updateTrainingGoal,
} from './trainingGoalsApi'
import type { TrainingGoal } from '../../types/domain'

const goal: TrainingGoal = {
  id: 41,
  title: '本月多做 30 题',
  metric: 'total_solved',
  platform: null,
  baselineValue: 100,
  targetValue: 130,
  startDate: '2026-07-21',
  endDate: '2026-08-20',
  lifecycleStatus: 'active',
  dataAvailable: true,
  currentValue: 112,
  progressValue: 12,
  progressPercent: 40,
  regressed: false,
  lastSuccessAt: '2026-07-21T11:00:00Z',
  dataMessage: null,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-07-21T01:00:00Z',
  updatedAt: '2026-07-21T01:00:00Z',
}

describe('training goals API', () => {
  beforeEach(() => {
    trainingGoalMocks.rpc.mockReset()
  })

  it('maps private goal progress returned by the own-goals RPC', async () => {
    trainingGoalMocks.rpc.mockResolvedValue({
      data: [
        {
          goal_id: '41',
          title: '本月多做 30 题',
          metric: 'total_solved',
          platform: null,
          baseline_value: '100',
          target_value: 130,
          start_date: '2026-07-21',
          end_date: '2026-08-20',
          lifecycle_status: 'active',
          data_available: true,
          current_value: '112',
          progress_value: '12',
          progress_percent: '40.00',
          regressed: false,
          last_success_at: '2026-07-21T11:00:00Z',
          data_message: null,
          completed_at: null,
          archived_at: null,
          created_at: '2026-07-21T01:00:00Z',
          updated_at: '2026-07-21T01:00:00Z',
        },
      ],
      error: null,
    })

    await expect(fetchTrainingGoals()).resolves.toEqual([goal])
    expect(trainingGoalMocks.rpc).toHaveBeenCalledWith('list_own_training_goals', undefined)
  })

  it('creates a goal without accepting a caller-selected baseline', async () => {
    trainingGoalMocks.rpc.mockResolvedValue({
      data: [{ goal_id: 42, updated_at: '2026-07-21T02:00:00Z' }],
      error: null,
    })

    await createTrainingGoal({
      title: 'Codeforces 达到 1500',
      metric: 'platform_rating',
      platform: 'codeforces',
      targetAmount: 1500,
      endDate: '2026-09-01',
    })

    expect(trainingGoalMocks.rpc).toHaveBeenCalledWith('create_own_training_goal', {
      requested_title: 'Codeforces 达到 1500',
      requested_metric: 'platform_rating',
      requested_platform: 'codeforces',
      requested_target_value: 1500,
      requested_end_date: '2026-09-01',
    })
  })

  it('uses optimistic versions for edit, completion, and archive actions', async () => {
    trainingGoalMocks.rpc.mockResolvedValue({
      data: [{ goal_id: 41, updated_at: '2026-07-21T03:00:00Z' }],
      error: null,
    })

    await updateTrainingGoal(goal, {
      title: '本月多做 40 题',
      targetValue: 140,
      endDate: '2026-08-25',
    })
    await completeTrainingGoal(goal)
    await archiveTrainingGoal(goal)

    expect(trainingGoalMocks.rpc).toHaveBeenNthCalledWith(1, 'update_own_training_goal', {
      target_goal_id: 41,
      requested_title: '本月多做 40 题',
      requested_target_value: 140,
      requested_end_date: '2026-08-25',
      expected_updated_at: goal.updatedAt,
    })
    expect(trainingGoalMocks.rpc).toHaveBeenNthCalledWith(2, 'complete_own_training_goal', {
      target_goal_id: 41,
      expected_updated_at: goal.updatedAt,
    })
    expect(trainingGoalMocks.rpc).toHaveBeenNthCalledWith(3, 'archive_own_training_goal', {
      target_goal_id: 41,
      expected_updated_at: goal.updatedAt,
    })
  })

  it('turns optimistic conflicts and missing sync data into actionable messages', async () => {
    trainingGoalMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PT409', message: 'database detail' },
    })
    await expect(archiveTrainingGoal(goal)).rejects.toThrow('目标已在其他页面更新，请刷新后重试。')

    trainingGoalMocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0002', message: 'database detail' },
    })
    await expect(
      createTrainingGoal({
        title: 'AtCoder Rating',
        metric: 'platform_rating',
        platform: 'atcoder',
        targetAmount: 1000,
        endDate: '2026-09-01',
      }),
    ).rejects.toThrow('当前平台还没有可用的成功同步数据。')
  })
})
