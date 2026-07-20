import { useEffect, useMemo, useState } from 'react'
import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right'
import BookMarked from 'lucide-react/dist/esm/icons/book-marked'
import Check from 'lucide-react/dist/esm/icons/check'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down'
import CircleGauge from 'lucide-react/dist/esm/icons/circle-gauge'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3'
import CodeXml from 'lucide-react/dist/esm/icons/code-xml'
import Flag from 'lucide-react/dist/esm/icons/flag'
import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb'
import Repeat2 from 'lucide-react/dist/esm/icons/repeat-2'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Route from 'lucide-react/dist/esm/icons/route'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles'
import TimerReset from 'lucide-react/dist/esm/icons/timer-reset'
import UsersRound from 'lucide-react/dist/esm/icons/users-round'

interface LearningStage {
  id: string
  number: string
  duration: string
  title: string
  subtitle: string
  description: string
  topics: string[]
  practice: string
  checkpoint: string[]
}

type StartLevel = 'beginner' | 'syntax' | 'contest'

const LEARNING_PROGRESS_KEY = 'usts-acm-land-learning-progress:v1'

const learningStages: LearningStage[] = [
  {
    id: 'stage-foundation',
    number: '01',
    duration: '第 1–2 周',
    title: '环境与语法',
    subtitle: '先写出第一行 C++，再让程序稳定运行',
    description:
      '完成开发环境配置，熟悉输入输出、判断、循环、函数、数组和字符串。这个阶段不追求算法数量，重点是能把题意翻译成一段可运行的程序。',
    topics: ['输入输出', '判断与循环', '函数', '数组', '字符串', '基础调试'],
    practice: '每天学 1 个知识点，独立写出代码，再记录 1 个当天遇到的错误。',
    checkpoint: [
      '能独立调试越界与初始化错误',
      '能不照抄示例完成一道语法题',
      '累计完成 30 道入门题',
    ],
  },
  {
    id: 'stage-toolbox',
    number: '02',
    duration: '第 3–6 周',
    title: '基础题型',
    subtitle: '从会写语法，到能独立拆解一道题',
    description:
      '用排序、枚举、模拟、前缀和与二分等基础题型建立解题手感。先看懂问题中的过程和约束，再选择合适的写法。',
    topics: ['复杂度直觉', '模拟与枚举', '排序', '前缀和', '二分入门', '基础 STL'],
    practice: '按知识点完成小题单；每道题写完后，用一句话记录“我把什么过程翻译成了代码”。',
    checkpoint: [
      '能从数据范围估计目标复杂度',
      '能解释 O(n) 与 O(n²) 的差别',
      '能独立完成洛谷入门题单中的基础题',
    ],
  },
  {
    id: 'stage-contest',
    number: '03',
    duration: '持续积累',
    title: '算法思维',
    subtitle: '按模型学习，而不是只背一份模板',
    description:
      '逐步学习贪心、搜索、图论、数据结构和动态规划。每学一个算法，都要回答它解决什么结构、为什么正确、数据范围如何提示它。',
    topics: ['贪心', '递归与搜索', '图的遍历', '最短路', '并查集', '基础动态规划'],
    practice: '先读一份讲解，再完成 3–6 道从直接应用到轻微变形的题，并尝试口述解法。',
    checkpoint: [
      '能为基础算法写出正确性说明',
      '能从题目条件中识别常见模型',
      '能在赛后补完至少一道未通过题',
    ],
  },
  {
    id: 'stage-race',
    number: '04',
    duration: '从第 4 周开始',
    title: '参加比赛',
    subtitle: '从会做题，到在有限时间里做出选择',
    description:
      '从 Codeforces 新生赛或虚拟参赛开始，训练读题顺序、止损、罚时意识和赛后补题。Rating 只是反馈，真正重要的是更快发现模型与错误。',
    topics: ['读题顺序', '时间分配', '罚时意识', '止损换题', '赛后补题', '复盘记录'],
    practice: '先完成一场新手比赛；适应后每周参加公开赛或虚拟参赛，赛后 24 小时内补题。',
    checkpoint: ['能在开场快速浏览并分级题目', '能在卡题时主动切换目标', '形成自己的赛后复盘记录'],
  },
  {
    id: 'stage-team',
    number: '05',
    duration: '赛季进阶',
    title: '准备三人团队赛',
    subtitle: '把个人能力组织成一支队伍的吞吐量',
    description:
      'ICPC、CCPC 与 JSCPC 不只是三个人分别做题。需要约定读题、上机、验样例、交叉检查和信息同步方式，在一台电脑上减少等待与重复劳动。',
    topics: ['题目分工', '思路口述', '代码交叉检查', '纸上推导', '封榜决策', '队伍复盘'],
    practice:
      '定期进行五小时模拟赛；记录电脑空闲、重复读题和错误提交发生的时间点，再针对流程调整。',
    checkpoint: [
      '三人能用一分钟同步题意与进度',
      '有人编码时其他人仍有明确工作',
      '赛后能区分个人问题与协作问题',
    ],
  },
]

