import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext, type AuthContextValue } from '../auth/authContextValue'
import type { TrainingGoal } from '../types/domain'

const goalMocks = vi.hoisted(() => ({
  archive: vi.fn(),
  complete: vi.fn(),
  create: vi.fn(),
  fetch: vi.fn(),
  update: vi.fn(),
}))

vi.mock('../features/training-goals/trainingGoalsApi', () => ({
  archiveTrainingGoal: goalMocks.archive,
  completeTrainingGoal: goalMocks.complete,
  createTrainingGoal: goalMocks.create,
  fetchTrainingGoals: goalMocks.fetch,
  updateTrainingGoal: goalMocks.update,
}))

import { TrainingGoalsPage } from './TrainingGoalsPage'

const authValue: AuthContextValue = {
  status: 'authenticated',
  user: {
    id: 'member-1',
    email: 'member@example.test',
    role: 'member',
    reviewStatus: 'approved',
  },
  isDemo: false,
  isPasswordRecovery: false,
  signUp: vi.fn(),
  signIn: vi.fn(),
  changePassword: vi.fn(),
  completePasswordRecovery: vi.fn(),
  deleteAccount: vi.fn(),
  signOut: vi.fn(),
}

const activeGoal: TrainingGoal = {
  id: 71,
  title: '暑假累计完成 50 题',
  metric: 'total_solved',
  platform: null,
  baselineValue: 120,
  targetValue: 170,
  startDate: '2026-07-21',
  endDate: '2026-08-20',
  lifecycleStatus: 'active',
  dataAvailable: true,
  currentValue: 145,
  progressValue: 25,
  progressPercent: 50,
  regressed: false,
  lastSuccessAt: '2026-07-21T11:00:00Z',
  dataMessage: null,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-07-21T01:00:00Z',
  updatedAt: '2026-07-21T01:00:00Z',
}

function renderPage() {
  return render(
    <AuthContext.Provider value={authValue}>
      <TrainingGoalsPage />
    </AuthContext.Provider>,
  )
}

describe('TrainingGoalsPage', () => {
  beforeEach(() => {
    goalMocks.archive.mockReset()
    goalMocks.complete.mockReset()
    goalMocks.create.mockReset()
    goalMocks.fetch.mockReset()
    goalMocks.update.mockReset()
    goalMocks.fetch.mockResolvedValue([activeGoal])
    goalMocks.create.mockResolvedValue({ goal_id: 72, updated_at: '2026-07-21T02:00:00Z' })
    goalMocks.update.mockResolvedValue({ goal_id: 71, updated_at: '2026-07-21T02:00:00Z' })
    goalMocks.complete.mockResolvedValue({ goal_id: 71, updated_at: '2026-07-21T02:00:00Z' })
    goalMocks.archive.mockResolvedValue({ goal_id: 71, updated_at: '2026-07-21T02:00:00Z' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows successful-sync progress and creates a platform Rating goal', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('heading', { name: '训练目标', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('暑假累计完成 50 题')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '暑假累计完成 50 题进度' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
    expect(screen.getByText('已增加 25 / 50 题')).toBeInTheDocument()
    expect(screen.getByText('目标与进度仅自己可见')).toBeInTheDocument()

    await user.type(screen.getByLabelText('目标名称'), 'AtCoder 冲到 1200')
    await user.click(screen.getByRole('button', { name: 'Rating' }))
    await user.selectOptions(screen.getByLabelText('平台'), 'atcoder')
    await user.clear(screen.getByLabelText('目标 Rating'))
    await user.type(screen.getByLabelText('目标 Rating'), '1200')
    await user.click(screen.getByRole('button', { name: '创建目标' }))

    await waitFor(() => {
      expect(goalMocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'AtCoder 冲到 1200',
          metric: 'platform_rating',
          platform: 'atcoder',
          targetAmount: 1200,
        }),
      )
    })
    expect(await screen.findByRole('status')).toHaveTextContent('基线已按最新成功同步数据冻结')
  })

  it('edits without changing the baseline, completes reached goals, and archives history', async () => {
    const user = userEvent.setup()
    const reachedGoal: TrainingGoal = {
      ...activeGoal,
      currentValue: 180,
      progressValue: 60,
      progressPercent: 100,
    }
    goalMocks.fetch.mockResolvedValue([reachedGoal])
    renderPage()

    await screen.findByText(reachedGoal.title)
    await user.click(screen.getByRole('button', { name: '编辑' }))
    const editTitle = screen.getAllByLabelText('目标名称')[1]
    await user.clear(editTitle)
    await user.type(editTitle, '暑假累计完成 60 题')
    const editAmount = screen.getByLabelText('计划增加题数', {
      selector: '.training-goal-edit input',
    })
    await user.clear(editAmount)
    await user.type(editAmount, '60')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(goalMocks.update).toHaveBeenCalledWith(reachedGoal, {
        title: '暑假累计完成 60 题',
        targetValue: 180,
        endDate: reachedGoal.endDate,
      })
    })

    await user.click(screen.getByRole('button', { name: '确认完成' }))
    await waitFor(() => expect(goalMocks.complete).toHaveBeenCalledWith(reachedGoal))

    await user.click(screen.getByRole('button', { name: '归档' }))
    await waitFor(() => expect(goalMocks.archive).toHaveBeenCalledWith(reachedGoal))
  })

  it('keeps missing successful-sync data explicit instead of treating it as zero', async () => {
    goalMocks.fetch.mockResolvedValue([
      {
        ...activeGoal,
        dataAvailable: false,
        currentValue: null,
        progressValue: null,
        progressPercent: null,
        dataMessage: '已跟踪平台缺少可用的成功同步数据。',
      },
    ])
    renderPage()

    expect(await screen.findByText('暂不可计算')).toBeInTheDocument()
    expect(screen.getByText('已跟踪平台缺少可用的成功同步数据。')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '暂不可计算')
  })

  it('shows explicit empty states for current and historical goals', async () => {
    const user = userEvent.setup()
    goalMocks.fetch.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText('还没有进行中的目标')).toBeInTheDocument()
    expect(screen.getByText('从左侧创建一个可以持续核对的训练目标。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '历史 0' }))
    expect(screen.getByText('还没有历史目标')).toBeInTheDocument()
    expect(screen.getByText('完成或归档的目标会保留在这里。')).toBeInTheDocument()
  })

  it('keeps expired goals visible for archiving without offering active-only actions', async () => {
    goalMocks.fetch.mockResolvedValue([
      {
        ...activeGoal,
        lifecycleStatus: 'expired',
        endDate: '2026-07-20',
      },
    ])
    renderPage()

    expect(await screen.findByText('已过期')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认完成' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '归档' })).toBeInTheDocument()
  })

  it('surfaces missing successful-sync data when goal creation cannot freeze a baseline', async () => {
    const user = userEvent.setup()
    goalMocks.create.mockRejectedValue(new Error('当前平台还没有可用的成功同步数据。'))
    renderPage()

    await screen.findByText(activeGoal.title)
    await user.type(screen.getByLabelText('目标名称'), 'AtCoder 达到 1200')
    await user.click(screen.getByRole('button', { name: 'Rating' }))
    await user.selectOptions(screen.getByLabelText('平台'), 'atcoder')
    await user.clear(screen.getByLabelText('目标 Rating'))
    await user.type(screen.getByLabelText('目标 Rating'), '1200')
    await user.click(screen.getByRole('button', { name: '创建目标' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('当前平台还没有可用的成功同步数据。')
  })
})
