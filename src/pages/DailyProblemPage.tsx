import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days'
import LockKeyhole from 'lucide-react/dist/esm/icons/lock-keyhole'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../auth/authContextValue'
import { EmptyState } from '../components/EmptyState'
import { LoadingState } from '../components/LoadingState'
import { DailyProblemArticle } from '../features/daily-problem/DailyProblemArticle'
import { DailyProblemDiscussion } from '../features/daily-problem/DailyProblemDiscussion'
import {
  createDailyProblemComment,
  deleteDailyProblemComment,
  fetchDailyProblemByDate,
  fetchDailyProblemComments,
  fetchDailyProblemFeed,
  setAdminDailyProblemCommentVisibility,
  setDailyProblemCompletion,
} from '../features/daily-problem/dailyProblemApi'
import {
  demoDailyProblemComments,
  demoDailyProblems,
} from '../features/daily-problem/dailyProblemDemo'
import { supabase } from '../lib/supabase'
import { platformLabels } from '../lib/platforms'
import type { DailyProblem, DailyProblemComment, Platform } from '../types/domain'
import '../features/daily-problem/daily-problem.css'

const recentProblemLimit = 8
const datePattern = /^\d{4}-\d{2}-\d{2}$/

const compactDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Shanghai',
})

function dateLabel(date: string): string {
  return compactDateFormatter.format(new Date(`${date}T00:00:00+08:00`))
}

function publishedDemoProblems(): DailyProblem[] {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return demoDailyProblems.filter(
    (problem) => problem.status === 'published' && problem.date <= today,
  )
}