const firstFourWeeks = [
  {
    week: '第 1 周',
    focus: '搭好 C++ 环境',
    detail: '完成输入输出、判断与循环，确保能独立编译、运行和提交代码。',
    outcome: '写出第一批可通过的程序',
    tasks: ['配置 C++ 编译环境', '完成输入输出与判断练习', '独立提交 5 道短题'],
  },
  {
    week: '第 2 周',
    focus: '补齐程序基本结构',
    detail: '学习数组、字符串与函数，累计完成 30 道入门题。',
    outcome: '建立稳定的语法手感',
    tasks: ['掌握数组与字符串', '用函数拆分一段程序', '累计完成 30 道入门题'],
  },
  {
    week: '第 3 周',
    focus: '接触第一批题型',
    detail: '练习排序、枚举与模拟，开始洛谷入门题单。',
    outcome: '从“写代码”转向“解问题”',
    tasks: ['完成一个排序小专题', '各做 3 道枚举与模拟题', '开始洛谷入门题单'],
  },
  {
    week: '第 4 周',
    focus: '完成第一次比赛',
    detail: '参加 Codeforces 新生赛；没有合适场次时，完成一次虚拟参赛。',
    outcome: '留下第一份赛后复盘',
    tasks: ['熟悉比赛提交与罚时', '完成一场新手赛或虚拟赛', '补题并写下失败原因'],
  },
]

const weekActions: Record<number, { label: string; href: string } | undefined> = {
  0: { label: '一键配置 C++ 环境', href: 'https://ab.algoux.cn/' },
}

const beginnerPlatforms = [
  {
    id: 'beginner' as StartLevel,
    order: '01',
    name: '牛客',
    cue: '完全不会写代码',
    goal: '从中文语法题和基础题开始，先建立编程手感与信心。',
    action: '进入牛客竞赛',
    href: 'https://www.nowcoder.com/problem/tracker#/problems',
    className: 'nowcoder',
    firstStep: '今天先完成 3 道输入输出题，熟悉提交和判题结果。',
  },
  {
    id: 'syntax' as StartLevel,
    order: '02',
    name: '洛谷',
    cue: '已经会基础语法',
    goal: '按知识点使用题单循序练习，把基础题型组织成系统。',
    action: '浏览洛谷题单',
    href: 'https://www.luogu.com.cn/training/list',
    className: 'luogu',
    firstStep: '从排序、枚举或模拟中选择一个题单，先完成最前面的 3 题。',
  },
  {
    id: 'contest' as StartLevel,
    order: '03',
    name: 'Codeforces',
    cue: '想开始参加比赛',
    goal: '从 800 分题目和新手比赛开始，适应英文题面与真实比赛节奏。',
    action: '查看 800 分题目',
    href: 'https://codeforces.com/problemset?tags=800-800',
    className: 'codeforces',
    firstStep: '找一场 Div. 4 或新手赛，从第一题开始，一步一步来。',
  },
]

