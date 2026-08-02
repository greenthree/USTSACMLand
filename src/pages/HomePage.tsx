import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
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
import { memo, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/authContextValue'
import { PlatformMark } from '../components/PlatformMark'
import { useMembersData } from '../data/useMembersData'
import { webChatUiEnabled } from '../features/chat/chatAvailability'
import { formatInteger } from '../lib/format'
import { openContestPlatforms, platformLabels, platformMetricLabels } from '../lib/platforms'
import { calculateTotalSolved } from '../lib/rankings'

const icpcLogoUrl = `${import.meta.env.BASE_URL}icpc-foundation.png`
const ccpcLogoUrl = `${import.meta.env.BASE_URL}ccpc-logo.png`

const statPlatforms = Object.keys(platformLabels) as (keyof typeof platformLabels)[]

// 气球调色板唯一来源：hero SVG、赛事字母徽章共用；改色只改这里。
type BalloonLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

const balloonPalette: Record<BalloonLetter, { fill: string; knot: string; ink: string }> = {
  A: { fill: '#d43d2a', knot: '#a92f20', ink: '#fff' },
  B: { fill: '#e8842c', knot: '#c26a1f', ink: '#161d17' },
  C: { fill: '#e5b32b', knot: '#b98f1f', ink: '#161d17' },
  D: { fill: '#2e7d4f', knot: '#245f3d', ink: '#fff' },
  E: { fill: '#2a5fd4', knot: '#2049a4', ink: '#fff' },
  F: { fill: '#7a3fd4', knot: '#5d2fa4', ink: '#fff' },
}

const competitionBadges = Object.fromEntries(
  (Object.keys(balloonPalette) as BalloonLetter[]).map((letter) => [
    letter,
    { background: balloonPalette[letter].fill, color: balloonPalette[letter].ink },
  ]),
) as Record<BalloonLetter, { background: string; color: string }>

interface HeroBalloon {
  letter: BalloonLetter
  cx: number
  cy: number
  rx: number
  ry: number
  fill: string
  knot: string
  ink: string
  sway: 1 | -1
  airFreq: number
  airPhase: number
}

const heroBalloons: HeroBalloon[] = [
  {
    letter: 'A',
    cx: 66,
    cy: 128,
    rx: 34,
    ry: 41,
    sway: 1,
    airFreq: 0.52,
    airPhase: 0.4,
    ...balloonPalette.A,
  },
  {
    letter: 'B',
    cx: 152,
    cy: 170,
    rx: 28,
    ry: 34,
    sway: -1,
    airFreq: 0.67,
    airPhase: 2.8,
    ...balloonPalette.B,
  },
  {
    letter: 'C',
    cx: 236,
    cy: 118,
    rx: 37,
    ry: 45,
    sway: 1,
    airFreq: 0.45,
    airPhase: 4.6,
    ...balloonPalette.C,
  },
  {
    letter: 'D',
    cx: 318,
    cy: 164,
    rx: 27,
    ry: 33,
    sway: -1,
    airFreq: 0.73,
    airPhase: 1.5,
    ...balloonPalette.D,
  },
  {
    letter: 'E',
    cx: 384,
    cy: 134,
    rx: 31,
    ry: 38,
    sway: 1,
    airFreq: 0.58,
    airPhase: 5.7,
    ...balloonPalette.E,
  },
]

interface HomeCompetition {
  letter: BalloonLetter
  name: string
  fullName: string
  description: string
  type: string
}

const homeCompetitions: HomeCompetition[] = [
  {
    letter: 'A',
    name: 'ICPC',
    fullName: '国际大学生程序设计竞赛',
    description: '面向全球高校的三人团队赛，经区域赛晋级全球总决赛。',
    type: '团队赛 · 国际',
  },
  {
    letter: 'B',
    name: 'CCPC',
    fullName: '中国大学生程序设计竞赛',
    description: '国内高水平三人团队赛事，设分站赛、女生专场和总决赛等竞赛阶段。',
    type: '团队赛 · 全国',
  },
  {
    letter: 'C',
    name: '华为杯 JSCPC',
    fullName: '江苏省大学生程序设计大赛',
    description: '面向江苏高校的省级程序设计赛事，以团队协作完成算法题目。',
    type: '团队赛 · 省级',
  },
  {
    letter: 'D',
    name: '蓝桥杯',
    fullName: '全国软件和信息技术专业人才大赛',
    description: '按组别开展的个人程序设计竞赛，覆盖省赛与全国总决赛。',
    type: '个人赛 · 全国',
  },
  {
    letter: 'E',
    name: '天梯赛',
    fullName: '中国高校计算机大赛团体程序设计天梯赛',
    description: '选手独立答题、成绩按团队汇总，兼顾个人能力与学校整体实力。',
    type: '团体计分 · 全国',
  },
  {
    letter: 'F',
    name: '百度之星',
    fullName: '程序设计大赛',
    description: '面向高校选手与开发者的个人算法竞赛，强调在线解题和综合编程能力。',
    type: '个人赛 · 全国',
  },
]

interface VerdictEntry {
  problem: string
  verdict: string
  tone?: 'ac' | 'wa'
}

const verdictStrip: VerdictEntry[] = [
  { problem: 'A', verdict: 'Accepted', tone: 'ac' },
  { problem: 'B', verdict: 'Accepted', tone: 'ac' },
  { problem: 'C', verdict: 'Wrong Answer', tone: 'wa' },
  { problem: 'C', verdict: 'Accepted', tone: 'ac' },
  { problem: 'D', verdict: 'Running' },
  { problem: 'E', verdict: 'Accepted', tone: 'ac' },
  { problem: 'F', verdict: 'Pending' },
  { problem: 'G', verdict: 'Time Limit', tone: 'wa' },
  { problem: 'H', verdict: 'Accepted', tone: 'ac' },
  { problem: 'I', verdict: 'Pending' },
  { problem: 'J', verdict: 'Accepted', tone: 'ac' },
  { problem: 'K', verdict: 'Compiling' },
]

function VerdictStripSegment() {
  return (
    <>
      {verdictStrip.map((entry, index) => (
        <span key={index}>
          {entry.problem}{' '}
          {entry.tone ? (
            <span className={`verdict-${entry.tone}`}>{entry.verdict}</span>
          ) : (
            entry.verdict
          )}
          {' · '}
        </span>
      ))}
    </>
  )
}

// 气球画框几何：viewBox 与运动边界的关系集中在此。
const VIEW_W = 420
const VIEW_H = 280
const WALL_MARGIN = 4
const CEILING_MARGIN = 6
const FLOOR_Y = 244
const KNOT_DROP = 7
const STRING_BASE_Y = 270

function balloonStringPath(balloon: HeroBalloon, offsetX = 0, offsetY = 0) {
  const knotX = balloon.cx + offsetX
  const knotY = balloon.cy + balloon.ry + KNOT_DROP + offsetY
  const baseX = balloon.cx + balloon.sway * 3
  const midX = (knotX + baseX) / 2 + balloon.sway * 7 - offsetX * 0.35
  const midY = (knotY + STRING_BASE_Y) / 2 + 9
  return `M${baseX} ${STRING_BASE_Y} Q ${midX.toFixed(1)} ${midY.toFixed(1)}, ${knotX.toFixed(1)} ${knotY.toFixed(1)}`
}

// memo：组件无 props，仅首渲染一次；把 rAF 的命令式 DOM 写入与父级重渲染彻底隔离
const HeroBalloons = memo(function HeroBalloons() {
  const svgRef = useRef<SVGSVGElement>(null)
  const bodyRefs = useRef<(SVGGElement | null)[]>([])
  const stringRefs = useRef<(SVGPathElement | null)[]>([])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return undefined

    const states = heroBalloons.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }))
    const radii = heroBalloons.map((balloon) => (balloon.rx + balloon.ry) / 2)
    // 绳长约束边界（画框内、绳结不低于台面）提前算好，帧内不再重复
    const bounds = heroBalloons.map((balloon) => ({
      xMin: balloon.rx + WALL_MARGIN - balloon.cx,
      xMax: VIEW_W - WALL_MARGIN - balloon.rx - balloon.cx,
      yMin: balloon.ry + CEILING_MARGIN - balloon.cy,
      yMax: FLOOR_Y - (balloon.cy + balloon.ry),
    }))
    // 指针只存屏幕坐标，SVG 坐标每帧换算一次：避免高频事件里反复 getScreenCTM 强制布局，
    // 也让页面滚动后坐标保持正确（rect 每帧新取）。
    let pointerClient: { x: number; y: number } | null = null
    let frame = 0
    let running = false
    let last = performance.now()
    // 闲置（无有效指针且动能低）时隔帧执行，只剩慢速气流晃动，30fps 视觉无差
    let idle = false
    let parity = false

    const step = (now: number) => {
      if (!running) return
      parity = !parity
      if (idle && parity) {
        frame = requestAnimationFrame(step)
        return
      }
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const t = now / 1000
      let maxSpeed = 0

      // 每帧一次：屏幕坐标 → viewBox 坐标（xMidYMax meet 的手算逆映射）
      let pointer: { x: number; y: number } | null = null
      if (pointerClient) {
        const rect = svg.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H)
          const px = (pointerClient.x - rect.left - (rect.width - VIEW_W * scale) / 2) / scale
          const py = (pointerClient.y - rect.top - (rect.height - VIEW_H * scale)) / scale
          // 指针已不在画框附近（如滚动把面板移走）则视为无指针，恢复闲置降频
          if (px > -40 && px < VIEW_W + 40 && py > -40 && py < VIEW_H + 40) {
            pointer = { x: px, y: py }
          }
        }
      }

      for (let i = 0; i < states.length; i += 1) {
        const state = states[i]
        const balloon = heroBalloons[i]
        // 回位弹簧 + 阻尼 + 气流（每只气球独立频率/相位的正弦风）
        let ax =
          Math.sin(t * balloon.airFreq + balloon.airPhase) * 78 - state.x * 16 - state.vx * 2.1
        let ay =
          Math.cos(t * balloon.airFreq * 0.8 + balloon.airPhase) * 34 -
          state.y * 20 -
          state.vy * 2.4

        if (pointer) {
          const bx = balloon.cx + state.x
          const by = balloon.cy + state.y
          const dx = bx - pointer.x
          const dy = by - pointer.y
          const dist = Math.hypot(dx, dy)
          const reach = Math.max(balloon.rx, balloon.ry) + 34
          if (dist < reach && dist > 0.01) {
            const push = ((reach - dist) / reach) * 560
            ax += (dx / dist) * push
            ay += (dy / dist) * push * 0.75
          }
        }

        state.vx += ax * dt
        state.vy += ay * dt
      }

      // 两两碰撞：软性排斥 + 位置分离，避免相互穿透
      for (let i = 0; i < states.length; i += 1) {
        for (let j = i + 1; j < states.length; j += 1) {
          const a = heroBalloons[i]
          const b = heroBalloons[j]
          const sa = states[i]
          const sb = states[j]
          const dx = b.cx + sb.x - (a.cx + sa.x)
          const dy = b.cy + sb.y - (a.cy + sa.y)
          const dist = Math.hypot(dx, dy) || 0.01
          const minDist = radii[i] + radii[j]
          if (dist < minDist) {
            const nx = dx / dist
            const ny = dy / dist
            const impulse = (minDist - dist) * 95 * dt
            sa.vx -= nx * impulse
            sa.vy -= ny * impulse
            sb.vx += nx * impulse
            sb.vy += ny * impulse
            const separation = (minDist - dist) * 0.18
            sa.x -= nx * separation
            sa.y -= ny * separation
            sb.x += nx * separation
            sb.y += ny * separation
          }
        }
      }

      for (let i = 0; i < states.length; i += 1) {
        const state = states[i]
        const balloon = heroBalloons[i]
        const bound = bounds[i]
        state.x += state.vx * dt
        state.y += state.vy * dt

        if (state.x < bound.xMin) {
          state.x = bound.xMin
          state.vx = Math.max(state.vx, 0)
        } else if (state.x > bound.xMax) {
          state.x = bound.xMax
          state.vx = Math.min(state.vx, 0)
        }
        if (state.y < bound.yMin) {
          state.y = bound.yMin
          state.vy = Math.max(state.vy, 0)
        } else if (state.y > bound.yMax) {
          state.y = bound.yMax
          state.vy = Math.min(state.vy, 0)
        }
        maxSpeed = Math.max(maxSpeed, Math.abs(state.vx), Math.abs(state.vy))

        const tilt = Math.max(-7, Math.min(7, state.vx * 0.055 + state.x * 0.07))
        bodyRefs.current[i]?.setAttribute(
          'transform',
          `translate(${state.x.toFixed(2)} ${state.y.toFixed(2)}) rotate(${tilt.toFixed(2)} ${balloon.cx} ${balloon.cy + balloon.ry + KNOT_DROP})`,
        )
        stringRefs.current[i]?.setAttribute('d', balloonStringPath(balloon, state.x, state.y))
      }

      idle = pointer === null && maxSpeed < 14
      frame = requestAnimationFrame(step)
    }

    const start = () => {
      if (running) return
      running = true
      last = performance.now()
      frame = requestAnimationFrame(step)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(frame)
    }

    const resetBalloons = () => {
      for (let i = 0; i < states.length; i += 1) {
        states[i].x = 0
        states[i].y = 0
        states[i].vx = 0
        states[i].vy = 0
        bodyRefs.current[i]?.removeAttribute('transform')
        stringRefs.current[i]?.setAttribute('d', balloonStringPath(heroBalloons[i]))
      }
    }

    // 模拟只在「面板可见 且 未开启减弱动效」时运行；两个条件都可在运行期变化
    const reduceMotionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null
    let reduceMotion = reduceMotionQuery?.matches ?? false
    let visible = !('IntersectionObserver' in window)

    const syncRunning = () => {
      if (visible && !reduceMotion) start()
      else stop()
    }

    let visibility: IntersectionObserver | null = null
    if ('IntersectionObserver' in window) {
      visibility = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting
        // 面板离屏时把扫描线 CSS 动画一并暂停，与物理模拟同一节能口径
        svg.closest('.home-hero-art')?.classList.toggle('home-art-offscreen', !visible)
        syncRunning()
      })
      visibility.observe(svg)
    }
    const handleReduceMotionChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches
      if (reduceMotion) resetBalloons()
      syncRunning()
    }
    reduceMotionQuery?.addEventListener('change', handleReduceMotionChange)
    syncRunning()

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      pointerClient = { x: event.clientX, y: event.clientY }
    }
    const handlePointerLeave = () => {
      pointerClient = null
    }
    svg.addEventListener('pointermove', handlePointerMove, { passive: true })
    svg.addEventListener('pointerleave', handlePointerLeave, { passive: true })

    return () => {
      stop()
      visibility?.disconnect()
      reduceMotionQuery?.removeEventListener('change', handleReduceMotionChange)
      svg.removeEventListener('pointermove', handlePointerMove)
      svg.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [])

  return (
    <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMax meet">
      {heroBalloons.map((balloon, index) => {
        const knotY = balloon.cy + balloon.ry + KNOT_DROP
        return (
          <g key={balloon.letter}>
            <path
              ref={(el) => {
                stringRefs.current[index] = el
              }}
              d={balloonStringPath(balloon)}
              stroke="rgb(246 243 233 / 45%)"
              strokeWidth="1.4"
              fill="none"
            />
            <g
              className="home-balloon"
              ref={(el) => {
                bodyRefs.current[index] = el
              }}
            >
              <ellipse
                cx={balloon.cx}
                cy={balloon.cy}
                rx={balloon.rx}
                ry={balloon.ry}
                fill={balloon.fill}
                stroke="rgb(246 243 233 / 25%)"
                strokeWidth="1.2"
              />
              <path
                d={`M${balloon.cx - 5} ${balloon.cy + balloon.ry - 3} L${balloon.cx} ${knotY} L${balloon.cx + 6} ${balloon.cy + balloon.ry - 3} Z`}
                fill={balloon.knot}
              />
              <ellipse
                cx={balloon.cx - balloon.rx * 0.34}
                cy={balloon.cy - balloon.ry * 0.32}
                rx={balloon.rx * 0.26}
                ry={balloon.ry * 0.3}
                transform={`rotate(-24 ${balloon.cx - balloon.rx * 0.34} ${balloon.cy - balloon.ry * 0.32})`}
                fill="#fff"
                opacity="0.34"
              />
              <circle
                cx={balloon.cx - balloon.rx * 0.08}
                cy={balloon.cy - balloon.ry * 0.58}
                r="3"
                fill="#fff"
                opacity="0.5"
              />
              <text
                x={balloon.cx}
                y={balloon.cy + 7}
                textAnchor="middle"
                fontFamily="Consolas,monospace"
                fontSize="19"
                fontWeight="700"
                fill={balloon.ink}
              >
                {balloon.letter}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
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

      <div className="home-letter-strip" aria-hidden="true">
        <span className="home-letter-strip-inner">
          <VerdictStripSegment />
          <VerdictStripSegment />
        </span>
      </div>

      <section className="home-section acm-introduction" id="about-acm">
        <div className="home-section-heading">
          <p className="home-section-index">01 / 关于竞赛</p>
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
        </div>
      </section>

      <section
        className="home-section home-competition-section"
        aria-labelledby="competition-overview-title"
      >
        <div className="home-section-heading">
          <p className="home-section-index">02 / 赛事版图</p>
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
                右侧所列赛事均属于我校认定的 <strong>Ⅰ乙比赛</strong>。ICPC、CCPC 与 JSCPC
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
            <div className="home-open-contests-stat">
              <strong>10+</strong>
              <span>场公开赛 / 每周</span>
              <small>免费开放，持续更新</small>
            </div>
            <div
              className="home-open-contests-platforms"
              role="list"
              aria-label="主要线上公开赛平台"
            >
              {openContestPlatforms.map((platform, index) => (
                <div key={platform} role="listitem">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <PlatformMark platform={platform} />
                  <small>公开赛与练习</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="home-section home-vision-section" aria-labelledby="home-vision-title">
        <div className="home-section-heading">
          <p className="home-section-index">04 / 学习资源</p>
          <h2 id="home-vision-title">开放资源，帮新手走稳第一步</h2>
        </div>
        <div className="home-vision-body">
          <p>
            算法竞赛拥有丰富的在线训练资源，绝大多数免费向学习者开放。本网站将筛选其中适合入门的一部分，按知识点和训练阶段提供引导，减少资料筛选成本，帮助新手快速上手。
          </p>
          <div className="home-vision-list" role="list" aria-label="学习功能">
            <article role="listitem">
              <BookOpenCheck size={21} aria-hidden="true" />
              <div>
                <h3>学习引导</h3>
                <p>按知识点组织学习路线、资料与阶段目标。</p>
              </div>
              <Link to="/learning">
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
              <Link to="/daily-problem">
                已上线<span className="sr-only">：每日一题</span>
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </article>
            <article role="listitem">
              <MessagesSquare size={21} aria-hidden="true" />
              <div>
                <h3>AI 学习助手</h3>
                <p>
                  {webChatUiEnabled
                    ? '在站内完成知识问答、代码讲解和训练复盘。'
                    : '计划接入大模型，在站内完成知识问答、代码讲解和训练复盘。'}
                </p>
              </div>
              {webChatUiEnabled ? (
                <Link to="/assistant">
                  {user ? '已上线' : '成员登录后可用'}
                  <span className="sr-only">：AI 学习助手</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              ) : (
                <span>规划中</span>
              )}
            </article>
          </div>
        </div>
      </section>

      <section className="home-section home-platform-section" aria-labelledby="platform-title">
        <div className="home-section-heading">
          <p className="home-section-index">05 / 训练记录</p>
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
            <span>
              <strong>
                {loading ? (
                  <>
                    <span aria-hidden="true">--</span>
                    <span className="sr-only">加载中</span>
                  </>
                ) : (
                  formatInteger(totalSolvedCount)
                )}
              </strong>
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
          <h2 id="join-title">在比赛中找到下一段训练</h2>
        </div>
        <div className="home-join-body">
          <div className="home-join-intro">
            <p className="home-join-lead">
              集训队每年通过三场面向不同人群的比赛选拔成员。无需提前加入，先来参加比赛，在真实题目和有限时间里展示自己的思路与潜力。
            </p>
            <aside className="home-join-group" aria-label="苏科大 ACM 集训队 QQ 群">
              <MessagesSquare size={22} aria-hidden="true" />
              <div>
                <span>校内交流入口</span>
                <strong>QQ 群 721375856</strong>
                <p>在 QQ 中搜索群号加入，获取训练安排与校内赛通知，也可以交流入门问题。</p>
              </div>
            </aside>
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
