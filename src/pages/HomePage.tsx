import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right'
import Activity from 'lucide-react/dist/esm/icons/activity'
import BookOpenCheck from 'lucide-react/dist/esm/icons/book-open-check'
import Braces from 'lucide-react/dist/esm/icons/braces'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days'
import Crosshair from 'lucide-react/dist/esm/icons/crosshair'
import MessagesSquare from 'lucide-react/dist/esm/icons/messages-square'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import Terminal from 'lucide-react/dist/esm/icons/terminal'
import Timer from 'lucide-react/dist/esm/icons/timer'
import Trophy from 'lucide-react/dist/esm/icons/trophy'
import Users from 'lucide-react/dist/esm/icons/users'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { VerdictTicker } from '../components/VerdictTicker'
import { useAuth } from '../auth/authContextValue'
import { PlatformMark } from '../components/PlatformMark'
import { useMembersData } from '../data/useMembersData'
import { webChatUiEnabled } from '../features/chat/chatAvailability'
import { formatInteger } from '../lib/format'
import {
  openContestPlatforms,
  openContestPlatformUrls,
  platformLabels,
  platformMetricLabels,
} from '../lib/platforms'
import { calculateTotalSolved } from '../lib/rankings'
import './home.css'

import {
  ccpcLogoUrl,
  competitionBadges,
  homeCompetitions,
  icpcLogoUrl,
  statPlatforms,
} from './home/homeData'
import { HeroBalloons } from './home/HeroBalloons'

// 记分牌读数：滚入视口后一次性 count-up，只改 textContent、不碰 opacity（axe 门禁约束）；
// prefers-reduced-motion 或无 IO 时直接落终值。tabular-nums 已就位，数字不抖动。
const SCOREBOARD_COUNT_UP_MS = 900