const topicGroups = [
  {
    label: '程序基础',
    index: 'A',
    description: '语法、复杂度、调试、STL 与代码习惯，是所有训练的地基。',
  },
  {
    label: '思维方法',
    index: 'B',
    description: '枚举、贪心、构造、二分与不变量，训练从条件中提取规律。',
  },
  {
    label: '数据结构',
    index: 'C',
    description: '栈、队列、集合、树状数组、线段树，让信息维护变得高效。',
  },
  {
    label: '图与搜索',
    index: 'D',
    description: 'DFS、BFS、最短路、生成树与连通性，处理关系和状态空间。',
  },
  {
    label: '动态规划',
    index: 'E',
    description: '从状态定义和转移来源出发，把重复子问题组织成完整解法。',
  },
  {
    label: '数学基础',
    index: 'F',
    description: '数论、组合、概率与线性代数，为计数和结构推导提供语言。',
  },
]

const resources = [
  {
    name: '算法竞赛 Wiki',
    type: '中文入门与知识导航',
    description: '从入门主题出发查找算法竞赛知识、学习顺序和相关资料。',
    href: 'https://www.algowiki.cn/',
  },
  {
    name: 'OI Wiki',
    type: '中文知识索引',
    description: '查找算法定义、性质、复杂度和进一步阅读入口。',
    href: 'https://oi-wiki.org/',
  },
  {
    name: 'Codeforces EDU',
    type: '专题课程与题目',
    description: '用课程配套题把二分、数据结构、图论等专题练成可用技能。',
    href: 'https://codeforces.com/edu/courses',
  },
  {
    name: 'AtCoder Problems',
    type: '难度与进度工具',
    description: '按难度挑选 AtCoder 题目，观察不同知识点的稳定通过区间。',
    href: 'https://kenkoooo.com/atcoder/',
  },
  {
    name: '牛客竞赛',
    type: '中文比赛与题库',
    description: '参加周赛、练习赛与寒暑假训练营，积累中文题面比赛经验。',
    href: 'https://ac.nowcoder.com/acm/contest/vip-index',
  },
  {
    name: 'XCPC Link',
    type: '算法竞赛链接集合',
    description: '集中查找比赛、训练平台、题库、工具与社区资源入口。',
    href: 'https://xcpc.link/',
  },
]

