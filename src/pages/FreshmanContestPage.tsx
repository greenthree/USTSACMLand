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
import Pause from 'lucide-react/dist/esm/icons/pause'
import Play from 'lucide-react/dist/esm/icons/play'
import Snowflake from 'lucide-react/dist/esm/icons/snowflake'
import Timer from 'lucide-react/dist/esm/icons/timer'
import Trophy from 'lucide-react/dist/esm/icons/trophy'
import UserRound from 'lucide-react/dist/esm/icons/user-round'
import UsersRound from 'lucide-react/dist/esm/icons/users-round'
import Wifi from 'lucide-react/dist/esm/icons/wifi'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import './freshman-contest.css'

type ContestKind = 'freshman' | 'practice' | 'school'
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

const practiceTimeline = [
  { time: '00:00', title: '快速浏览', detail: '浏览三个梯级，先判断会写的题和可争取的测试点。' },
  {
    time: '30–60 分钟',
    title: '完成 L1',
    detail: '按个人节奏完成会写的基础级题目，不把节点当作硬性截止。',
  },
  { time: '第 2 小时', title: '推进 L2', detail: '集中完成会写的进阶级题目，继续积累确定得分。' },
  {
    time: '剩余时间',
    title: '争取部分分',
    detail: '对准尚未通过的题目和测试点，逐步提高已有得分。',
  },
]

const schoolTimeline = [
  { time: '00:00', title: '比赛开始', detail: '三名队员共同读题，快速建立题目优先级。' },
  { time: '04:00', title: '榜单封停', detail: '最后一小时不再公开其他队伍的新结果。' },
  { time: '05:00', title: '比赛结束', detail: '停止提交，裁判确认所有有效评测结果。' },
  { time: '赛后', title: '滚榜揭晓', detail: '从封榜前名次开始逐队揭晓，形成最终排名。' },
]

type RollboardProblemState = 'ac' | 'wa' | 'pending' | 'empty'
type RollboardRevealResult = Extract<RollboardProblemState, 'ac' | 'wa'>

interface RollboardProblem {
  label: string
  state: RollboardProblemState
  attempts?: number
  submissionTime?: number
  reveal?: RollboardRevealResult
  penalty?: number
}

interface RollboardTeam {
  id: string
  team: string
  solved: number
  penalty: number
  seed: number
  problems: RollboardProblem[]
}

type RollboardProblemInput = Omit<RollboardProblem, 'label'>

function createSchoolRollboardProblems(
  teamSeed: number,
  problemG: RollboardProblemInput,
  problemK: RollboardProblemInput,
): RollboardProblem[] {
  const timeOffset = teamSeed * 3

  // The original four demo problems occupy A, C, G and K after inserting eight new columns.
  return [
    { label: 'A', state: 'ac', attempts: 1, submissionTime: 18 + timeOffset },
    { label: 'B', state: 'ac', attempts: 1, submissionTime: 36 + timeOffset },
    { label: 'C', state: 'ac', attempts: 2, submissionTime: 62 + timeOffset },
    { label: 'D', state: 'ac', attempts: 1, submissionTime: 89 + timeOffset },
    { label: 'E', state: 'empty' },
    { label: 'F', state: 'ac', attempts: 3, submissionTime: 126 + timeOffset },
    { label: 'G', ...problemG },
    { label: 'H', state: 'ac', attempts: 1, submissionTime: 169 + timeOffset },
    { label: 'I', state: 'ac', attempts: 2, submissionTime: 203 + timeOffset },
    { label: 'J', state: 'empty' },
    { label: 'K', ...problemK },
    { label: 'L', state: 'ac', attempts: 1, submissionTime: 246 + timeOffset },
  ]
}

