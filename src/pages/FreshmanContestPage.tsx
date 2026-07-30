import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
import Award from 'lucide-react/dist/esm/icons/award'
import Code2 from 'lucide-react/dist/esm/icons/code-2'
import FilePenLine from 'lucide-react/dist/esm/icons/file-pen-line'
import FlagTriangleRight from 'lucide-react/dist/esm/icons/flag-triangle-right'
import Handshake from 'lucide-react/dist/esm/icons/handshake'
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
import { useRef, useState, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import './freshman-contest.css'

type ContestKind = 'freshman' | 'school'
type DifficultyLevel = 'l1' | 'l2' | 'l3'

interface DifficultyDefinition {
  id: DifficultyLevel
  label: string
  title: string
  count: number
  summary: string
  scoring: string
  note: string
}

const difficulties: DifficultyDefinition[] = [
  {
    id: 'l1',
    label: 'L1',
    title: '语法题',
    count: 3,
    summary: '考查输入输出、分支、循环与基础代码实现，帮助第一次参赛的同学进入状态。',
    scoring: '在 OJ 提交代码并通过全部测试点（AC），即可获得该题全部分数。',
    note: '不设置部分分，最终得分只取赛时所有提交记录中的最高分。',
  },
  {
    id: 'l2',
    label: 'L2',
    title: '基础算法题',
    count: 2,
    summary: '从直接写代码向基础算法过渡，关注建模、复杂度和实现的完整性。',
    scoring: '在 OJ 提交代码并通过全部测试点（AC），即可获得该题全部分数。',
    note: '不设置部分分，未通过全部测试点时该题不计分。',
  },
  {
    id: 'l3',
    label: 'L3',
    title: '思维题',
    count: 5,
    summary:
      '强调观察、推理与结论表达。代码是验证思路的工具，答题卡让未完成代码的思考也有被看见的机会。',
    scoring:
      'OJ 通过可直接获得满分；未通过时，可在纸质答题卡写下结论与推导过程，由裁判赛后人工阅卷。',
    note: '若 OJ 已通过，裁判不再批阅该题答题卡。',
  },
]

const freshmanTimeline = [
  { time: '00:00', title: '比赛开始', detail: '先浏览全部题目，再选择适合自己的起点。' },
  { time: '01:00', title: '榜单封停', detail: '外部榜单不再显示其他选手的新结果。' },
  { time: '02:00', title: '比赛结束', detail: '停止提交，L3 答题卡进入人工阅卷。' },
  { time: '+1–3 天', title: '公布总榜', detail: '合并 OJ 与答题卡得分，发布最终成绩。' },
]

const schoolTimeline = [
  { time: '00:00', title: '比赛开始', detail: '三名队员共同读题，快速建立题目优先级。' },
  { time: '04:00', title: '榜单封停', detail: '最后一小时不再公开其他队伍的新结果。' },
  { time: '05:00', title: '比赛结束', detail: '停止提交，裁判确认所有有效评测结果。' },
  { time: '赛后', title: '滚榜揭晓', detail: '从封榜前名次开始逐队揭晓，形成最终排名。' },
]

const contestLogoUrl = `${import.meta.env.BASE_URL}ustsacm.png`

interface ContestHeroProps {
  active: boolean
}

function FreshmanHero({ active }: ContestHeroProps) {
  const Heading = active ? 'h1' : 'h2'

  return (
    <article
      id="contest-slide-freshman"
      className={`campus-contest-slide campus-contest-slide--freshman${active ? ' is-active' : ''}`}
      role="tabpanel"
      aria-labelledby="contest-picker-freshman"
      aria-hidden={!active}
    >
      <div className="freshman-contest-hero-inner">
        <div className="freshman-contest-hero-copy">
          <div className="freshman-contest-kicker">
            <span>USTS ACM / DECEMBER</span>
            <span>面向全体新生</span>
          </div>
          <p className="freshman-contest-edition">苏州科技大学 ACM 集训队选拔赛</p>
          <Heading id="freshman-contest-title">新生赛</Heading>
          <p className="freshman-contest-intro">
            两小时，十道题，一次独立作答。这里不要求你已经掌握所有算法，只希望看见你面对陌生问题时的观察、推理与创造力。
          </p>
          <div className="freshman-contest-hero-actions">
            <a
              className="freshman-contest-primary-action"
              href="#contest-format"
              tabIndex={active ? undefined : -1}
            >
              查看赛制
              <ArrowRight size={17} aria-hidden="true" />
            </a>
            <Link
              className="freshman-contest-secondary-action"
              to="/learning"
              tabIndex={active ? undefined : -1}
            >
              从第一题开始准备
            </Link>
          </div>
        </div>

        <div className="freshman-contest-scoreboard" aria-label="新生赛赛制概览">
          <div className="freshman-contest-scoreboard-head">
            <img src={contestLogoUrl} alt="USTS ACM" />
            <span>CONTEST CLOCK</span>
          </div>
          <strong className="freshman-contest-clock">02:00:00</strong>
          <div className="freshman-contest-scoreboard-meta">
            <span>单人赛</span>
            <span>创新积分制</span>
            <span>C/C++ · Python</span>
          </div>
          <div className="freshman-contest-problem-strip" aria-label="十道题难度分布">
            <div>
              <span>L1</span>
              <strong>03</strong>
              <small>语法题</small>
            </div>
            <div>
              <span>L2</span>
              <strong>02</strong>
              <small>基础算法</small>
            </div>
            <div>
              <span>L3</span>
              <strong>05</strong>
              <small>思维题</small>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

function SchoolHero({ active }: ContestHeroProps) {
  const Heading = active ? 'h1' : 'h2'

  return (
    <article
      id="contest-slide-school"
      className={`campus-contest-slide campus-contest-slide--school${active ? ' is-active' : ''}`}
      role="tabpanel"
      aria-labelledby="contest-picker-school"
      aria-hidden={!active}
    >
      <div className="freshman-contest-hero-inner">
        <div className="freshman-contest-hero-copy">
          <div className="freshman-contest-kicker">
            <span>USTS ACM / APRIL</span>
            <span>面向全校学生</span>
          </div>
          <p className="freshman-contest-edition">苏州科技大学程序设计校赛</p>
          <Heading id="school-contest-title">校赛</Heading>
          <p className="freshman-contest-intro">
            三人一队，一台电脑，五小时协作攻坚。校赛采用传统 ACM
            赛制，考验的不只是算法，也包括分工、沟通与赛场决策。
          </p>
          <div className="freshman-contest-hero-actions">
            <a
              className="freshman-contest-primary-action"
              href="#contest-format"
              tabIndex={active ? undefined : -1}
            >
              查看传统 ACM 赛制
              <ArrowRight size={17} aria-hidden="true" />
            </a>
            <Link
              className="freshman-contest-secondary-action"
              to="/learning"
              tabIndex={active ? undefined : -1}
            >
              开始组队训练
            </Link>
          </div>
        </div>

        <div
          className="freshman-contest-scoreboard campus-contest-school-scoreboard"
          aria-label="校赛赛制概览"
        >
          <div className="freshman-contest-scoreboard-head">
            <img src={contestLogoUrl} alt="USTS ACM" />
            <span>ACM TEAM CONTEST</span>
          </div>
          <strong className="freshman-contest-clock">05:00:00</strong>
          <div className="freshman-contest-scoreboard-meta">
            <span>三人一队</span>
            <span>一台电脑</span>
            <span>传统 ACM 赛制</span>
          </div>
          <div
            className="freshman-contest-problem-strip campus-contest-acm-strip"
            aria-label="传统 ACM 排名要素"
          >
            <div>
              <span>FIRST</span>
              <strong>AC</strong>
              <small>通过题数</small>
            </div>
            <div>
              <span>THEN</span>
              <strong>TIME</strong>
              <small>总罚时</small>
            </div>
            <div>
              <span>WRONG</span>
              <strong>+20</strong>
              <small>分钟罚时</small>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

function FreshmanContestDetails() {
  const [activeLevel, setActiveLevel] = useState<DifficultyLevel>('l1')
  const selectedLevel = difficulties.find((level) => level.id === activeLevel) ?? difficulties[0]

  return (
    <>
      <section
        id="contest-format"
        className="freshman-contest-section freshman-contest-format"
        aria-labelledby="contest-format-title"
      >
        <header className="freshman-contest-section-heading">
          <p>01 / FORMAT</p>
          <div>
            <h2 id="contest-format-title">同一张试卷，三种思考层次</h2>
            <p>每道题满分权重不同。难度逐步上升，但你可以按自己的节奏自由选择作答顺序。</p>
          </div>
        </header>

        <div className="freshman-contest-level-layout">
          <div className="freshman-contest-level-tabs" role="tablist" aria-label="赛题难度">
            {difficulties.map((level) => (
              <button
                key={level.id}
                id={`contest-tab-${level.id}`}
                type="button"
                role="tab"
                aria-controls={`contest-panel-${level.id}`}
                aria-selected={activeLevel === level.id}
                onClick={() => setActiveLevel(level.id)}
              >
                <span>{level.label}</span>
                <strong>{level.title}</strong>
                <small>{String(level.count).padStart(2, '0')} 题</small>
              </button>
            ))}
          </div>

          <div
            id={`contest-panel-${selectedLevel.id}`}
            className="freshman-contest-level-panel"
            role="tabpanel"
            aria-labelledby={`contest-tab-${selectedLevel.id}`}
          >
            <div className="freshman-contest-level-number" aria-hidden="true">
              {selectedLevel.label}
            </div>
            <div className="freshman-contest-level-copy">
              <p className="freshman-contest-level-count">{selectedLevel.count} 道题</p>
              <h3>{selectedLevel.title}</h3>
              <p>{selectedLevel.summary}</p>
              <div className="freshman-contest-level-rule">
                <Code2 size={21} aria-hidden="true" />
                <div>
                  <strong>如何得分</strong>
                  <p>{selectedLevel.scoring}</p>
                </div>
              </div>
              <small>{selectedLevel.note}</small>
            </div>
          </div>
        </div>

        {selectedLevel.id === 'l3' ? (
          <div className="freshman-contest-formula" aria-label="L3 答题卡计分公式">
            <div>
              <span>结论正确</span>
              <strong>题目满分 × 结论百分比</strong>
            </div>
            <div>
              <span>结论错误</span>
              <strong>题目满分 × 结论百分比 × 过程百分比</strong>
              <small>过程分由裁判根据推导正确性在 0%–60% 范围内评定。</small>
            </div>
          </div>
        ) : null}
      </section>

      <section
        id="contest-scoring"
        className="freshman-contest-section freshman-contest-scoring"
        aria-labelledby="contest-scoring-title"
      >
        <header className="freshman-contest-section-heading">
          <p>02 / SCORE</p>
          <div>
            <h2 id="contest-scoring-title">赛时看代码，赛后看完整思考</h2>
            <p>实时榜与最终榜承担不同作用：一个反映现场提交，一个还原包括答题卡在内的最终成绩。</p>
          </div>
        </header>

        <div className="freshman-contest-ranking-grid">
          <article>
            <div className="freshman-contest-rule-icon">
              <ListOrdered size={25} aria-hidden="true" />
            </div>
            <p>赛时排名</p>
            <h3>仅展示 OJ 代码得分</h3>
            <span>提交后实时返回每个测试点的运行结果；只有通过全部测试点时获得该题分数。</span>
          </article>
          <article>
            <div className="freshman-contest-rule-icon">
              <FilePenLine size={25} aria-hidden="true" />
            </div>
            <p>最终排名</p>
            <h3>OJ 得分 + 答题卡得分</h3>
            <span>人工阅卷完成后统一公布，预计在赛后 1–3 天发布最终成绩和总榜。</span>
          </article>
          <div className="freshman-contest-tiebreak">
            <p>同分排序优先级</p>
            <ol>
              <li>
                <span>01</span>
                <strong>总分更高</strong>
              </li>
              <li>
                <span>02</span>
                <strong>AC 题数更多</strong>
              </li>
              <li>
                <span>03</span>
                <strong>总罚时更少</strong>
              </li>
            </ol>
            <small>
              罚时从开赛计算至该题通过，加上通过前每次未通过提交 × 20
              分钟；未通过或仅获得答题卡分数的题目不计罚时。
            </small>
          </div>
        </div>
      </section>

      <ContestTimeline
        items={freshmanTimeline}
        lead="若出现服务器波动等不可预见情况，裁判组可能微调比赛时长，并以现场通知为准。"
        freezeTitle="别被榜单左右，继续完成自己的比赛。"
        freezeDetail="封榜后，榜单不再显示其他选手的新提交结果，只显示其存在提交行为；你仍能正常收到自己的评测结果。赛后 OJ 代码提交按传统滚榜揭晓，完整总榜待人工阅卷后发布。"
      />

      <section
        id="contest-ready"
        className="freshman-contest-section freshman-contest-ready"
        aria-labelledby="contest-ready-title"
      >
        <header className="freshman-contest-section-heading">
          <p>04 / READY</p>
          <div>
            <h2 id="contest-ready-title">带上电脑，也带上自己的判断</h2>
            <p>比赛是独立完成的，但准备可以从今天开始。先熟悉环境，再从一道题建立节奏。</p>
          </div>
        </header>

        <div className="freshman-contest-ready-grid">
          <div>
            <Code2 size={24} aria-hidden="true" />
            <strong>编程语言</strong>
            <p>支持 C/C++、Python 等语言。</p>
          </div>
          <div>
            <Laptop size={24} aria-hidden="true" />
            <strong>自带设备</strong>
            <p>携带一台电脑与充电器入场。</p>
          </div>
          <div>
            <Wifi size={24} aria-hidden="true" />
            <strong>网络要求</strong>
            <p>连接比赛指定局域网，禁止连接手机热点。</p>
          </div>
          <div>
            <UserRound size={24} aria-hidden="true" />
            <strong>单人参赛</strong>
            <p>独立读题、思考、编码与作答。</p>
          </div>
        </div>

        <div className="freshman-contest-awards">
          <div className="freshman-contest-awards-heading">
            <Award size={30} aria-hidden="true" />
            <div>
              <p>AWARDS</p>
              <h3>让优秀的第一次被看见</h3>
            </div>
          </div>
          <div className="freshman-contest-medals" aria-label="奖项设置">
            <span>金奖 1 名</span>
            <span>银奖 2 名</span>
            <span>铜奖 3 名</span>
          </div>
          <p>名额为当前方案，具体奖项与入选安排以赛前最终通知为准。</p>
        </div>
      </section>

      <ContestClosing
        kicker="JOIN THE TEAM"
        title="新生赛不是终点，是第一次进入训练场。"
        detail="表现优异的选手可以加入集训队，继续学习、训练并参加更多比赛。"
        action="查看新手入门"
      />
    </>
  )
}

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
}

function ContestTimeline({ items, lead, freezeTitle, freezeDetail }: ContestTimelineProps) {
  return (
    <section
      id="contest-timeline"
      className="freshman-contest-section freshman-contest-timeline"
      aria-labelledby="contest-timeline-title"
    >
      <header className="freshman-contest-section-heading">
        <p>03 / TIMELINE</p>
        <div>
          <h2 id="contest-timeline-title">从开场到最终榜</h2>
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
        <Snowflake size={28} aria-hidden="true" />
        <div>
          <p>最后一小时封榜</p>
          <h3>{freezeTitle}</h3>
        </div>
        <p>{freezeDetail}</p>
      </div>
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
            <h2 id="contest-format-title">把三个人的判断，压缩进一台电脑</h2>
            <p>
              三名队员共享题册、打印资料和一台电脑，在五小时内解决尽可能多的题。分工不是固定职位，而是一套随赛况不断调整的协作方式。
            </p>
          </div>
        </header>

        <div className="school-contest-team-console" aria-label="传统 ACM 团队协作方式">
          <article>
            <UsersRound size={25} aria-hidden="true" />
            <span>01 / READ</span>
            <h3>并行读题</h3>
            <p>三个人同时筛选题目，尽快识别可做题、风险题和需要继续推导的题。</p>
          </article>
          <div className="school-contest-computer">
            <Monitor size={38} aria-hidden="true" />
            <strong>ONE COMPUTER</strong>
            <span>共享代码、调试与提交窗口</span>
          </div>
          <article>
            <Handshake size={25} aria-hidden="true" />
            <span>02 / SOLVE</span>
            <h3>协作攻坚</h3>
            <p>
              一人编码时，另外两人继续推导、构造样例或检查边界，让电脑始终服务于当前最高优先级。
            </p>
          </article>
          <article>
            <FlagTriangleRight size={25} aria-hidden="true" />
            <span>03 / DECIDE</span>
            <h3>动态决策</h3>
            <p>根据通过题数、罚时和榜单变化及时换题，避免整个队伍被一道题拖住。</p>
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
            <p>通过题数相同时，总罚时更少的队伍排名更高。</p>
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
        lead="赛程按传统五小时 ACM 模式展示，具体开赛时间、题量和现场安排以赛前通知为准。"
        freezeTitle="看不见结果，也要继续做出自己的判断。"
        freezeDetail="封榜后仍可正常提交并查看本队评测结果，但其他队伍的新结果不会公开。比赛结束后通过滚榜逐步揭晓封榜期间的提交，最终确定名次。"
      />

      <section
        id="contest-ready"
        className="freshman-contest-section freshman-contest-ready"
        aria-labelledby="contest-ready-title"
      >
        <header className="freshman-contest-section-heading">
          <p>04 / READY</p>
          <div>
            <h2 id="contest-ready-title">先成为一支队伍，再进入赛场</h2>
            <p>稳定的协作来自赛前磨合。共享代码习惯、调试流程与换题信号，比临场决定分工更可靠。</p>
          </div>
        </header>

        <div className="freshman-contest-ready-grid">
          <div>
            <UsersRound size={24} aria-hidden="true" />
            <strong>三人组队</strong>
            <p>提前确认队员与队名，并按通知完成报名。</p>
          </div>
          <div>
            <Laptop size={24} aria-hidden="true" />
            <strong>共用设备</strong>
            <p>一支队伍使用一台电脑，提前统一开发环境。</p>
          </div>
          <div>
            <Wifi size={24} aria-hidden="true" />
            <strong>现场网络</strong>
            <p>连接比赛指定网络，按现场要求使用评测系统。</p>
          </div>
          <div>
            <Code2 size={24} aria-hidden="true" />
            <strong>赛前磨合</strong>
            <p>练习读题分配、代码复核、样例构造与换题节奏。</p>
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
            校赛面向全校选拔参加华为杯江苏省大学生程序设计大赛（JSCPC）的队伍；具体奖项、名额与选拔办法以赛前最终通知为准。
          </p>
        </div>
      </section>

      <ContestClosing
        kicker="BUILD A TEAM"
        title="三个人，一台电脑，把不同的思路变成同一个答案。"
        detail="从公开赛和日常训练开始磨合，建立属于你们的读题、编码与复盘节奏。"
        action="开始组队训练"
      />
    </>
  )
}

export function FreshmanContestPage() {
  const [activeContest, setActiveContest] = useState<ContestKind>('freshman')
  const pointerStartX = useRef<number | null>(null)
  const freshmanActive = activeContest === 'freshman'

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointerStartX.current = event.clientX
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (pointerStartX.current === null) return
    const distance = event.clientX - pointerStartX.current
    pointerStartX.current = null
    if (Math.abs(distance) < 48) return
    setActiveContest((current) => (current === 'freshman' ? 'school' : 'freshman'))
  }

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
        <p className="campus-contest-mobile-swipe-hint">
          <MoveHorizontal size={15} aria-hidden="true" />
          {freshmanActive ? '右划查看校赛' : '右划返回新生赛'}
        </p>
        <div
          className="campus-contest-hero-track"
          style={{ transform: schoolActiveTransform(activeContest) }}
        >
          <FreshmanHero active={freshmanActive} />
          <SchoolHero active={!freshmanActive} />
        </div>

        <div className="campus-contest-picker-wrap">
          <div className="campus-contest-picker" role="tablist" aria-label="选择校内赛事">
            <button
              id="contest-picker-freshman"
              type="button"
              role="tab"
              aria-controls="contest-slide-freshman"
              aria-selected={freshmanActive}
              onClick={() => setActiveContest('freshman')}
            >
              <span>01</span>
              <strong>新生赛</strong>
              <small>个人 · 创新积分制</small>
            </button>
            <button
              id="contest-picker-school"
              type="button"
              role="tab"
              aria-controls="contest-slide-school"
              aria-selected={!freshmanActive}
              onClick={() => setActiveContest('school')}
            >
              <span>02</span>
              <strong>校赛</strong>
              <small>团队 · 传统 ACM</small>
            </button>
          </div>
          <p className="campus-contest-swipe-hint">
            <MoveHorizontal size={16} aria-hidden="true" />
            横向滑动切换赛事
          </p>
        </div>
      </section>

      <nav className="freshman-contest-jump-nav" aria-label="校内赛事页面导航">
        <a href="#contest-format">{freshmanActive ? '赛题结构' : '传统赛制'}</a>
        <a href="#contest-scoring">计分排名</a>
        <a href="#contest-timeline">比赛进程</a>
        <a href="#contest-ready">{freshmanActive ? '参赛准备' : '组队准备'}</a>
      </nav>

      <div className="campus-contest-content" aria-live="polite">
        {freshmanActive ? <FreshmanContestDetails /> : <SchoolContestDetails />}
      </div>
    </div>
  )
}

function schoolActiveTransform(activeContest: ContestKind) {
  return activeContest === 'school' ? 'translateX(-100%)' : 'translateX(0)'
}