export function LearningPage() {
  const [startLevel, setStartLevel] = useState<StartLevel>('beginner')
  const [activeWeek, setActiveWeek] = useState(0)
  const [openStage, setOpenStage] = useState('stage-foundation')
  const [completedTasks, setCompletedTasks] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(LEARNING_PROGRESS_KEY)
      return stored ? (JSON.parse(stored) as string[]) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(LEARNING_PROGRESS_KEY, JSON.stringify(completedTasks))
  }, [completedTasks])

  const recommendedPlatform = useMemo(
    () => beginnerPlatforms.find((platform) => platform.id === startLevel) ?? beginnerPlatforms[0],
    [startLevel],
  )
  const selectedWeek = firstFourWeeks[activeWeek]
  const totalTasks = firstFourWeeks.reduce((sum, week) => sum + week.tasks.length, 0)
  const progress = Math.round((completedTasks.length / totalTasks) * 100)

  function toggleTask(taskId: string) {
    setCompletedTasks((current) =>
      current.includes(taskId) ? current.filter((item) => item !== taskId) : [...current, taskId],
    )
  }

  return (
    <div className="learning-page">
      <section className="learning-hero" aria-labelledby="learning-title">
        <div className="learning-hero-copy">
          <p className="learning-kicker">USTS ACM INTERACTIVE PATH · START</p>
          <h1 id="learning-title">
            新手学习引导
            <span>从第一行代码，到第一次团队赛</span>
          </h1>
          <p>
            算法竞赛的公开资源很多，难点往往不是“没有资料”，而是不知道现在该学什么、练到什么程度再继续。这里给出一条可调整的主线，帮你减少路线选择，把时间留给思考和实践。
          </p>
          <div className="learning-time-note">
            <Clock3 size={18} aria-hidden="true" />
            <strong>每天 60–90 分钟即可开始</strong>
            <span>先建立连续的节奏，再逐步增加训练量。</span>
          </div>
        </div>
        <div className="learning-start-panel" aria-label="选择学习起点">
          <div className="learning-start-heading">
            <Sparkles size={18} aria-hidden="true" />
            <div>
              <small>先告诉我们你现在在哪</small>
              <strong>选择你的学习起点</strong>
            </div>
          </div>
          <div className="learning-start-options">
            {beginnerPlatforms.map((platform) => (
              <button
                type="button"
                className={startLevel === platform.id ? 'is-selected' : ''}
                aria-pressed={startLevel === platform.id}
                aria-label={platform.cue}
                onClick={() => setStartLevel(platform.id)}
                key={platform.id}
              >
                <span>{platform.order}</span>
                {platform.cue}
              </button>
            ))}
          </div>
          <div className="learning-start-result" aria-live="polite">
            <small>推荐从这里开始</small>
            <div>
              <strong>{recommendedPlatform.name}</strong>
              <span>{recommendedPlatform.firstStep}</span>
            </div>
            <a
              href={recommendedPlatform.href}
              target="_blank"
              rel="noreferrer"
              aria-label={`${recommendedPlatform.name}推荐入口（新窗口打开）`}
            >
              {recommendedPlatform.action}
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <nav className="learning-jump-nav" aria-label="学习页章节">
        <a href="#learning-first-month">
          <span>01</span>四周计划
        </a>
        <a href="#learning-platforms">
          <span>02</span>练习平台
        </a>
        <a href="#learning-roadmap">
          <span>03</span>进阶路线
        </a>
        <a href="#learning-topics">
          <span>04</span>知识地图
        </a>
        <a href="#learning-rhythm">
          <span>05</span>训练节奏
        </a>
        <a href="#learning-resources">
          <span>06</span>开放资源
        </a>
        <a href="#learning-community">
          <span>07</span>竞赛圈子
        </a>
      </nav>

      <div className="learning-interactive-content">
        <section className="learning-section learning-first-month" id="learning-first-month">
          <header className="learning-section-heading">
            <p>01 / FIRST MONTH</p>
            <div>
              <h2>前四周，只做这些事</h2>
              <p>
                目标不是刷很多题，而是建立每天能继续的节奏。先完成这条最短路线，再决定如何深入。
              </p>
            </div>
          </header>
          <div className="learning-plan-app">
            <div className="learning-plan-progress">
              <div>
                <span>四周总体进度</span>
                <strong>{progress}%</strong>
              </div>
              <div
                className="learning-progress-track"
                role="progressbar"
                aria-label="四周学习进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
              <button
                type="button"
                onClick={() => setCompletedTasks([])}
                disabled={completedTasks.length === 0}
              >
                <RotateCcw size={14} aria-hidden="true" />
                重置进度
              </button>
            </div>
            <div className="learning-week-tabs" role="tablist" aria-label="选择计划周次">
              {firstFourWeeks.map((week, index) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeWeek === index}
                  aria-controls={`learning-week-panel-${index}`}
                  id={`learning-week-tab-${index}`}
                  className={activeWeek === index ? 'is-active' : ''}
                  onClick={() => setActiveWeek(index)}
                  key={week.week}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{week.week}</strong>
                  <small>{week.focus}</small>
                </button>
              ))}
            </div>
            <div
              className="learning-week-panel"
              role="tabpanel"
              id={`learning-week-panel-${activeWeek}`}
              aria-labelledby={`learning-week-tab-${activeWeek}`}
            >
              <div className="learning-week-summary">
                <span>本周目标</span>
                <h3>{selectedWeek.focus}</h3>
                <p>{selectedWeek.detail}</p>
                <strong>
                  <Flag size={15} aria-hidden="true" />
                  {selectedWeek.outcome}
                </strong>
                {weekActions[activeWeek] ? (
                  <a
                    className="learning-week-action"
                    href={weekActions[activeWeek]?.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${weekActions[activeWeek]?.label}（新窗口打开）`}
                  >
                    {weekActions[activeWeek]?.label}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                ) : null}
              </div>
              <div className="learning-week-checklist" aria-label={`${selectedWeek.week}任务清单`}>
                <span>完成后勾选</span>
                {selectedWeek.tasks.map((task, taskIndex) => {
                  const taskId = `${activeWeek}-${taskIndex}`
                  return (
                    <label key={taskId}>
                      <input
                        type="checkbox"
                        checked={completedTasks.includes(taskId)}
                        onChange={() => toggleTask(taskId)}
                      />
                      <span>
                        <Check size={14} aria-hidden="true" />
                      </span>
                      {task}
                    </label>
                  )
                })}
              </div>
            </div>
            <aside className="learning-plan-tip">
              <Lightbulb size={18} aria-hidden="true" />
              <p>
                <strong>卡住 30 分钟？</strong>
                先看提示，不直接抄答案；理解后关掉题解，重新独立写一遍。
              </p>
            </aside>
          </div>
        </section>

        <section className="learning-section learning-platforms" id="learning-platforms">
          <header className="learning-section-heading learning-section-heading-light">
            <p>02 / CHOOSE A PLATFORM</p>
            <div>
              <h2>三个平台，不用一次全学</h2>
              <p>
                根据你现在会什么选择入口。推荐顺序是牛客 → 洛谷 →
                Codeforces，但不需要“毕业”后才能使用下一个平台。
              </p>
            </div>
          </header>
          <div className="learning-platform-list">
            {beginnerPlatforms.map((platform) => (
              <article
                className={`learning-platform learning-platform-${platform.className}${startLevel === platform.id ? ' is-recommended' : ''}`}
                key={platform.name}
              >
                <span>{platform.order}</span>
                <div>
                  <small>{platform.cue}</small>
                  <h3>{platform.name}</h3>
                </div>
                {startLevel === platform.id ? (
                  <strong className="learning-recommended-badge">当前推荐</strong>
                ) : null}
                <p>{platform.goal}</p>
                <a
                  href={platform.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${platform.action}（新窗口打开）`}
                >
                  {platform.action}
                  <ArrowUpRight size={17} aria-hidden="true" />
                </a>
              </article>
            ))}
          </div>
          <div className="learning-platform-order" aria-label="推荐平台学习顺序">
            <strong>建议顺序</strong>
            <span>牛客</span>
            <i aria-hidden="true">→</i>
            <span>洛谷</span>
            <i aria-hidden="true">→</i>
            <span>Codeforces</span>
            <p>循序渐进，打好基础，更快投入真实比赛。</p>
          </div>
        </section>

        <section className="learning-section learning-roadmap" id="learning-roadmap">
          <header className="learning-section-heading">
            <p>03 / ROADMAP</p>
            <div>
              <h2>从环境与语法，到真正站上赛场</h2>
              <p>前四阶段对应零基础到比赛的主线；进入团队赛后，继续学习协作与赛场决策。</p>
            </div>
          </header>

          <div className="learning-stage-list">
            {learningStages.map((stage) => (
              <article
                id={stage.id}
                className={`learning-stage${openStage === stage.id ? ' is-open' : ''}`}
                key={stage.id}
              >
                <button
                  type="button"
                  className="learning-stage-trigger"
                  aria-expanded={openStage === stage.id}
                  aria-controls={`${stage.id}-content`}
                  onClick={() => setOpenStage((current) => (current === stage.id ? '' : stage.id))}
                >
                  <span>{stage.number}</span>
                  <div>
                    <small>{stage.duration}</small>
                    <h3>{stage.title}</h3>
                    <p>{stage.subtitle}</p>
                  </div>
                  <ChevronDown size={20} aria-hidden="true" />
                </button>
                {openStage === stage.id ? (
                  <div className="learning-stage-content" id={`${stage.id}-content`}>
                    <div className="learning-stage-main">
                      <p className="learning-stage-description">{stage.description}</p>
                      <ul className="learning-topic-tags" aria-label={`${stage.title}知识点`}>
                        {stage.topics.map((topic) => (
                          <li key={topic}>{topic}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="learning-stage-notes">
                      <div>
                        <Repeat2 size={18} aria-hidden="true" />
                        <h4>怎么练</h4>
                        <p>{stage.practice}</p>
                      </div>
                      <div>
                        <Flag size={18} aria-hidden="true" />
                        <h4>进入下一阶段前</h4>
                        <ul>
                          {stage.checkpoint.map((item) => (
                            <li key={item}>
                              <Check size={13} aria-hidden="true" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="learning-section learning-topics" id="learning-topics">
          <header className="learning-section-heading learning-section-heading-light">
            <p>04 / KNOWLEDGE MAP</p>
            <div>
              <h2>知识点不是清单，而是一张相互连接的地图</h2>
              <p>先认识六个区域，再通过题目理解它们之间的组合方式。</p>
            </div>
          </header>
          <div className="learning-topic-grid">
            {topicGroups.map((group) => (
              <article key={group.index}>
                <span>{group.index}</span>
                <CodeXml size={21} aria-hidden="true" />
                <h3>{group.label}</h3>
                <p>{group.description}</p>
              </article>
            ))}
          </div>
          <aside className="learning-topic-note">
            <Lightbulb size={21} aria-hidden="true" />
            <p>
              不需要“学完所有算法”才参赛。比赛会告诉你哪些知识还不牢，也会让抽象的算法第一次变成真正需要的工具。
            </p>
          </aside>
        </section>

        <section className="learning-section learning-rhythm" id="learning-rhythm">
          <header className="learning-section-heading">
            <p>05 / WEEKLY RHYTHM</p>
            <div>
              <h2>把训练组织成稳定循环</h2>
              <p>一周不必塞满，但要让学习、比赛和复盘都真正发生。</p>
            </div>
          </header>
          <div className="learning-rhythm-grid">
            <article>
              <BookMarked size={23} aria-hidden="true" />
              <span>MON–THU</span>
              <h3>专题学习</h3>
              <p>选择一个小主题，读讲解、写模板、做由浅入深的配套题。</p>
              <strong>理解 40% · 练习 60%</strong>
            </article>
            <article>
              <TimerReset size={23} aria-hidden="true" />
              <span>FRI–SUN</span>
              <h3>完整比赛</h3>
              <p>参加公开赛或虚拟参赛，不暂停、不查题解，保留真实决策过程。</p>
              <strong>每周至少 2 场</strong>
            </article>
            <article>
              <CircleGauge size={23} aria-hidden="true" />
              <span>WITHIN 24H</span>
              <h3>赛后复盘</h3>
              <p>重做卡住的题，分类错误原因；读题解后必须关掉题解重新实现。</p>
              <strong>补题比场数更重要</strong>
            </article>
            <article>
              <UsersRound size={23} aria-hidden="true" />
              <span>EVERY 2–4 WEEKS</span>
              <h3>交流与校准</h3>
              <p>向队友口述一道题的模型和证明，检查自己是否真的理解。</p>
              <strong>能讲清楚，才算掌握</strong>
            </article>
          </div>
        </section>

        <section className="learning-section learning-resources" id="learning-resources">
          <header className="learning-section-heading">
            <p>06 / OPEN RESOURCES</p>
            <div>
              <h2>少而明确的开放资源入口</h2>
              <p>这些资源绝大多数内容免费开放。先按当前阶段选一个入口，不必同时收藏所有资料。</p>
            </div>
          </header>
          <div className="learning-resource-list">
            {resources.map((resource, index) => (
              <a
                href={resource.href}
                target="_blank"
                rel="noreferrer"
                key={resource.name}
                aria-label={`${resource.name}（新窗口打开）`}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{resource.name}</strong>
                  <small>{resource.type}</small>
                </div>
                <p>{resource.description}</p>
                <ArrowUpRight size={18} aria-hidden="true" />
              </a>
            ))}
          </div>
          <div className="learning-closing">
            <Route size={27} aria-hidden="true" />
            <div>
              <p>不知道从哪一题开始？</p>
              <h2>从阶段一选一道短题，今天就完成第一次“读题—实现—复盘”。</h2>
            </div>
            <a href="#stage-foundation">返回阶段一</a>
          </div>
        </section>

        <section className="learning-section learning-community" id="learning-community">
          <div className="learning-community-icon" aria-hidden="true">
            <UsersRound size={28} />
          </div>
          <div className="learning-community-copy">
            <p>07 / COMMUNITY</p>
            <h2>融入竞赛圈子</h2>
            <p>
              算法竞赛不只是独自刷题。挑选一些你感兴趣的学校、地区或专题交流群，认识一起训练的人，获取比赛信息，也把自己的问题和思路讲出来。
            </p>
          </div>
          <div className="learning-community-action">
            <span>群组导航</span>
            <strong>ACM 群组坐标汇总</strong>
            <p>按兴趣挑选即可，不必一次加入很多群。</p>
            <a
              href="https://acmer.info/"
              target="_blank"
              rel="noreferrer"
              aria-label="查看 ACM 群组坐标汇总（新窗口打开）"
            >
              查看群组汇总
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}
