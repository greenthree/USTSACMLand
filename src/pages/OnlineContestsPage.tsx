import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link'
import Timer from 'lucide-react/dist/esm/icons/timer'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { PlatformMark } from '../components/PlatformMark'
import {
  CONTEST_PLATFORM_LABELS,
  formatBeijingDateTime,
  formatContestDuration,
  formatCountdown,
  getContestStatus,
  getContestWindow,
  type ContestEvent,
  type ContestPlatform,
  type ContestStatus,
} from '../lib/contestCalendar'
import type { Platform } from '../types/domain'
import { fetchContestCalendar, type ContestCalendarResponse } from '../lib/contestCalendarApi'
import './online-contests.css'

type LoadState = 'loading' | 'ready' | 'error'

function statusLabel(event: ContestEvent, status: ContestStatus, now: Date): string {
  if (status === 'ended') return '已结束'
  if (status === 'live') {
    return `距结束 ${formatCountdown(Date.parse(event.endAt) - now.getTime())}`
  }
  return `距开始 ${formatCountdown(Date.parse(event.startAt) - now.getTime())}`
}

const platformMarkMap: Partial<Record<ContestPlatform, Platform>> = {
  'codeforces.com': 'codeforces',
  'ac.nowcoder.com': 'nowcoder',
  'atcoder.jp': 'atcoder',
  'luogu.com.cn': 'luogu',
  'qoj.ac': 'qoj',
}

const fallbackPlatformMarks: Record<'leetcode.com' | 'topcoder.com' | 'uoj.ac', string> = {
  'leetcode.com': 'LC',
  'topcoder.com': 'TC',
  'uoj.ac': 'UOJ',
}

function ContestPlatformMark({ platform }: { platform: ContestPlatform }) {
  const knownPlatform = platformMarkMap[platform]
  if (knownPlatform) return <PlatformMark platform={knownPlatform} />

  return (
    <span className="platform-mark-wrap">
      <span
        className={`platform-mark contest-platform-${platform.split('.')[0]}`}
        aria-hidden="true"
      >
        {fallbackPlatformMarks[platform as keyof typeof fallbackPlatformMarks]}
      </span>
      <span>{CONTEST_PLATFORM_LABELS[platform]}</span>
    </span>
  )
}

export function OnlineContestsPage() {
  const [calendar, setCalendar] = useState<ContestCalendarResponse | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const contestWindow = useMemo(() => getContestWindow(now), [now])

  const load = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      const result = await fetchContestCalendar(getContestWindow())
      setCalendar(result)
      setState('ready')
    } catch (loadError) {
      setCalendar(null)
      setState('error')
      setError(loadError instanceof Error ? loadError.message : '线上比赛服务暂时不可用')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      setNow(new Date())
    }, 1_000)
    return () => globalThis.clearInterval(timer)
  }, [load])

  const groupedEvents = useMemo(() => {
    if (!calendar) return []
    return calendar.events.map((event) => ({
      event,
      status: getContestStatus(event, now),
    }))
  }, [calendar, now])

  return (
    <div className="page online-contests-page">
      <section className="page-heading online-contests-heading">
        <div>
          <p className="eyebrow">ONLINE CONTESTS / CLIST</p>
          <h1>线上比赛</h1>
          <p>展示北京时间前两天至未来十四天的公开比赛，点击比赛名称前往官方赛场。</p>
        </div>
        <div className="online-contests-window">
          <CalendarDays size={17} aria-hidden="true" />
          <span>
            {formatBeijingDateTime(contestWindow.startAt.toISOString())} –{' '}
            {formatBeijingDateTime(contestWindow.endAt.toISOString())}
          </span>
          <span className="online-contests-update-note">后台每小时更新</span>
        </div>
      </section>

      {state === 'loading' ? (
        <div className="online-contests-state" role="status" aria-live="polite">
          <Timer size={22} aria-hidden="true" />
          正在读取近期比赛…
        </div>
      ) : state === 'error' ? (
        <div className="online-contests-state is-error" role="alert">
          <EmptyState title="暂时无法获取线上比赛" description={error} />
          <a href="https://clist.by/" target="_blank" rel="noreferrer">
            前往 clist.by 查看
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
      ) : groupedEvents.length === 0 ? (
        <div className="online-contests-state">
          <EmptyState
            title="窗口内暂无比赛"
            description="可以前往 clist.by 查看更长时间范围的赛事日历。"
          />
          <a href="https://clist.by/" target="_blank" rel="noreferrer">
            打开 clist.by
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
      ) : (
        <div className="online-contests-table-wrap">
          <table className="online-contests-table">
            <caption className="sr-only">近期线上比赛</caption>
            <thead>
              <tr>
                <th className="online-contest-platform-column">比赛平台</th>
                <th>比赛名称</th>
                <th className="online-contest-intro-column">入门比赛</th>
                <th className="online-contest-start-column">开始时间</th>
                <th className="online-contest-duration-column">持续时长</th>
                <th className="online-contest-status-column">比赛状态</th>
              </tr>
            </thead>
            <tbody>
              {groupedEvents.map(({ event, status }) => {
                const currentStatusLabel = statusLabel(event, status, now)
                return (
                  <tr key={event.id} className={`online-contest-row is-${status}`}>
                    <td className="online-contest-platform-cell" data-label="比赛平台">
                      <ContestPlatformMark platform={event.platform} />
                    </td>
                    <td className="online-contest-name-cell" data-label="比赛名称">
                      <a href={event.url} target="_blank" rel="noreferrer">
                        <span>{event.name}</span>
                        <ExternalLink size={15} aria-hidden="true" />
                      </a>
                    </td>
                    <td className="online-contest-intro-cell" data-label="入门比赛">
                      {event.introductory ? (
                        <span className="online-contest-badge">入门比赛</span>
                      ) : (
                        <span className="online-contest-empty" aria-label="非入门比赛">
                          —
                        </span>
                      )}
                    </td>
                    <td className="online-contest-time-cell" data-label="开始时间">
                      {formatBeijingDateTime(event.startAt)}
                    </td>
                    <td className="online-contest-duration-cell" data-label="持续时长">
                      {formatContestDuration(event.startAt, event.endAt)}
                    </td>
                    <td className="online-contest-status-cell" data-label="比赛状态">
                      <span
                        className="online-contest-status"
                        aria-label={`比赛状态：${currentStatusLabel}`}
                      >
                        {currentStatusLabel}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {calendar ? (
        <p className="online-contests-source">
          数据更新时间：{formatBeijingDateTime(calendar.fetchedAt)} · 来源：clist.by（官方比赛链接）
        </p>
      ) : null}
    </div>
  )
}