const schoolRollboardTeams: RollboardTeam[] = [
  {
    id: 'compass',
    team: 'CF皇帝',
    solved: 10,
    penalty: 358,
    seed: 1,
    problems: createSchoolRollboardProblems(
      1,
      { state: 'ac', attempts: 2, submissionTime: 144 },
      { state: 'ac', attempts: 1, submissionTime: 218 },
    ),
  },
  {
    id: 'recursion',
    team: '零基础新生0队',
    solved: 9,
    penalty: 421,
    seed: 2,
    problems: createSchoolRollboardProblems(
      2,
      { state: 'ac', attempts: 2, submissionTime: 152 },
      { state: 'pending', attempts: 2, submissionTime: 110, reveal: 'ac', penalty: 130 },
    ),
  },
  {
    id: 'last-page',
    team: '春日影',
    solved: 9,
    penalty: 465,
    seed: 3,
    problems: createSchoolRollboardProblems(
      3,
      { state: 'ac', attempts: 1, submissionTime: 158 },
      { state: 'pending', attempts: 1, submissionTime: 120, reveal: 'ac', penalty: 120 },
    ),
  },
  {
    id: 'one-shot',
    team: '一路向南',
    solved: 8,
    penalty: 330,
    seed: 4,
    problems: createSchoolRollboardProblems(
      4,
      { state: 'pending', attempts: 1, submissionTime: 80, reveal: 'ac', penalty: 80 },
      { state: 'pending', attempts: 3, submissionTime: 252, reveal: 'wa' },
    ),
  },
  {
    id: 'boundary',
    team: '航电一队',
    solved: 8,
    penalty: 380,
    seed: 5,
    problems: createSchoolRollboardProblems(
      5,
      { state: 'pending', attempts: 2, submissionTime: 244, reveal: 'wa' },
      { state: 'pending', attempts: 3, submissionTime: 130, reveal: 'ac', penalty: 170 },
    ),
  },
]

function cloneSchoolRollboardTeams(): RollboardTeam[] {
  return schoolRollboardTeams.map((team) => ({
    ...team,
    problems: team.problems.map((problem) => ({ ...problem })),
  }))
}

function rankSchoolRollboardTeams(teams: RollboardTeam[]) {
  return [...teams].sort(
    (left, right) =>
      right.solved - left.solved || left.penalty - right.penalty || left.seed - right.seed,
  )
}

function revealSchoolRollboardProblem(team: RollboardTeam, problemLabel: string): RollboardTeam {
  const problem = team.problems.find((item) => item.label === problemLabel)
  if (!problem?.reveal) return team
  const reveal = problem.reveal

  return {
    ...team,
    solved: team.solved + (reveal === 'ac' ? 1 : 0),
    penalty: team.penalty + (reveal === 'ac' ? (problem.penalty ?? 0) : 0),
    problems: team.problems.map((item) =>
      item.label === problemLabel ? { ...item, state: reveal } : item,
    ),
  }
}

function completedSchoolRollboardTeams(): RollboardTeam[] {
  return cloneSchoolRollboardTeams().map((team) =>
    team.problems.reduce(
      (current, problem) =>
        problem.state === 'pending'
          ? revealSchoolRollboardProblem(current, problem.label)
          : current,
      team,
    ),
  )
}

function formatRollboardSubmission(problem: RollboardProblem) {
  if (problem.state === 'empty') return '-'

  return `${Math.max(1, problem.attempts ?? 1)}/${problem.submissionTime ?? 0}`
}

function describeRollboardSubmission(problem: RollboardProblem) {
  if (problem.state === 'empty') return `${problem.label} 题无提交`

  const submission = `第 ${Math.max(1, problem.attempts ?? 1)} 次提交，开赛后第 ${problem.submissionTime ?? 0} 分钟`
  return problem.state === 'ac'
    ? `${problem.label} 题首次 AC：${submission}`
    : `${problem.label} 题最后一次提交：${submission}`
}

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

