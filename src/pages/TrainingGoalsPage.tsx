import Archive from 'lucide-react/dist/esm/icons/archive'
import CalendarRange from 'lucide-react/dist/esm/icons/calendar-range'
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2'
import CircleAlert from 'lucide-react/dist/esm/icons/circle-alert'
import Pencil from 'lucide-react/dist/esm/icons/pencil'
import Plus from 'lucide-react/dist/esm/icons/plus'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Target from 'lucide-react/dist/esm/icons/target'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { LoadingState } from '../components/LoadingState'
import {
  archiveTrainingGoal,
  completeTrainingGoal,
  createTrainingGoal,
  fetchTrainingGoals,
  updateTrainingGoal,
} from '../features/training-goals/trainingGoalsApi'
import { platformLabels, ratingPlatforms, solvedPlatforms } from '../lib/platforms'
import type {
  Platform,
  TrainingGoal,
  TrainingGoalLifecycleStatus,
  TrainingGoalMetric,
} from '../types/domain'
import '../features/training-goals/training-goals.css'

type GoalView = 'current' | 'history'

interface GoalDraft {
  title: string
  metric: TrainingGoalMetric
  platform: Platform | null
  targetAmount: string
  endDate: string
}

interface EditDraft {
  title: string
  targetAmount: string
  endDate: string
}

const statusLabels: Record<TrainingGoalLifecycleStatus, string> = {
  active: '进行中',
  completed: '已完成',
  archived: '已归档',
  expired: '已过期',
}

const shortDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Shanghai',
})

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
})

function beijingDate(offsetDays = 0): string {
  const source = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(source)
}

function initialDraft(): GoalDraft {
  return {
    title: '',
    metric: 'total_solved',
    platform: null,
    targetAmount: '30',
    endDate: beijingDate(30),
  }
}

function metricLabel(goal: Pick<TrainingGoal, 'metric' | 'platform'>): string {
  if (goal.metric === 'total_solved') return '总通过题数'
  const platform = goal.platform ? platformLabels[goal.platform] : '平台'
  return goal.metric === 'platform_rating' ? `${platform} Rating` : `${platform} 通过题数`
}

function formatDate(value: string): string {
  return shortDateFormatter.format(new Date(`${value}T00:00:00+08:00`))
}

function formatSyncTime(value: string | null): string {
  return value ? dateTimeFormatter.format(new Date(value)) : '暂无成功同步'
}

function targetUnit(metric: TrainingGoalMetric): string {
  return metric === 'platform_rating' ? '分' : '题'
}

function progressCopy(goal: TrainingGoal): string {
  if (!goal.dataAvailable || goal.currentValue === null) return '暂不可计算'
  if (goal.metric === 'platform_rating') {
    return `${goal.currentValue} / ${goal.targetValue} 分`
  }
  return `已增加 ${goal.progressValue ?? 0} / ${goal.targetValue - goal.baselineValue} 题`
}

