import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right'
import Check from 'lucide-react/dist/esm/icons/check'
import CircleCheckBig from 'lucide-react/dist/esm/icons/circle-check-big'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3'
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle'
import { platformLabels } from '../../lib/platforms'
import type { DailyProblem, Platform } from '../../types/domain'

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  timeZone: 'Asia/Shanghai',
})

function displayDate(date: string): string {
  return dateFormatter.format(new Date(`${date}T00:00:00+08:00`))
}

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

interface DailyProblemArticleProps {
  problem: DailyProblem
  canComplete: boolean
  completionBusy: boolean
  onToggleCompletion: () => void
}

export function DailyProblemArticle({
  problem,
  canComplete,
  completionBusy,
  onToggleCompletion,
}: DailyProblemArticleProps) {
  const sourceUrl = safeSourceUrl(problem.sourceUrl)
  const completed = Boolean(problem.completedAt)

  return (
    <article className="dp-problem-card" aria-labelledby="daily-problem-title">
      <header className="dp-problem-header">
        <div>
          <p className="dp-date-label">{displayDate(problem.date)}</p>
          <h1 id="daily-problem-title">{problem.title}</h1>
        </div>
        <span className="dp-problem-number">#{problem.id.toString().padStart(3, '0')}</span>
      </header>

      <div className="dp-problem-meta" aria-label="题目信息">
        <span>{platformLabels[problem.sourcePlatform as Platform] ?? problem.sourcePlatform}</span>
        {problem.externalProblemId ? <span>{problem.externalProblemId}</span> : null}
        <span>{problem.difficulty}</span>
        {problem.estimatedMinutes ? (
          <span>
            <Clock3 size={14} aria-hidden="true" />
            建议 {problem.estimatedMinutes} 分钟
          </span>
        ) : null}
      </div>

      {problem.tags.length > 0 ? (
        <ul className="dp-tag-list" aria-label="题目标签">
          {problem.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      ) : null}

      <section className="dp-training-note" aria-labelledby="training-note-title">
        <p id="training-note-title">今日训练提示</p>
        <blockquote>
          {problem.trainingNote || '先独立阅读题意并写下思路，再打开编辑器开始实现。'}
        </blockquote>
      </section>

      <footer className="dp-problem-footer">
        <div className="dp-community-counts" aria-label="训练参与情况">
          <span>
            <CircleCheckBig size={16} aria-hidden="true" />
            {problem.completionCount} 人完成
          </span>
          <span>
            <MessageCircle size={16} aria-hidden="true" />
            {problem.commentCount} 条讨论
          </span>
        </div>
        <div className="dp-problem-actions">
          {canComplete ? (
            <button
              className={completed ? 'dp-complete-button is-completed' : 'dp-complete-button'}
              type="button"
              disabled={completionBusy}
              aria-pressed={completed}
              onClick={onToggleCompletion}
            >
              <Check size={16} aria-hidden="true" />
              {completionBusy ? '正在保存' : completed ? '今天已完成' : '标记为已完成'}
            </button>
          ) : null}
          {sourceUrl ? (
            <a className="dp-source-link" href={sourceUrl} target="_blank" rel="noreferrer">
              打开原题
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </footer>
    </article>
  )
}