function PracticeHero({ active }: ContestHeroProps) {
  const Heading = active ? 'h1' : 'h2'

  return (
    <article
      id="contest-slide-practice"
      className={`campus-contest-slide campus-contest-slide--practice${active ? ' is-active' : ''}`}
      role="tabpanel"
      aria-labelledby="contest-picker-practice"
      aria-hidden={!active}
    >
      <div className="freshman-contest-hero-inner">
        <div className="freshman-contest-hero-copy">
          <div className="freshman-contest-kicker">
            <span>USTS ACM / MARCH</span>
            <span>面向全校学生</span>
          </div>
          <p className="freshman-contest-edition">团体程序设计天梯赛校内选拔</p>
          <Heading id="practice-contest-title">练习赛</Heading>
          <p className="freshman-contest-intro">
            三小时，个人独立作答。练习赛模拟“中国高校计算机大赛——团体程序设计天梯赛”的题目结构与计分方式，并依据比赛成绩编排正式参赛队伍。
          </p>
          <div className="freshman-contest-hero-actions">
            <a
              className="freshman-contest-primary-action"
              href="#contest-format"
              tabIndex={active ? undefined : -1}
            >
              查看天梯赛模拟赛制
              <ArrowRight size={17} aria-hidden="true" />
            </a>
            <Link
              className="freshman-contest-secondary-action"
              to="/learning"
              tabIndex={active ? undefined : -1}
            >
              开始个人训练
            </Link>
          </div>
        </div>

        <div
          className="freshman-contest-scoreboard campus-contest-practice-scoreboard"
          aria-label="练习赛赛制概览"
        >
          <div className="freshman-contest-scoreboard-head">
            <img src={contestLogoUrl} alt="USTS ACM" />
            <span>LADDER TOURNAMENT</span>
          </div>
          <strong className="freshman-contest-clock">03:00:00</strong>
          <div className="freshman-contest-scoreboard-meta">
            <span>个人选拔赛</span>
            <span>测试点计分</span>
            <span>赛后队伍编排</span>
          </div>
          <div
            className="freshman-contest-problem-strip campus-contest-ladder-strip"
            aria-label="天梯赛三级题目结构"
          >
            <div>
              <span>L1 / 基础级</span>
              <strong>08</strong>
              <small>满分 100</small>
            </div>
            <div>
              <span>L2 / 进阶级</span>
              <strong>04</strong>
              <small>满分 100</small>
            </div>
            <div>
              <span>L3 / 登顶级</span>
              <strong>03</strong>
              <small>满分 90</small>
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

function SchoolRollboard() {
  const reduceMotion =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [teams, setTeams] = useState(() =>
    reduceMotion ? completedSchoolRollboardTeams() : cloneSchoolRollboardTeams(),
  )
  const [paused, setPaused] = useState(false)
  const [risingReveal, setRisingReveal] = useState<{
    teamId: string
    problemLabel: string
  }>()
  const toggleLabel = paused ? '继续滚榜动画' : '暂停滚榜动画'
  const rankedTeams = rankSchoolRollboardTeams(teams)
  const currentTeam = [...rankedTeams]
    .reverse()
    .find((team) => team.problems.some((problem) => problem.state === 'pending'))
  const currentProblem = currentTeam?.problems.find((problem) => problem.state === 'pending')
  const currentTeamId = currentTeam?.id
  const currentProblemLabel = currentProblem?.label
  const risingTeamId = risingReveal?.teamId
  const risingTeam = risingTeamId ? teams.find((team) => team.id === risingTeamId) : undefined
  const highlightedTeamId = risingTeamId ?? currentTeamId

  useEffect(() => {
    if (paused || reduceMotion || risingReveal) return undefined

    const timer = window.setTimeout(
      () => {
        if (!currentTeamId || !currentProblemLabel) {
          setRisingReveal(undefined)
          setTeams(cloneSchoolRollboardTeams())
          return
        }

        if (currentProblem?.reveal === 'ac') {
          setRisingReveal({ teamId: currentTeamId, problemLabel: currentProblemLabel })
        }

        setTeams((current) =>
          current.map((team) =>
            team.id === currentTeamId
              ? revealSchoolRollboardProblem(team, currentProblemLabel)
              : team,
          ),
        )
      },
      currentTeamId ? 1350 : 2600,
    )

    return () => window.clearTimeout(timer)
  }, [
    currentProblem?.reveal,
    currentProblemLabel,
    currentTeamId,
    paused,
    reduceMotion,
    risingReveal,
  ])

  useEffect(() => {
    if (!risingReveal) return undefined

    const timer = window.setTimeout(() => setRisingReveal(undefined), 1100)
    return () => window.clearTimeout(timer)
  }, [risingReveal])

  return (
    <section className={`school-rollboard${paused ? ' is-paused' : ''}`} aria-label="滚榜动画演示">
      <header className="school-rollboard-intro">
        <div>
          <p>ROLLING / SIMULATION 01</p>
          <h3>从最后一支待揭晓队伍开始</h3>
          <span>
            队伍按名次由下向上，题目按 A–L
            从左到右揭晓；题格显示提交次数/提交时间（分钟），绿色记录首次
            AC，红色与蓝色记录最后一次提交。
          </span>
        </div>
        <button type="button" onClick={() => setPaused((current) => !current)} title={toggleLabel}>
          {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          <span>{paused ? '继续' : '暂停'}</span>
          <span className="sr-only">滚榜动画</span>
        </button>
      </header>

      <div
        className="school-rollboard-frame"
        role="img"
        aria-label="模拟真实滚榜：从最低名次的待揭晓队伍开始，题格显示提交次数和提交时间，并在揭晓通过后重新排名"
      >
        <div className="school-rollboard-columns" aria-hidden="true">
          <span>名次</span>
          <span>队伍</span>
          {schoolRollboardTeams[0].problems.map((problem) => (
            <span key={problem.label} className="school-rollboard-problem-head">
              {problem.label}
            </span>
          ))}
          <span>AC</span>
          <span className="school-rollboard-penalty">罚时</span>
        </div>
        <ol aria-hidden="true">
          {teams.map((team) => {
            const rank = rankedTeams.findIndex((rankedTeam) => rankedTeam.id === team.id)
            const rowStyle = { '--rollboard-rank': rank } as CSSProperties

            return (
              <li
                key={team.id}
                className={`school-rollboard-row${team.id === highlightedTeamId ? ' is-current' : ''}${team.id === risingTeamId ? ' is-rising' : ''}`}
                data-rollboard-team={team.id}
                style={rowStyle}
              >
                <span className="school-rollboard-rank">{String(rank + 1).padStart(2, '0')}</span>
                <strong>{team.team}</strong>
                {team.problems.map((problem) => {
                  const active =
                    !risingReveal &&
                    team.id === currentTeamId &&
                    problem.label === currentProblemLabel

                  return (
                    <span
                      key={problem.label}
                      className={`school-rollboard-problem is-${problem.state}${active ? ' is-active' : ''}`}
                      data-rollboard-problem={problem.label}
                      title={describeRollboardSubmission(problem)}
                    >
                      {formatRollboardSubmission(problem)}
                    </span>
                  )
                })}
                <span className="school-rollboard-solved">
                  {String(team.solved).padStart(2, '0')}
                </span>
                <span className="school-rollboard-penalty">{team.penalty}</span>
              </li>
            )
          })}
        </ol>
        <footer aria-hidden="true">
          <span className="school-rollboard-live-dot" />
          从最低未揭晓队伍开始，逐题确认封榜提交
          <span>
            {risingReveal && risingTeam
              ? `RISING / ${risingTeam.team} / ${risingReveal.problemLabel}`
              : currentTeam && currentProblem
                ? `CURRENT / ${currentTeam.team} / ${currentProblem.label}`
                : 'FINAL / COMPLETE'}
          </span>
        </footer>
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
    setActiveContest((current) => moveContest(current, distance > 0 ? 1 : -1))
  }

  const mobileSwipeHint = freshmanActive
    ? '右划查看练习赛'
    : practiceActive
      ? '继续右划查看校赛'
      : '左划返回练习赛'

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
          {mobileSwipeHint}
        </p>
        <div
          className="campus-contest-hero-track"
          style={{ transform: contestActiveTransform(activeContest) }}
        >
          <FreshmanHero active={freshmanActive} />
          <PracticeHero active={practiceActive} />
          <SchoolHero active={schoolActive} />
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
              id="contest-picker-practice"
              type="button"
              role="tab"
              aria-controls="contest-slide-practice"
              aria-selected={practiceActive}
              onClick={() => setActiveContest('practice')}
            >
              <span>02</span>
              <strong>练习赛</strong>
              <small>个人 · 天梯模拟</small>
            </button>
            <button
              id="contest-picker-school"
              type="button"
              role="tab"
              aria-controls="contest-slide-school"
              aria-selected={schoolActive}
              onClick={() => setActiveContest('school')}
            >
              <span>03</span>
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
        <a href="#contest-format">
          {freshmanActive ? '赛题结构' : practiceActive ? '三级赛制' : '传统赛制'}
        </a>
        <a href="#contest-scoring">计分排名</a>
        <a href="#contest-timeline">比赛进程</a>
        <a href="#contest-ready">
          {freshmanActive ? '参赛准备' : practiceActive ? '选拔准备' : '组队准备'}
        </a>
      </nav>

      <div className="campus-contest-content" aria-live="polite">
        {freshmanActive ? (
          <FreshmanContestDetails />
        ) : practiceActive ? (
          <PracticeContestDetails />
        ) : (
          <SchoolContestDetails />
        )}
      </div>
    </div>
  )
}

const contestOrder: ContestKind[] = ['freshman', 'practice', 'school']

function moveContest(activeContest: ContestKind, direction: -1 | 1): ContestKind {
  const currentIndex = contestOrder.indexOf(activeContest)
  const nextIndex = Math.max(0, Math.min(contestOrder.length - 1, currentIndex + direction))
  return contestOrder[nextIndex]
}

function contestActiveTransform(activeContest: ContestKind) {
  return `translateX(-${contestOrder.indexOf(activeContest) * 100}%)`
}