const ScoreboardValue = memo(function ScoreboardValue({
  loading,
  value,
}: {
  loading: boolean
  value: number
}) {
  const ref = useRef<HTMLElement>(null)
  const [display, setDisplay] = useState<number | null>(null)

  useEffect(() => {
    if (loading) return undefined
    const el = ref.current
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!el || reduceMotion || !('IntersectionObserver' in window)) {
      setDisplay(null)
      return undefined
    }
    let raf = 0
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        const start = performance.now()
        const tick = (now: number) => {
          const progress = Math.min((now - start) / SCOREBOARD_COUNT_UP_MS, 1)
          const eased = 1 - (1 - progress) ** 3
          setDisplay(Math.round(value * eased))
          if (progress < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      },
      { threshold: 0.4 },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [loading, value])

  return (
    <strong ref={ref}>
      {loading ? (
        <>
          <span aria-hidden="true">--</span>
          <span className="sr-only">加载中</span>
        </>
      ) : (
        formatInteger(display ?? value)
      )}
    </strong>
  )
})

export function HomePage() {
  const { user } = useAuth()
  const { members, loading, error, demo } = useMembersData()
  const totalSolvedCount = useMemo(
    () => members.reduce((total, member) => total + (calculateTotalSolved(member) ?? 0), 0),
    [members],
  )

  return (
    <div className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-grid-lines" aria-hidden="true" />
        <div className="home-hero-corner home-hero-corner--top" aria-hidden="true">
          <span>USTS / ACM</span>
          <span>31°19' N&nbsp;&nbsp;120°37' E</span>
        </div>
        <div className="home-hero-corner home-hero-corner--bottom" aria-hidden="true">
          <span>训练不是准备，是正在发生</span>
          <span>2026 — 01</span>
        </div>
        <img
          className="home-hero-logo"
          src={icpcLogoUrl}
          width="390"
          height="362"
          alt=""
          aria-hidden="true"
        />
        <div className="home-hero-grid">
          <div className="home-hero-copy">
            <div className="home-hero-kicker">
              <span className="home-hero-kicker-mark">
                <Activity size={13} aria-hidden="true" />
              </span>
              <span>SUZHOU UNIVERSITY OF SCIENCE AND TECHNOLOGY</span>
              <span className="home-hero-kicker-status" aria-hidden="true">
                LIVE / 01
              </span>
            </div>
            <h1 id="home-title">
              USTS ACM Land<span className="sr-only">：苏州科技大学 ACM 集训队</span>
            </h1>
            <p className="home-hero-statement">
              把最难的题
              <br />
              <em>留给自己。</em>
            </p>
            <p className="home-hero-lead">
              苏州科技大学 ACM
              集训队的线上主页。记录训练，也记录那些在时间压力下被重新理解的算法、协作与创造力。
            </p>
            <div className="home-hero-actions">
              <a className="home-primary-action" href="#about-acm">
                了解 ACM 竞赛
                <ArrowRight size={17} aria-hidden="true" />
              </a>
              <Link className="home-secondary-action" to="/learning">
                <BookOpenCheck size={17} aria-hidden="true" />
                新手入门
              </Link>
            </div>
          </div>

          <div className="home-hero-instrument" role="group" aria-label="ACM 竞赛速览">
            <div className="home-hero-instrument-head" aria-hidden="true">
              <span>
                <Crosshair size={15} /> FIELD NOTE / 001
              </span>
              <span>READY</span>
            </div>
            <div className="home-hero-art">
              <span
                className="home-hero-art-axis home-hero-art-axis--horizontal"
                aria-hidden="true"
              />
              <span
                className="home-hero-art-axis home-hero-art-axis--vertical"
                aria-hidden="true"
              />
              <div className="home-hero-art-balloons" aria-hidden="true">
                <HeroBalloons />
              </div>
              <span
                className="home-hero-art-coordinate home-hero-art-coordinate--one"
                aria-hidden="true"
              >
                X 031.19
              </span>
              <span
                className="home-hero-art-coordinate home-hero-art-coordinate--two"
                aria-hidden="true"
              >
                Y 120.37
              </span>
              <span className="home-hero-art-scan" aria-hidden="true" />
            </div>
            <div className="home-hero-instrument-grid">
              <div>
                <Terminal size={16} aria-hidden="true" />
                <span>DEVICE</span>
                <strong>一台电脑</strong>
              </div>
              <div>
                <Users size={16} aria-hidden="true" />
                <span>TEAM</span>
                <strong>三人一队</strong>
              </div>
              <div>
                <Timer size={16} aria-hidden="true" />
                <span>TIME</span>
                <strong>五小时</strong>
              </div>
            </div>
            <p className="home-hero-instrument-caption">
              在 ICPC 赛场，每解出一道题，志愿者就会给队伍系上一只气球。
            </p>
          </div>
        </div>
        <div className="home-hero-index" aria-hidden="true">
          <span>01</span>
          <span>ALGORITHM</span>
          <span>TEAMWORK</span>
          <span>CONTEST</span>
          <span className="home-hero-index-line" />
        </div>
      </section>

      <VerdictTicker />

      <section className="home-section acm-introduction" id="about-acm">
        <div className="home-section-heading">
          <p className="home-section-index">01 / 关于竞赛</p>
          <span className="home-section-meta" aria-hidden="true">
            MODE / TEAM×3
          </span>
          <h2>ACM，不只是把题做出来</h2>
        </div>
        <div className="acm-introduction-body">
          <div className="acm-introduction-copy">
            <p className="acm-introduction-lead">
              如果把软件项目看作一套完整系统，ACM
              关注的正是其中最难、最需要突破的算法问题：把复杂条件抽象成模型，找到关键规律，再用严谨的程序完成攻坚。它是智力与创造力的巅峰赛，要求参赛者在时间压力下不断判断与验证。
              大家常说的“ACM 竞赛”，通常指 ICPC、CCPC 等大学生程序设计竞赛。
            </p>
            <aside className="acm-ai-note" aria-label="算法竞赛中的 AI 使用原则">
              <ShieldCheck size={20} aria-hidden="true" />
              <div>
                <strong>赛场禁止，学习鼓励</strong>
                <p>
                  正式算法竞赛中禁止使用 AI；日常学习与训练中，鼓励用 AI
                  辅助理解知识、复盘代码和拓展思路，但要亲自完成推导与验证。
                </p>
              </div>
            </aside>
          </div>
          <div className="acm-capability-panel">
            <div className="home-instrument-head" aria-hidden="true">
              <span>
                <Crosshair size={13} /> FIELD NOTE / 003 — CAPABILITY
              </span>
              <span>3 AXES</span>
            </div>
            <div className="acm-capability-list">
              <article>
                <span>01</span>
                <Braces size={20} aria-hidden="true" />
                <h3>算法与建模</h3>
                <p>从图论、动态规划到数据结构，找到能在时空限制内运行的解法。</p>
              </article>
              <article>
                <span>02</span>
                <Users size={20} aria-hidden="true" />
                <h3>协作与表达</h3>
                <p>快速解释思路、分配题目，在同一台电脑上组织整个队伍的节奏。</p>
              </article>
              <article>
                <span>03</span>
                <Trophy size={20} aria-hidden="true" />
                <h3>判断与韧性</h3>
                <p>在罚时和失败提交的压力下复盘错误，决定何时坚持、何时换题。</p>
              </article>
            </div>
            <p className="home-instrument-caption">同一台电脑，五小时，一支队伍。</p>
          </div>
        </div>
      </section>

      <section
        className="home-section home-competition-section"
        aria-labelledby="competition-overview-title"
      >
        <div className="home-section-heading">
          <p className="home-section-index">02 / 赛事版图</p>
          <span className="home-section-meta" aria-hidden="true">
            CLASS / Ⅰ-B
          </span>
          <h2 id="competition-overview-title">从省赛到世界赛，认识主要算法竞赛</h2>
          <div className="home-competition-marks" role="group" aria-label="ICPC 与 CCPC 赛事标志">
            <figure>
              <img
                src={icpcLogoUrl}
                width="390"
                height="362"
                loading="lazy"
                decoding="async"
                alt="ICPC Foundation 标志"
              />
              <figcaption>ICPC / WORLD</figcaption>
            </figure>
            <figure>
              <img
                src={ccpcLogoUrl}
                width="152"
                height="153"
                loading="lazy"
                decoding="async"
                alt="CCPC 标志"
              />
              <figcaption>CCPC / CHINA</figcaption>
            </figure>
          </div>
        </div>
        <div className="home-competition-body">
          <div className="home-competition-copy">
            <p>
              高校算法竞赛既有强调三人协作的团队赛，也有考验个人基本功的个人赛。不同赛事共同训练建模、编码、调试和临场决策能力。
            </p>
            <div className="home-competition-note">
              <p>
                以下赛事均属于我校认定的 <strong>Ⅰ乙比赛</strong>。ICPC、CCPC 与 JSCPC
                是三个相互独立的赛事体系，并非同一赛事的不同级别。
              </p>
              <p>
                国内大厂技术笔试多采用算法竞赛的 <strong>ACM 模式</strong>
                ，比赛题目与考试形式通常和 ACM 一致。
              </p>
            </div>
          </div>
          <div className="home-competition-list" role="list" aria-label="主要算法竞赛简介">
            {homeCompetitions.map((competition) => (
              <article role="listitem" key={competition.letter}>
                <span
                  className="home-competition-letter"
                  style={competitionBadges[competition.letter]}
                >
                  {competition.letter}
                </span>
                <div>
                  <strong>{competition.name}</strong>
                  <small>{competition.fullName}</small>
                </div>
                <p>{competition.description}</p>
                <span className="home-competition-type">{competition.type}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        className="home-section home-open-contests-section"
        aria-labelledby="open-contests-title"
      >
        <div className="home-section-heading">
          <p className="home-section-index">03 / 线上公开赛</p>
          <span className="home-section-meta" aria-hidden="true">
            FREQ / 10+ WEEKLY
          </span>
          <h2 id="open-contests-title">每一周，都有新的比赛可以参加</h2>
        </div>
        <div className="home-open-contests-body">
          <div className="home-open-contests-copy">
            <p>
              每周都有十场以上面向所有人的线上公开赛。它们由世界各地的算法竞赛爱好者自发出题、组织成免费公开赛，供全球
              ACMer 在同一场比赛中交流、学习与复盘。
            </p>
            <p>
              赛程持续不断，比赛练习机会并不稀缺。无论刚开始接触算法，还是准备正式赛事，都能找到适合当前水平的比赛和题目。
            </p>
          </div>
          <div className="home-open-contests-panel">
            <div className="home-open-contests-counter">
              <div className="home-instrument-head" aria-hidden="true">
                <span>
                  <Crosshair size={13} /> FIELD NOTE / 004 — OPEN CONTESTS
                </span>
                <span>WEEKLY</span>
              </div>
              <div className="home-open-contests-stat">
                <strong>10+</strong>
                <span>场公开赛 / 每周</span>
                <small>免费开放，持续更新</small>
              </div>
            </div>
            <div
              className="home-open-contests-platforms"
              role="list"
              aria-label="主要线上公开赛平台"
            >
              {openContestPlatforms.map((platform, index) => (
                <a
                  key={platform}
                  role="listitem"
                  href={openContestPlatformUrls[platform]}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <PlatformMark platform={platform} />
                  <small>
                    公开赛与练习
                    <ArrowUpRight size={11} aria-hidden="true" />
                  </small>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="home-section home-vision-section" aria-labelledby="home-vision-title">
        <div className="home-section-heading">
          <p className="home-section-index">04 / 学习资源</p>
          <span className="home-section-meta" aria-hidden="true">
            PATH / GUIDED
          </span>
          <h2 id="home-vision-title">开放资源，帮新手走稳第一步</h2>
        </div>
        <div className="home-vision-body">
          <p>
            算法竞赛拥有丰富的在线训练资源，绝大多数免费向学习者开放。本网站将筛选其中适合入门的一部分，按知识点和训练阶段提供引导，减少资料筛选成本，帮助新手快速上手。
          </p>
          <div className="home-vision-panel">
            <div className="home-instrument-head" aria-hidden="true">
              <span>
                <Crosshair size={13} /> FIELD NOTE / 005 — RESOURCES
              </span>
              <span>{webChatUiEnabled ? '3 MODULES' : '2 MODULES'}</span>
            </div>
            <div className="home-vision-list" role="list" aria-label="学习功能">
              <article role="listitem">
                <BookOpenCheck size={21} aria-hidden="true" />
                <div>
                  <h3>学习引导</h3>
                  <p>按知识点组织学习路线、资料与阶段目标。</p>
                </div>
                <Link to="/learning" className="home-vision-chip is-live">
                  已上线<span className="sr-only">：新手学习引导</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </article>
              <article role="listitem">
                <CalendarDays size={21} aria-hidden="true" />
                <div>
                  <h3>每日一题</h3>
                  <p>提供稳定的日常练习入口与题目讨论。</p>
                </div>
                <Link to="/daily-problem" className="home-vision-chip is-live">
                  已上线<span className="sr-only">：每日一题</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </article>
              {webChatUiEnabled ? (
                <article role="listitem">
                  <MessagesSquare size={21} aria-hidden="true" />
                  <div>
                    <h3>AI 学习助手</h3>
                    <p>在站内完成知识问答、代码讲解和训练复盘。</p>
                  </div>
                  <Link to="/assistant" className="home-vision-chip is-live">
                    {user ? '已上线' : '成员登录后可用'}
                    <span className="sr-only">：AI 学习助手</span>
                    <ArrowRight size={13} aria-hidden="true" />
                  </Link>
                </article>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="home-section home-platform-section" aria-labelledby="platform-title">
        <div className="home-section-heading">
          <p className="home-section-index">05 / 训练记录</p>
          <span className="home-section-meta" aria-hidden="true">
            SYNC / 2×DAILY
          </span>
          <h2 id="platform-title">公开数据，是成长的一份记录</h2>
        </div>
        <div className="home-platform-context">
          <p>
            榜单用于观察长期训练投入和平台表现，是集训队官网的一部分，而不是衡量成员的唯一标准。如果每道题都发一只气球，教室早就装不下了。
          </p>
          <div
            className="home-data-summary"
            role="group"
            aria-label="公开数据概览"
            aria-busy={loading}
          >
            <span className="home-scoreboard-head" aria-hidden="true">
              <Crosshair size={12} /> FIELD NOTE / 002 — SCOREBOARD
            </span>
            <span>
              <ScoreboardValue loading={loading} value={totalSolvedCount} />
              <span className="home-balloon-dot" aria-hidden="true" /> 累计通过题数
            </span>
            {error ? null : (
              <small>{loading ? '数据加载中' : demo ? '当前为演示数据' : '公开数据源'}</small>
            )}
          </div>
          <Link className="home-section-link" to="/rankings">
            查看完整榜单
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        {/* live region 常驻 DOM、只切换文本：随内容一起插入的 status 在部分读屏组合下不播报 */}
        <p className="home-data-warning" role="status">
          {error ? '实时数据读取失败，当前展示演示数据。' : null}
        </p>
        <div className="home-platform-body">
          <div className="home-platform-list" role="list" aria-label="统计平台">
            {statPlatforms.map((platform, index) => (
              <div key={platform} role="listitem">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{platformLabels[platform]}</strong>
                <small>{platformMetricLabels[platform]}</small>
              </div>
            ))}
          </div>
          <div className="home-sync-schedule">
            <CalendarClock size={24} aria-hidden="true" />
            <div>
              <p>自动同步节奏</p>
              <dl>
                <div>
                  <dt>每日 07:00 / 19:00</dt>
                  <dd>Codeforces、牛客、AtCoder、洛谷</dd>
                </div>
                <div>
                  <dt>每周二 08:00</dt>
                  <dd>XCPC ELO、QOJ</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section home-join-section" aria-labelledby="join-title">
        <div className="home-section-heading">
          <p className="home-section-index">06 / 加入我们</p>
          <span className="home-section-meta" aria-hidden="true">
            SELECT / 3 ROUNDS
          </span>
          <h2 id="join-title">在比赛中找到下一段训练</h2>
        </div>
        <div className="home-join-body">
          <div className="home-join-intro">
            <p className="home-join-lead">
              集训队每年通过三场面向不同人群的比赛选拔成员。无需提前加入，先来参加比赛，在真实题目和有限时间里展示自己的思路与潜力。
            </p>
            <aside className="home-join-group" aria-label="USTS算法小白交流群">
              <MessagesSquare size={22} aria-hidden="true" />
              <div>
                <span>校内交流入口</span>
                <strong>USTS算法小白交流群</strong>
                <p>
                  QQ 群 721375856。在 QQ
                  中搜索群号加入，获取训练安排与校内赛通知，也可以交流入门问题。
                </p>
              </div>
            </aside>
          </div>
          <div className="home-join-events-panel">
            <div className="home-instrument-head" aria-hidden="true">
              <span>
                <Crosshair size={13} /> FIELD NOTE / 006 — SELECTION
              </span>
              <span>3 ROUNDS / YEAR</span>
            </div>
            <div className="home-join-events">
              <article>
                <span className="home-join-month">12 月</span>
                <div>
                  <h3>新生赛</h3>
                  <p className="home-join-target">面向新生</p>
                  <p>选拔新生进入集训队，开始更高强度、更系统的算法训练。</p>
                  <Link className="home-join-detail-link" to="/contests">
                    了解新生赛
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </div>
              </article>
              <article>
                <span className="home-join-month">03 月</span>
                <div>
                  <h3>练习赛</h3>
                  <p className="home-join-target">面向所有人</p>
                  <p>选拔代表学校参加天梯赛的选手，在团队协作中完成新的挑战。</p>
                </div>
              </article>
              <article>
                <span className="home-join-month">04 月</span>
                <div>
                  <h3>校赛</h3>
                  <p className="home-join-target">面向所有人</p>
                  <p>选拔代表学校参加 JSCPC 的队伍，向更高水平的省级赛事出发。</p>
                </div>
              </article>
            </div>
          </div>
        </div>
        <p className="home-join-note">
          每场比赛中表现优异的选手，都有机会加入集训队，和队友一起持续训练、参加更多比赛。
        </p>
      </section>

      <section className="home-action-band" aria-labelledby="home-action-title">
        <div>
          <p>USTS ACM LAND</p>
          <h2 id="home-action-title">从一道题到一支队伍，让学习、训练与交流持续发生。</h2>
        </div>
        <div className="home-action-links">
          <Link
            className="home-primary-action home-primary-action-light"
            to={user ? '/account' : '/register'}
          >
            {user ? '管理我的资料' : '创建成员账号'}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  )
}
