import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
import Award from 'lucide-react/dist/esm/icons/award'
import Code2 from 'lucide-react/dist/esm/icons/code-2'
import FlagTriangleRight from 'lucide-react/dist/esm/icons/flag-triangle-right'
import Laptop from 'lucide-react/dist/esm/icons/laptop'
import ListOrdered from 'lucide-react/dist/esm/icons/list-ordered'
import Monitor from 'lucide-react/dist/esm/icons/monitor'
import MoveHorizontal from 'lucide-react/dist/esm/icons/move-horizontal'
import Snowflake from 'lucide-react/dist/esm/icons/snowflake'
import Timer from 'lucide-react/dist/esm/icons/timer'
import Trophy from 'lucide-react/dist/esm/icons/trophy'
import UserRound from 'lucide-react/dist/esm/icons/user-round'
import UsersRound from 'lucide-react/dist/esm/icons/users-round'
import Wifi from 'lucide-react/dist/esm/icons/wifi'
import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { VerdictTicker } from '../components/VerdictTicker'
import './freshman-contest.css'
import {
  practiceTimeline,
  schoolTimeline,
  type ContestKind,
} from './freshman-contest/freshmanContestData'
import { PracticeHero, SchoolHero } from './freshman-contest/ContestHeroes'
import { SchoolRollboard } from './freshman-contest/SchoolRollboard'

interface TimelineItem {
  time: string
  title: string
  detail: string
}

interface ContestTimelineProps {
  items: TimelineItem[]
  lead: string
  freezeTitle: string
  freezeDetail: string
  noteLabel?: string
  noteIcon?: 'freeze' | 'ladder'
  title?: string
  children?: ReactNode
}