export function DailyProblemPage() {
  const { date } = useParams<{ date?: string }>()
  const location = useLocation()
  const { status, user } = useAuth()
  const demo = !supabase
  const [problem, setProblem] = useState<DailyProblem | null>(null)
  const [recentProblems, setRecentProblems] = useState<DailyProblem[]>([])
  const [comments, setComments] = useState<DailyProblemComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentNotice, setCommentNotice] = useState('')
  const [completionBusy, setCompletionBusy] = useState(false)
  const [moderationTargetId, setModerationTargetId] = useState<number | null>(null)
  const [moderationReason, setModerationReason] = useState('')

  const approvedMember = Boolean(user && user.reviewStatus === 'approved')
  const canModerate = Boolean(user && user.role === 'admin' && user.reviewStatus === 'approved')
  const activeProblemId = problem?.id ?? null
  const invalidDate = Boolean(date && !datePattern.test(date))
  const loginTarget = `/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`

  const loadProblem = useCallback(async () => {
    setLoading(true)
    setError('')
    setProblem(null)
    setComments([])
    try {
      if (invalidDate) return
      if (demo) {
        const feed = publishedDemoProblems()
        setRecentProblems(feed)
        setProblem(date ? (feed.find((item) => item.date === date) ?? null) : (feed[0] ?? null))
        return
      }

      const [feed, selected] = await Promise.all([
        fetchDailyProblemFeed(recentProblemLimit),
        date ? fetchDailyProblemByDate(date) : Promise.resolve(null),
      ])
      setRecentProblems(feed)
      setProblem(date ? selected : (feed[0] ?? null))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '每日一题读取失败。')
    } finally {
      setLoading(false)
    }
  }, [date, demo, invalidDate])

  useEffect(() => {
    void loadProblem()
  }, [loadProblem])

  const loadComments = useCallback(async () => {
    if (!activeProblemId || !approvedMember) return
    setCommentsLoading(true)
    setCommentNotice('')
    try {
      if (demo) {
        setComments(
          demoDailyProblemComments
            .filter(
              (comment) =>
                comment.problemId === activeProblemId &&
                (comment.visibility === 'visible' || canModerate),
            )
            .map((comment) => ({
              ...comment,
              canDelete: Boolean(user && comment.authorId === user.id),
              authorLabel: user && comment.authorId === user.id ? '我' : comment.authorLabel,
            })),
        )
      } else {
        setComments(await fetchDailyProblemComments(activeProblemId))
      }
    } catch (reason) {
      setCommentNotice(reason instanceof Error ? reason.message : '题目讨论读取失败。')
    } finally {
      setCommentsLoading(false)
    }
  }, [activeProblemId, approvedMember, canModerate, demo, user])

  useEffect(() => {
    void loadComments()
  }, [loadComments])

  const selectedDate = problem?.date ?? date
  const archiveProblems = useMemo(
    () => recentProblems.filter((item) => item.date !== selectedDate),
    [recentProblems, selectedDate],
  )

  async function toggleCompletion() {
    if (!problem || !approvedMember) return
    const requestedCompleted = !problem.completedAt
    setCompletionBusy(true)
    setError('')
    try {
      const completedAt = await setDailyProblemCompletion(problem.id, requestedCompleted)
      setProblem((current) =>
        current
          ? {
              ...current,
              completedAt,
              completionCount: Math.max(0, current.completionCount + (requestedCompleted ? 1 : -1)),
            }
          : current,
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '完成记录保存失败。')
    } finally {
      setCompletionBusy(false)
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!problem || !approvedMember) return
    const body = commentBody.trim()
    if (!body || body.length > 2_000) return

    setCommentBusy(true)
    setCommentNotice('')
    try {
      const created = await createDailyProblemComment(problem.id, body)
      if (demo) {
        setComments((current) => [
          {
            id: created.id,
            problemId: problem.id,
            authorId: user?.id ?? null,
            authorLabel: '我',
            body,
            visibility: 'visible',
            createdAt: created.createdAt,
            updatedAt: created.createdAt,
            canDelete: true,
          },
          ...current,
        ])
      } else {
        await loadComments()
      }
      setProblem((current) =>
        current ? { ...current, commentCount: current.commentCount + 1 } : current,
      )
      setCommentBody('')
      setCommentNotice('讨论已发布。')
    } catch (reason) {
      setCommentNotice(reason instanceof Error ? reason.message : '讨论发布失败。')
    } finally {
      setCommentBusy(false)
    }
  }

  async function removeComment(comment: DailyProblemComment) {
    if (!comment.canDelete) return
    setCommentBusy(true)
    setCommentNotice('')
    try {
      await deleteDailyProblemComment(comment.id, comment.updatedAt)
      setComments((current) => current.filter((item) => item.id !== comment.id))
      setProblem((current) =>
        current ? { ...current, commentCount: Math.max(0, current.commentCount - 1) } : current,
      )
      setCommentNotice('讨论已删除。')
    } catch (reason) {
      setCommentNotice(reason instanceof Error ? reason.message : '讨论删除失败。')
    } finally {
      setCommentBusy(false)
    }
  }

  function startModeration(comment: DailyProblemComment) {
    setModerationTargetId(comment.id)
    setModerationReason('')
    setCommentNotice('')
  }

  async function confirmModeration(comment: DailyProblemComment) {
    if (!canModerate || moderationTargetId !== comment.id) return
    const reason = moderationReason.trim()
    if (!reason || reason.length > 500) return
    const requestedVisible = comment.visibility === 'hidden'
    setCommentBusy(true)
    setCommentNotice('')
    try {
      const updatedAt = await setAdminDailyProblemCommentVisibility(
        comment.id,
        requestedVisible,
        reason,
        comment.updatedAt,
      )
      if (demo) {
        setComments((current) =>
          current.map((item) =>
            item.id === comment.id
              ? {
                  ...item,
                  visibility: requestedVisible ? 'visible' : 'hidden',
                  updatedAt,
                }
              : item,
          ),
        )
      } else {
        await loadComments()
      }
      setModerationTargetId(null)
      setModerationReason('')
      setCommentNotice(requestedVisible ? '讨论已恢复。' : '讨论已隐藏。')
    } catch (reason) {
      setCommentNotice(reason instanceof Error ? reason.message : '讨论可见性修改失败。')
    } finally {
      setCommentBusy(false)
    }
  }

  return (
    <div className="dp-page">
      <header className="dp-page-intro">
        <div>
          <p className="dp-eyebrow">DAILY PROBLEM · 每日一题</p>
          <h1 className="sr-only">每日一题</h1>
          <p>每天留出一段完整时间，独立读题、实现、调试，再和队友交换真正有用的思路。</p>
        </div>
        {date ? (
          <Link className="dp-back-link" to="/daily-problem">
            <ArrowLeft size={15} aria-hidden="true" />
            回到最新题目
          </Link>
        ) : null}
      </header>

      {error ? (
        <p className="dp-page-notice is-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? <LoadingState label="正在读取每日一题" /> : null}

      {!loading && !problem ? (
        <EmptyState
          title={invalidDate ? '日期格式无效' : '这一天还没有公开题目'}
          description="可以返回最新题目，或稍后再来看看。"
        />
      ) : null}

      {!loading && problem ? (
        <div className="dp-layout">
          <div className="dp-main-column">
            <DailyProblemArticle
              problem={problem}
              canComplete={approvedMember}
              completionBusy={completionBusy}
              onToggleCompletion={() => void toggleCompletion()}
            />

            {approvedMember ? (
              commentsLoading ? (
                <LoadingState label="正在读取题目讨论" />
              ) : (
                <DailyProblemDiscussion
                  comments={comments}
                  body={commentBody}
                  busy={commentBusy}
                  notice={commentNotice}
                  canModerate={canModerate}
                  moderationTargetId={moderationTargetId}
                  moderationReason={moderationReason}
                  onBodyChange={setCommentBody}
                  onSubmit={(event) => void submitComment(event)}
                  onDelete={(comment) => void removeComment(comment)}
                  onStartModeration={startModeration}
                  onCancelModeration={() => {
                    setModerationTargetId(null)
                    setModerationReason('')
                  }}
                  onModerationReasonChange={setModerationReason}
                  onConfirmModeration={(comment) => void confirmModeration(comment)}
                />
              )
            ) : status !== 'loading' ? (
              <section className="dp-member-gate" aria-labelledby="daily-problem-member-title">
                <LockKeyhole size={21} aria-hidden="true" />
                <div>
                  <h2 id="daily-problem-member-title">完成记录与队内讨论</h2>
                  <p>
                    {user
                      ? '当前账号尚未启用成员权限，题目仍可正常阅读。'
                      : '登录已启用的成员账号后，可以标记完成并参与题目讨论。'}
                  </p>
                </div>
                {!user ? <Link to={loginTarget}>登录后参与</Link> : null}
              </section>
            ) : null}
          </div>

          <aside className="dp-archive" aria-labelledby="daily-problem-archive-title">
            <div className="dp-archive-heading">
              <CalendarDays size={18} aria-hidden="true" />
              <h2 id="daily-problem-archive-title">最近题目</h2>
            </div>
            {archiveProblems.length > 0 ? (
              <ol>
                {archiveProblems.map((item) => (
                  <li key={item.id}>
                    <Link to={`/daily-problem/${item.date}`}>
                      <time dateTime={item.date}>{dateLabel(item.date)}</time>
                      <span>{item.title}</span>
                      <small>
                        {platformLabels[item.sourcePlatform as Platform] ?? item.sourcePlatform}
                        {approvedMember && item.completedAt ? ' · 已完成' : ''}
                      </small>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p>更多题目将在这里连续积累。</p>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  )
}