function GoalProgress({ goal }: { goal: TrainingGoal }) {
  const progress = Math.max(0, Math.min(100, goal.progressPercent ?? 0))

  return (
    <div className="training-goal-progress">
      <div className="training-goal-progress-copy">
        <strong>{progressCopy(goal)}</strong>
        <span>{goal.dataAvailable ? `${progress.toFixed(2)}%` : '等待同步'}</span>
      </div>
      <div
        className="training-goal-progress-track"
        role="progressbar"
        aria-label={`${goal.title}进度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-valuetext={goal.dataAvailable ? `${progress.toFixed(2)}%` : '暂不可计算'}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

export function TrainingGoalsPage() {
  const [goals, setGoals] = useState<TrainingGoal[]>([])
  const [view, setView] = useState<GoalView>('current')
  const [draft, setDraft] = useState<GoalDraft>(() => initialDraft())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [busyGoalId, setBusyGoalId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')

  const loadGoals = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      setGoals(await fetchTrainingGoals())
    } catch (reason) {
      setNoticeKind('error')
      setNotice(reason instanceof Error ? reason.message : '训练目标读取失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadGoals()
  }, [loadGoals])

  const currentGoals = useMemo(
    () =>
      goals.filter(
        (goal) => goal.lifecycleStatus === 'active' || goal.lifecycleStatus === 'expired',
      ),
    [goals],
  )
  const historyGoals = useMemo(
    () =>
      goals.filter(
        (goal) => goal.lifecycleStatus === 'completed' || goal.lifecycleStatus === 'archived',
      ),
    [goals],
  )
  const visibleGoals = view === 'current' ? currentGoals : historyGoals
  const reachedCount = currentGoals.filter(
    (goal) => goal.dataAvailable && (goal.progressPercent ?? 0) >= 100,
  ).length
  const nextDeadline = currentGoals
    .filter((goal) => goal.lifecycleStatus === 'active')
    .map((goal) => goal.endDate)
    .sort()[0]

  const availablePlatforms = draft.metric === 'platform_rating' ? ratingPlatforms : solvedPlatforms

  function changeMetric(metric: TrainingGoalMetric) {
    setDraft((current) => ({
      ...current,
      metric,
      platform:
        metric === 'total_solved'
          ? null
          : metric === 'platform_rating'
            ? 'codeforces'
            : 'codeforces',
      targetAmount: metric === 'platform_rating' ? '1500' : '30',
    }))
  }

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const targetAmount = Number(draft.targetAmount)
    if (!Number.isInteger(targetAmount) || targetAmount < 1) {
      setNoticeKind('error')
      setNotice('请输入大于 0 的整数目标。')
      return
    }

    setBusy(true)
    setNotice('')
    try {
      await createTrainingGoal({
        title: draft.title.trim(),
        metric: draft.metric,
        platform: draft.platform,
        targetAmount,
        endDate: draft.endDate,
      })
      setDraft(initialDraft())
      setNoticeKind('success')
      setNotice('训练目标已创建，基线已按最新成功同步数据冻结。')
      setGoals(await fetchTrainingGoals())
      setView('current')
    } catch (reason) {
      setNoticeKind('error')
      setNotice(reason instanceof Error ? reason.message : '训练目标创建失败。')
    } finally {
      setBusy(false)
    }
  }

  function startEditing(goal: TrainingGoal) {
    setEditingId(goal.id)
    setEditDraft({
      title: goal.title,
      targetAmount: String(
        goal.metric === 'platform_rating'
          ? goal.targetValue
          : goal.targetValue - goal.baselineValue,
      ),
      endDate: goal.endDate,
    })
    setNotice('')
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, goal: TrainingGoal) {
    event.preventDefault()
    if (!editDraft) return
    const targetAmount = Number(editDraft.targetAmount)
    if (!Number.isInteger(targetAmount) || targetAmount < 1) {
      setNoticeKind('error')
      setNotice('请输入大于 0 的整数目标。')
      return
    }

    setBusyGoalId(goal.id)
    setNotice('')
    try {
      await updateTrainingGoal(goal, {
        title: editDraft.title.trim(),
        targetValue:
          goal.metric === 'platform_rating' ? targetAmount : goal.baselineValue + targetAmount,
        endDate: editDraft.endDate,
      })
      setEditingId(null)
      setEditDraft(null)
      setNoticeKind('success')
      setNotice('训练目标已保存，原始基线保持不变。')
      setGoals(await fetchTrainingGoals())
    } catch (reason) {
      setNoticeKind('error')
      setNotice(reason instanceof Error ? reason.message : '训练目标保存失败。')
    } finally {
      setBusyGoalId(null)
    }
  }

  async function completeGoal(goal: TrainingGoal) {
    setBusyGoalId(goal.id)
    setNotice('')
    try {
      await completeTrainingGoal(goal)
      setNoticeKind('success')
      setNotice('目标已完成并保留在历史记录中。')
      setGoals(await fetchTrainingGoals())
    } catch (reason) {
      setNoticeKind('error')
      setNotice(reason instanceof Error ? reason.message : '训练目标完成失败。')
    } finally {
      setBusyGoalId(null)
    }
  }

  async function archiveGoal(goal: TrainingGoal) {
    if (!window.confirm(`确定归档“${goal.title}”吗？归档后仍会保留历史记录。`)) return
    setBusyGoalId(goal.id)
    setNotice('')
    try {
      await archiveTrainingGoal(goal)
      setNoticeKind('success')
      setNotice('目标已归档。')
      setGoals(await fetchTrainingGoals())
    } catch (reason) {
      setNoticeKind('error')
      setNotice(reason instanceof Error ? reason.message : '训练目标归档失败。')
    } finally {
      setBusyGoalId(null)
    }
  }

  return (
    <div className="training-goals-page">
      <header className="training-goals-heading">
        <div>
          <Target size={24} aria-hidden="true" />
          <h1>训练目标</h1>
        </div>
        <p>把下一段训练写成可核对的数字，进度只采用平台成功同步的数据。</p>
      </header>

      <section className="training-goals-summary" aria-label="训练目标概览">
        <div>
          <span>进行中</span>
          <strong>{currentGoals.length}</strong>
        </div>
        <div>
          <span>已达成待确认</span>
          <strong>{reachedCount}</strong>
        </div>
        <div>
          <span>最近截止</span>
          <strong>{nextDeadline ? formatDate(nextDeadline) : '暂无'}</strong>
        </div>
      </section>

      {notice ? (
        <p
          className={`training-goals-notice is-${noticeKind}`}
          role={noticeKind === 'error' ? 'alert' : 'status'}
        >
          {notice}
        </p>
      ) : null}

      <div className="training-goals-workspace">
        <aside className="training-goal-create" aria-labelledby="create-training-goal-title">
          <div className="training-goal-create-heading">
            <Plus size={18} aria-hidden="true" />
            <h2 id="create-training-goal-title">创建目标</h2>
          </div>
          <form onSubmit={(event) => void submitGoal(event)}>
            <label>
              <span>目标名称</span>
              <input
                required
                maxLength={80}
                placeholder="例如：暑假完成 100 题"
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, title: event.target.value }))
                }
              />
            </label>

            <fieldset>
              <legend>目标类型</legend>
              <div className="training-goal-type-control">
                <button
                  className={draft.metric === 'total_solved' ? 'is-active' : ''}
                  type="button"
                  aria-pressed={draft.metric === 'total_solved'}
                  onClick={() => changeMetric('total_solved')}
                >
                  总题数
                </button>
                <button
                  className={draft.metric === 'platform_solved' ? 'is-active' : ''}
                  type="button"
                  aria-pressed={draft.metric === 'platform_solved'}
                  onClick={() => changeMetric('platform_solved')}
                >
                  平台题数
                </button>
                <button
                  className={draft.metric === 'platform_rating' ? 'is-active' : ''}
                  type="button"
                  aria-pressed={draft.metric === 'platform_rating'}
                  onClick={() => changeMetric('platform_rating')}
                >
                  Rating
                </button>
              </div>
            </fieldset>

            {draft.metric !== 'total_solved' ? (
              <label>
                <span>平台</span>
                <select
                  required
                  value={draft.platform ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      platform: event.target.value as Platform,
                    }))
                  }
                >
                  {availablePlatforms.map((platform) => (
                    <option value={platform} key={platform}>
                      {platformLabels[platform]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label>
              <span>{draft.metric === 'platform_rating' ? '目标 Rating' : '计划增加题数'}</span>
              <div className="training-goal-number-field">
                <input
                  aria-label={draft.metric === 'platform_rating' ? '目标 Rating' : '计划增加题数'}
                  required
                  min={1}
                  max={draft.metric === 'platform_rating' ? 10000 : 1000000}
                  inputMode="numeric"
                  type="number"
                  value={draft.targetAmount}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, targetAmount: event.target.value }))
                  }
                />
                <span>{targetUnit(draft.metric)}</span>
              </div>
            </label>

            <label>
              <span>截止日期</span>
              <input
                required
                type="date"
                min={beijingDate(7)}
                max={beijingDate(365)}
                value={draft.endDate}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, endDate: event.target.value }))
                }
              />
            </label>

            <p className="training-goal-baseline-note">
              创建当天为开始日期；基线取各平台最近一次成功同步，并在创建后保持不变。
            </p>
            <button className="primary-button training-goal-submit" type="submit" disabled={busy}>
              {busy ? (
                <RefreshCw className="is-spinning" size={16} aria-hidden="true" />
              ) : (
                <Plus size={16} aria-hidden="true" />
              )}
              {busy ? '正在创建' : '创建目标'}
            </button>
          </form>
        </aside>

        <section className="training-goal-list" aria-labelledby="training-goal-list-title">
          <div className="training-goal-list-heading">
            <div>
              <h2 id="training-goal-list-title">我的目标</h2>
              <span>目标与进度仅自己可见</span>
            </div>
            <div className="training-goal-view-control" aria-label="目标范围">
              <button
                className={view === 'current' ? 'is-active' : ''}
                type="button"
                aria-pressed={view === 'current'}
                onClick={() => setView('current')}
              >
                当前 {currentGoals.length}
              </button>
              <button
                className={view === 'history' ? 'is-active' : ''}
                type="button"
                aria-pressed={view === 'history'}
                onClick={() => setView('history')}
              >
                历史 {historyGoals.length}
              </button>
            </div>
          </div>

          {loading ? <LoadingState label="正在读取训练目标" /> : null}
          {!loading && visibleGoals.length === 0 ? (
            <EmptyState
              title={view === 'current' ? '还没有进行中的目标' : '还没有历史目标'}
              description={
                view === 'current'
                  ? '从左侧创建一个可以持续核对的训练目标。'
                  : '完成或归档的目标会保留在这里。'
              }
            />
          ) : null}

          {!loading ? (
            <div className="training-goal-items">
              {visibleGoals.map((goal) => {
                const goalBusy = busyGoalId === goal.id
                const reached = goal.dataAvailable && (goal.progressPercent ?? 0) >= 100
                const editing = editingId === goal.id && editDraft

                return (
                  <article
                    className={`training-goal-item is-${goal.lifecycleStatus}`}
                    key={goal.id}
                  >
                    {editing ? (
                      <form
                        className="training-goal-edit"
                        onSubmit={(event) => void saveEdit(event, goal)}
                      >
                        <div className="training-goal-edit-grid">
                          <label>
                            <span>目标名称</span>
                            <input
                              required
                              maxLength={80}
                              value={editDraft.title}
                              onChange={(event) =>
                                setEditDraft((current) =>
                                  current ? { ...current, title: event.target.value } : current,
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>
                              {goal.metric === 'platform_rating' ? '目标 Rating' : '计划增加题数'}
                            </span>
                            <input
                              aria-label={
                                goal.metric === 'platform_rating' ? '目标 Rating' : '计划增加题数'
                              }
                              required
                              min={1}
                              max={goal.metric === 'platform_rating' ? 10000 : 1000000}
                              type="number"
                              inputMode="numeric"
                              value={editDraft.targetAmount}
                              onChange={(event) =>
                                setEditDraft((current) =>
                                  current
                                    ? { ...current, targetAmount: event.target.value }
                                    : current,
                                )
                              }
                            />
                          </label>
                          <label>
                            <span>截止日期</span>
                            <input
                              required
                              type="date"
                              min={goal.startDate}
                              max={beijingDate(365)}
                              value={editDraft.endDate}
                              onChange={(event) =>
                                setEditDraft((current) =>
                                  current ? { ...current, endDate: event.target.value } : current,
                                )
                              }
                            />
                          </label>
                        </div>
                        <div className="training-goal-edit-actions">
                          <button className="primary-button" type="submit" disabled={goalBusy}>
                            保存
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={goalBusy}
                            onClick={() => {
                              setEditingId(null)
                              setEditDraft(null)
                            }}
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <header className="training-goal-item-heading">
                          <div>
                            <span className={`training-goal-status is-${goal.lifecycleStatus}`}>
                              {statusLabels[goal.lifecycleStatus]}
                            </span>
                            <h3>{goal.title}</h3>
                            <p>{metricLabel(goal)}</p>
                          </div>
                          <time dateTime={goal.endDate}>
                            <CalendarRange size={15} aria-hidden="true" />
                            {formatDate(goal.startDate)}–{formatDate(goal.endDate)}
                          </time>
                        </header>

                        <GoalProgress goal={goal} />

                        <dl className="training-goal-metrics">
                          <div>
                            <dt>创建基线</dt>
                            <dd>{goal.baselineValue}</dd>
                          </div>
                          <div>
                            <dt>当前数据</dt>
                            <dd>{goal.currentValue ?? '—'}</dd>
                          </div>
                          <div>
                            <dt>目标值</dt>
                            <dd>{goal.targetValue}</dd>
                          </div>
                          <div>
                            <dt>最近成功同步</dt>
                            <dd>{formatSyncTime(goal.lastSuccessAt)}</dd>
                          </div>
                        </dl>

                        {goal.dataMessage ? (
                          <p
                            className={`training-goal-data-note${goal.regressed ? ' is-warning' : ''}`}
                          >
                            <CircleAlert size={15} aria-hidden="true" />
                            {goal.dataMessage}
                          </p>
                        ) : null}

                        {goal.lifecycleStatus !== 'archived' ? (
                          <div className="training-goal-actions">
                            {goal.lifecycleStatus === 'active' ? (
                              <button
                                className="secondary-button"
                                type="button"
                                disabled={goalBusy}
                                onClick={() => startEditing(goal)}
                              >
                                <Pencil size={15} aria-hidden="true" />
                                编辑
                              </button>
                            ) : null}
                            {goal.lifecycleStatus === 'active' && reached ? (
                              <button
                                className="primary-button"
                                type="button"
                                disabled={goalBusy}
                                onClick={() => void completeGoal(goal)}
                              >
                                <CheckCircle2 size={15} aria-hidden="true" />
                                确认完成
                              </button>
                            ) : null}
                            <button
                              className="text-button"
                              type="button"
                              disabled={goalBusy}
                              onClick={() => void archiveGoal(goal)}
                            >
                              <Archive size={15} aria-hidden="true" />
                              归档
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </article>
                )
              })}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