function ContestTimeline({
  items,
  lead,
  freezeTitle,
  freezeDetail,
  noteLabel = '最后一小时封榜',
  noteIcon = 'freeze',
  title = '从开场到最终榜',
  children,
}: ContestTimelineProps) {
  const NoteIcon = noteIcon === 'ladder' ? ListOrdered : Snowflake

  return (
    <section
      id="contest-timeline"
      className="freshman-contest-section freshman-contest-timeline"
      aria-labelledby="contest-timeline-title"
    >
      <header className="freshman-contest-section-heading">
        <p>03 / TIMELINE</p>
        <div>
          <h2 id="contest-timeline-title">{title}</h2>
          <p>{lead}</p>
        </div>
      </header>

      <ol className="freshman-contest-timeline-list">
        {items.map((item, index) => (
          <li key={item.time}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <time>{item.time}</time>
            <div>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="freshman-contest-freeze-note">
        <NoteIcon size={28} aria-hidden="true" />
        <div>
          <p>{noteLabel}</p>
          <h3>{freezeTitle}</h3>
        </div>
        <p>{freezeDetail}</p>
      </div>

      {children}
    </section>
  )
}

interface ContestClosingProps {
  kicker: string
  title: string
  detail: string
  action: string
}

function ContestClosing({ kicker, title, detail, action }: ContestClosingProps) {
  return (
    <section className="freshman-contest-closing" aria-labelledby="contest-closing-title">
      <Trophy size={34} aria-hidden="true" />
      <div>
        <p>{kicker}</p>
        <h2 id="contest-closing-title">{title}</h2>
        <span>{detail}</span>
      </div>
      <Link to="/learning">
        {action}
        <ArrowRight size={17} aria-hidden="true" />
      </Link>
    </section>
  )
}

function PracticeContestDetails() {
  return (
    <>
      <section
        id="contest-format"
        className="freshman-contest-section freshman-contest-format practice-contest-format"
        aria-labelledby="contest-format-title"
      >
        <header className="freshman-contest-section-heading">
          <p>01 / FORMAT</p>
          <div>
            <h2 id="contest-format-title">先独立完成比赛，再用成绩进入队伍</h2>
            <p>
              练习赛不预先组队，每位选手独立使用一台电脑完成同一套题。比赛模拟天梯赛的三级结构和测试点计分，赛后再依据个人表现编排正式参赛队伍。
            </p>
          </div>
        </header>

        <div className="practice-contest-ladder" aria-label="天梯赛三级赛题结构">
          <article>
            <span>L1</span>
            <div>
              <p>基础级</p>
              <strong>8 题 / 100 分</strong>
            </div>
            <small>覆盖语法、数据处理与基础算法，是全队稳定得分的底座。</small>
          </article>
          <article>
            <span>L2</span>
            <div>
              <p>进阶级</p>
              <strong>4 题 / 100 分</strong>
            </div>
            <small>每题 25 分，进一步考查算法选择、复杂度与完整实现。</small>
          </article>
          <article>
            <span>L3</span>
            <div>
              <p>登顶级</p>
              <strong>3 题 / 90 分</strong>
            </div>
            <small>每题 30 分，留给已建立稳定基础、准备冲击高难题的选手。</small>
          </article>
        </div>

        <div className="practice-contest-selection-band">
          <UserRound size={25} aria-hidden="true" />
          <div>
            <span>QUALIFIER</span>
            <strong>个人独立完成练习赛</strong>
          </div>
          <ArrowRight size={24} aria-hidden="true" />
          <div>
            <span>FORMATION</span>
            <strong>依据成绩编排天梯赛队伍</strong>
          </div>
          <UsersRound size={27} aria-hidden="true" />
        </div>
      </section>

      <section
        id="contest-scoring"
        className="freshman-contest-section freshman-contest-scoring"
        aria-labelledby="contest-scoring-title"
      >
        <header className="freshman-contest-section-heading">
          <p>02 / SCORE</p>
          <div>
            <h2 id="contest-scoring-title">每个测试点，都能留下有效得分</h2>
            <p>
              天梯赛不是只有通过整题才计分。程序通过多少测试点，就获得对应分数；可以反复提交并保留该题最高分，错误提交不扣分。
            </p>
          </div>
        </header>

        <div className="freshman-contest-ranking-grid practice-contest-scoring-grid">
          <article>
            <div className="freshman-contest-rule-icon">
              <Code2 size={25} aria-hidden="true" />
            </div>
            <p>测试点计分</p>
            <h3>先拿得到的分，再继续完善</h3>
            <span>每题得分为通过测试点的分数之和，不必等到整题完全正确才产生有效成绩。</span>
          </article>
          <article>
            <div className="freshman-contest-rule-icon">
              <ListOrdered size={25} aria-hidden="true" />
            </div>
            <p>反复提交</p>
            <h3>保留单题历史最高分</h3>
            <span>
              错误提交不增加罚时，也不扣除已有分数；根据反馈修正程序，逐步争取更多测试点。
            </span>
          </article>
          <div className="freshman-contest-tiebreak">
            <p>个人同分排序参考</p>
            <ol>
              <li>
                <span>01</span>
                <strong>更高梯级得分</strong>
              </li>
              <li>
                <span>02</span>
                <strong>高梯级完整解题数</strong>
              </li>
              <li>
                <span>03</span>
                <strong>最后提交更早</strong>
              </li>
            </ol>
            <small>
              练习赛将参考正式天梯赛的有效分与同分排序逻辑；校内选拔名额、入选分数线和最终排序办法以赛前通知为准。
            </small>
          </div>
        </div>
      </section>

      <ContestTimeline
        items={practiceTimeline}
        lead="赛程模拟正式天梯赛的三小时节奏；比赛日期、签到与现场安排以校内赛前通知为准。"
        freezeTitle="不与一次错误提交较劲，让总分持续向上。"
        freezeDetail="阶段目标不是硬性截止：前 30–60 分钟完成会写的 L1，第 2 小时解决会写的 L2，剩余时间逐题检查未通过的测试点，争取更多部分分。"
        noteLabel="模拟重点"
        noteIcon="ladder"
        title="三小时，分阶段向上攀登"
      />

      <section
        id="contest-ready"
        className="freshman-contest-section freshman-contest-ready"
        aria-labelledby="contest-ready-title"
      >
        <header className="freshman-contest-section-heading">
          <p>04 / READY</p>
          <div>
            <h2 id="contest-ready-title">先证明个人稳定性，再进入队伍编排</h2>
            <p>选拔关注的不只是最高分，也关注基础题完成度、三小时节奏和独立解决问题的稳定性。</p>
          </div>
        </header>

        <div className="freshman-contest-ready-grid">
          <div>
            <UserRound size={24} aria-hidden="true" />
            <strong>独立作答</strong>
            <p>每位选手使用独立设备完成比赛，不与他人讨论。</p>
          </div>
          <div>
            <Code2 size={24} aria-hidden="true" />
            <strong>理解部分分</strong>
            <p>根据测试点反馈修正边界，让不完整方案也产生有效进展。</p>
          </div>
          <div>
            <Timer size={24} aria-hidden="true" />
            <strong>三小时节奏</strong>
            <p>先稳定基础级，再根据剩余时间选择进阶或登顶题目。</p>
          </div>
          <div>
            <Laptop size={24} aria-hidden="true" />
            <strong>熟悉环境</strong>
            <p>提前确认语言、编辑器与评测方式，具体设备要求以通知为准。</p>
          </div>
        </div>

        <div className="freshman-contest-awards school-contest-selection practice-contest-selection">
          <div className="freshman-contest-awards-heading">
            <Award size={30} aria-hidden="true" />
            <div>
              <p>SELECTION</p>
              <h3>代表学校参加团体程序设计天梯赛</h3>
            </div>
          </div>
          <p>
            练习赛用于选拔参加“中国高校计算机大赛——团体程序设计天梯赛”的选手。比赛结束后，集训队将结合总分、各梯级得分与稳定性编排正式参赛队伍；入选人数和递补规则以当年校内通知为准。
          </p>
        </div>
      </section>

      <ContestClosing
        kicker="EARN YOUR PLACE"
        title="先独立完成一场比赛，再用成绩进入合适的队伍。"
        detail="赛后结合总分、梯级分布与稳定性编排天梯赛正式队伍。"
        action="开始个人训练"
      />
    </>
  )
}

function SchoolContestDetails() {
  return (
    <>
      <section
        id="contest-format"
        className="freshman-contest-section freshman-contest-format school-contest-format"
        aria-labelledby="contest-format-title"
      >
        <header className="freshman-contest-section-heading">
          <p>01 / FORMAT</p>
          <div>
            <h2 id="contest-format-title">一人一台电脑，独立完成每一次判断</h2>
            <p>
              每位选手独立使用一台电脑，在三小时内解决尽可能多的题。读题、推导、编码与调试均由本人完成，根据赛况调整解题顺序。
            </p>
          </div>
        </header>

        <div className="school-contest-team-console" aria-label="ACM 单人赛解题流程">
          <article>
            <UserRound size={25} aria-hidden="true" />
            <span>01 / READ</span>
            <h3>独立读题</h3>
            <p>浏览全部题目，识别可做题、风险题和需要继续推导的题，建立自己的解题顺序。</p>
          </article>
          <div className="school-contest-computer">
            <Monitor size={38} aria-hidden="true" />
            <strong>ONE COMPUTER</strong>
            <span>独立编码、调试与提交</span>
          </div>
          <article>
            <Code2 size={25} aria-hidden="true" />
            <span>02 / SOLVE</span>
            <h3>实现与验证</h3>
            <p>将思路写成程序，构造样例、检查边界并独立调试，确认解法正确后再提交。</p>
          </article>
          <article>
            <FlagTriangleRight size={25} aria-hidden="true" />
            <span>03 / DECIDE</span>
            <h3>动态决策</h3>
            <p>根据通过题数、罚时和剩余时间及时换题，避免在一道题上耗尽比赛时间。</p>
          </article>
        </div>
      </section>

      <section
        id="contest-scoring"
        className="freshman-contest-section freshman-contest-scoring"
        aria-labelledby="contest-scoring-title"
      >
        <header className="freshman-contest-section-heading">
          <p>02 / SCORE</p>
          <div>
            <h2 id="contest-scoring-title">先看通过题数，再看总罚时</h2>
            <p>
              传统 ACM 只记录通过与否。没有部分分，每一次错误提交都可能成为最终排名里的二十分钟。
            </p>
          </div>
        </header>

        <div className="school-contest-ranking-rule">
          <article>
            <span>FIRST</span>
            <strong>AC 题数更多</strong>
            <p>通过题数决定排名的第一顺位。每道题只有通过全部测试点后才计入。</p>
          </article>
          <div className="school-contest-ranking-arrow" aria-hidden="true">
            <ArrowRight size={28} />
          </div>
          <article>
            <span>THEN</span>
            <strong>总罚时更少</strong>
            <p>通过题数相同时，总罚时更少的选手排名更高。</p>
          </article>
        </div>

        <div className="school-contest-penalty" aria-label="传统 ACM 罚时公式">
          <div>
            <Timer size={28} aria-hidden="true" />
            <span>PENALTY</span>
          </div>
          <strong>总罚时 = 各题首次通过时刻之和 + 通过前错误提交数 × 20 分钟</strong>
          <p>最终未通过的题目不计罚时；编译错误是否计入错误提交，以比赛平台的现场规则为准。</p>
        </div>
      </section>

      <ContestTimeline
        items={schoolTimeline}
        lead="校赛采用三小时 ACM 单人赛制，具体开赛时间、题量和现场安排以赛前通知为准。"
        freezeTitle="看不见结果，也要继续做出自己的判断。"
        freezeDetail="封榜后仍可正常提交并查看本人的评测结果，但其他选手的新结果不会公开。比赛结束后通过滚榜逐步揭晓封榜期间的提交，最终确定名次。"
      >
        <SchoolRollboard />
      </ContestTimeline>

      <section
        id="contest-ready"
        className="freshman-contest-section freshman-contest-ready"
        aria-labelledby="contest-ready-title"
      >
        <header className="freshman-contest-section-heading">
          <p>04 / READY</p>
          <div>
            <h2 id="contest-ready-title">做好个人准备，再进入赛场</h2>
            <p>熟悉开发环境、独立调试与限时训练，让每一次读题和提交都更有把握。</p>
          </div>
        </header>

        <div className="freshman-contest-ready-grid">
          <div>
            <UserRound size={24} aria-hidden="true" />
            <strong>个人报名</strong>
            <p>核对个人参赛信息，并按通知独立完成报名。</p>
          </div>
          <div>
            <Laptop size={24} aria-hidden="true" />
            <strong>独立设备</strong>
            <p>每位选手使用一台电脑，提前熟悉指定开发环境。</p>
          </div>
          <div>
            <Wifi size={24} aria-hidden="true" />
            <strong>现场网络</strong>
            <p>连接比赛指定网络，按现场要求使用评测系统。</p>
          </div>
          <div>
            <Code2 size={24} aria-hidden="true" />
            <strong>限时训练</strong>
            <p>练习独立读题、代码复核、样例构造与时间分配。</p>
          </div>
        </div>

        <div className="freshman-contest-awards school-contest-selection">
          <div className="freshman-contest-awards-heading">
            <Award size={30} aria-hidden="true" />
            <div>
              <p>SELECTION</p>
              <h3>从校赛走向 JSCPC</h3>
            </div>
          </div>
          <p>
            校赛面向全校，以个人成绩选拔集训队成员与后续华为杯江苏省大学生程序设计大赛（JSCPC）参赛选手。后续组队、具体奖项、名额与选拔办法以通知为准。
          </p>
        </div>
      </section>

      <ContestClosing
        kicker="START YOUR PRACTICE"
        title="从独立解出一道题，到完成一场比赛。"
        detail="从公开赛和日常训练开始，建立自己的读题、编码与复盘节奏。"
        action="开始个人训练"
      />
    </>
  )
}

export function FreshmanContestPage() {
  const [activeContest, setActiveContest] = useState<ContestKind>('school')
  const pointerStartX = useRef<number | null>(null)
  const practiceActive = activeContest === 'practice'
  const schoolActive = activeContest === 'school'

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointerStartX.current = event.clientX
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (pointerStartX.current === null) return
    const distance = event.clientX - pointerStartX.current
    pointerStartX.current = null
    if (Math.abs(distance) < 48) return
    setActiveContest((current) => moveContest(current, distance < 0 ? 1 : -1))
  }

  const mobileSwipeHint = schoolActive ? '左划查看练习赛' : '右划返回校赛'

  return (
    <div className={`freshman-contest-page is-${activeContest}`}>
      <section
        className="freshman-contest-hero"
        aria-label="校内赛事"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          pointerStartX.current = null
        }}
      >
        <div className="campus-contest-hero-corner" aria-hidden="true">
          <span>USTS ACM / CAMPUS CONTESTS</span>
          <span>NOV · MAR / 02 EVENTS</span>
        </div>
        <p className="campus-contest-mobile-swipe-hint">
          <MoveHorizontal size={15} aria-hidden="true" />
          {mobileSwipeHint}
        </p>
        <div
          className="campus-contest-hero-track"
          style={{ transform: contestActiveTransform(activeContest) }}
        >
          <SchoolHero active={schoolActive} />
          <PracticeHero active={practiceActive} />
        </div>

        <div className="campus-contest-picker-wrap">
          <div className="campus-contest-picker" role="tablist" aria-label="选择校内赛事">
            <button
              id="contest-picker-school"
              type="button"
              role="tab"
              aria-controls="contest-slide-school"
              aria-selected={schoolActive}
              onClick={() => setActiveContest('school')}
            >
              <span>01</span>
              <strong>校赛</strong>
              <small>11月 · 单人赛 · ACM</small>
            </button>
            <button
              id="contest-picker-practice"
              type="button"
              role="tab"
              aria-controls="contest-slide-practice"
              aria-selected={practiceActive}
              onClick={() => setActiveContest('practice')}
            >
              <span>02</span>
              <strong>练习赛</strong>
              <small>3月 · 个人 · 天梯模拟</small>
            </button>
          </div>
          <p className="campus-contest-swipe-hint">
            <MoveHorizontal size={16} aria-hidden="true" />
            横向滑动切换赛事
          </p>
        </div>
      </section>

      <VerdictTicker />

      <nav className="freshman-contest-jump-nav" aria-label="校内赛事页面导航">
        <a href="#contest-format">{practiceActive ? '三级赛制' : '传统赛制'}</a>
        <a href="#contest-scoring">计分排名</a>
        <a href="#contest-timeline">比赛进程</a>
        <a href="#contest-ready">{practiceActive ? '选拔准备' : '参赛准备'}</a>
      </nav>

      <div className="campus-contest-content" aria-live="polite">
        {practiceActive ? <PracticeContestDetails /> : <SchoolContestDetails />}
      </div>
    </div>
  )
}

const contestOrder: ContestKind[] = ['school', 'practice']

function moveContest(activeContest: ContestKind, direction: -1 | 1): ContestKind {
  const currentIndex = contestOrder.indexOf(activeContest)
  const nextIndex = Math.max(0, Math.min(contestOrder.length - 1, currentIndex + direction))
  return contestOrder[nextIndex]
}

function contestActiveTransform(activeContest: ContestKind) {
  return `translateX(-${contestOrder.indexOf(activeContest) * 100}%)`
}
