import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right'
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down'
import BookMarked from 'lucide-react/dist/esm/icons/book-marked'
import Check from 'lucide-react/dist/esm/icons/check'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down'
import CircleGauge from 'lucide-react/dist/esm/icons/circle-gauge'
import Clock3 from 'lucide-react/dist/esm/icons/clock-3'
import Flag from 'lucide-react/dist/esm/icons/flag'
import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb'
import Repeat2 from 'lucide-react/dist/esm/icons/repeat-2'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Route from 'lucide-react/dist/esm/icons/route'
import TimerReset from 'lucide-react/dist/esm/icons/timer-reset'
import UsersRound from 'lucide-react/dist/esm/icons/users-round'
import KnowledgeMap from '../components/learning/KnowledgeMap'
import './learning.css'

import {
  beginnerPlatforms,
  firstFourWeeks,
  learningChapters,
  learningStages,
  readStoredProgress,
  resources,
  taskIdOf,
  totalTasks,
  weekActions,
  LEARNING_PROGRESS_KEY,
  LEGACY_LEARNING_PROGRESS_KEY,
  type StartLevel,
} from './learning/learningData'

export function LearningPage() {
  const [startLevel, setStartLevel] = useState<StartLevel>('beginner')
  const [activeWeek, setActiveWeek] = useState(0)
  const [openStage, setOpenStage] = useState('stage-foundation')
  const [currentChapter, setCurrentChapter] = useState(learningChapters[0].id)
  const [completedTasks, setCompletedTasks] = useState<string[]>(readStoredProgress)
  const weekTabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const chapterLinkRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const jumpNavRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(LEARNING_PROGRESS_KEY, JSON.stringify(completedTasks))
      localStorage.removeItem(LEGACY_LEARNING_PROGRESS_KEY)
    } catch {
      // 隐私模式等场景下存储不可写，进度只保留在内存中
    }
  }, [completedTasks])

  // 章节导航 scrollspy：当前节 = 顶端越过阈值线（sticky 偏移下缘）的最后一节
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      let current = learningChapters[0].id
      for (const chapter of learningChapters) {
        const section = document.getElementById(chapter.id)
        if (section && section.getBoundingClientRect().top <= 170) current = chapter.id
      }
      const scroller = document.scrollingElement
      // 触底时尾节太短够不到阈值线，直接视为当前
      if (scroller && window.innerHeight + scroller.scrollTop >= scroller.scrollHeight - 2) {
        current = learningChapters[learningChapters.length - 1].id
      }
      setCurrentChapter(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
    }
  }, [])

  // 移动端目录为横向滚动条，自动把 scrollspy 的当前项收回可视范围。
  useEffect(() => {
    if (!window.matchMedia?.('(max-width: 780px)').matches) return
    const index = learningChapters.findIndex((chapter) => chapter.id === currentChapter)
    const nav = jumpNavRef.current
    const link = chapterLinkRefs.current[index]
    if (!nav || !link) return
    const left = Math.max(0, link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2)
    // Keep the active item visible synchronously. WebKit can still be animating
    // a nested smooth scroll when the scrollspy state has already committed.
    nav.scrollLeft = left
  }, [currentChapter])

  const recommendedPlatform = useMemo(
    () => beginnerPlatforms.find((platform) => platform.id === startLevel) ?? beginnerPlatforms[0],
    [startLevel],
  )
  const progress = Math.round((completedTasks.length / totalTasks) * 100)

  function toggleTask(taskId: string) {
    setCompletedTasks((current) =>
      current.includes(taskId) ? current.filter((item) => item !== taskId) : [...current, taskId],
    )
  }

  // APG tabs 键盘约定：左右方向键 + Home/End 移动并激活
  function handleWeekTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const count = firstFourWeeks.length
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % count
        : event.key === 'ArrowLeft'
          ? (index + count - 1) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null
    if (target === null) return
    event.preventDefault()
    setActiveWeek(target)
    weekTabRefs.current[target]?.focus()
  }

  function scrollToSection(event: ReactMouseEvent<HTMLAnchorElement>, id: string) {
    const section = document.getElementById(id)
    if (!section || typeof section.scrollIntoView !== 'function') return
    event.preventDefault()
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const mobileViewport = window.matchMedia?.('(max-width: 780px)').matches ?? false
    // Avoid a long-running WebKit page animation racing the scrollspy threshold
    // on mobile; the sticky horizontal chapter nav must settle in one frame.
    section.scrollIntoView({
      behavior: reduceMotion || mobileViewport ? 'auto' : 'smooth',
      block: 'start',
    })
    history.replaceState(null, '', `#${id}`)
  }

  return (
    <div className="learning-page">
      <section className="learning-hero" aria-labelledby="learning-title">
        <div className="learning-kicker-row">
          <p className="learning-kicker">USTS ACM LAND / LEARNING</p>
          <span className="learning-kicker-meta" aria-hidden="true">
            {String(learningStages.length).padStart(2, '0')} STAGES ·{' '}
            {String(totalTasks).padStart(2, '0')} TASKS
          </span>
        </div>
        <div className="learning-hero-copy">
          <h1 id="learning-title">
            新手学习引导
            <span>从第一行代码，到第一次团队赛</span>
          </h1>
          <p>
            算法竞赛的公开资源很多，难点往往不是“没有资料”，而是不知道现在该学什么、练到什么程度再继续。这里给出一条可调整的主线，帮你减少路线选择，把时间留给思考和实践。
          </p>
          <a
            className="learning-hero-action"
            href="#learning-first-month"
            onClick={(event) => scrollToSection(event, 'learning-first-month')}
          >
            开始四周计划
            <ArrowDown size={17} aria-hidden="true" />
          </a>
          <div className="learning-time-note">
            <Clock3 size={18} aria-hidden="true" />
            <strong>每天 60–90 分钟即可开始</strong>
            <span>先建立连续的节奏，再逐步增加训练量。</span>
          </div>
        </div>
        <div className="learning-start-panel" aria-label="选择学习起点">
          <div className="learning-start-heading">
            <Route size={20} aria-hidden="true" />
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
                onClick={() => setStartLevel(platform.id)}
                key={platform.id}
              >
                <span aria-hidden="true">{platform.order}</span>
                {platform.cue}
                <Check size={16} aria-hidden="true" />
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

      <div className="learning-guide-shell">
        <nav className="learning-jump-nav" aria-label="学习页章节" ref={jumpNavRef}>
          <p>学习路径</p>
          {learningChapters.map((chapter, index) => (
            <a
              href={`#${chapter.id}`}
              className={currentChapter === chapter.id ? 'is-current' : ''}
              aria-current={currentChapter === chapter.id ? 'true' : undefined}
              onClick={(event) => scrollToSection(event, chapter.id)}
              ref={(element) => {
                chapterLinkRefs.current[index] = element
              }}
              key={chapter.id}
            >
              <span>{chapter.index}</span>
              {chapter.label}
            </a>
          ))}
          <small>按顺序浏览，随时回到当前阶段。</small>
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
                  <span className="learning-progress-count">
                    {completedTasks.length} / {totalTasks} 项
                  </span>
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
                {firstFourWeeks.map((week, index) => {
                  const doneCount = week.tasks.filter((task) =>
                    completedTasks.includes(taskIdOf(index, task)),
                  ).length
                  return (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeWeek === index}
                      aria-controls={`learning-week-panel-${index}`}
                      id={`learning-week-tab-${index}`}
                      className={activeWeek === index ? 'is-active' : ''}
                      tabIndex={activeWeek === index ? 0 : -1}
                      onClick={() => setActiveWeek(index)}
                      onKeyDown={(event) => handleWeekTabKeyDown(event, index)}
                      ref={(el) => {
                        weekTabRefs.current[index] = el
                      }}
                      key={week.week}
                    >
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>{week.week}</strong>
                      <small>{week.focus}</small>
                      <span
                        className={`learning-week-tab-count${
                          doneCount === week.tasks.length ? ' is-done' : ''
                        }`}
                      >
                        {doneCount === week.tasks.length ? (
                          <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                        ) : null}
                        {doneCount}/{week.tasks.length}
                      </span>
                    </button>
                  )
                })}
              </div>
              {firstFourWeeks.map((week, index) => {
                const actions = weekActions[index]
                return (
                  <div
                    className="learning-week-panel"
                    role="tabpanel"
                    id={`learning-week-panel-${index}`}
                    aria-labelledby={`learning-week-tab-${index}`}
                    hidden={activeWeek !== index}
                    key={week.week}
                  >
                    <div className="learning-week-summary">
                      <span>本周目标</span>
                      <h3>{week.focus}</h3>
                      <p>{week.detail}</p>
                      <strong>
                        <Flag size={15} aria-hidden="true" />
                        {week.outcome}
                      </strong>
                      {actions.length > 0 ? (
                        <div className="learning-week-actions">
                          {actions.map((action) => (
                            <a
                              className="learning-week-action"
                              href={action.href}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`${action.label}（新窗口打开）`}
                              key={action.label}
                            >
                              {action.label}
                              <ArrowUpRight size={15} aria-hidden="true" />
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="learning-week-checklist" aria-label={`${week.week}任务清单`}>
                      <span>完成后勾选</span>
                      {week.tasks.map((task) => {
                        const taskId = taskIdOf(index, task)
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
                )
              })}
              <aside className="learning-plan-tip">
                <Lightbulb size={18} aria-hidden="true" />
                <p>
                  <span>
                    <strong>卡住 30 分钟？</strong>
                    先看提示，不直接抄答案；理解后关掉题解，重新独立写一遍。
                  </span>
                  <span>
                    <strong>平台怎么选？</strong>
                    前两周先在牛客完成入门练习；第 3
                    周可继续使用牛客，也可改用洛谷，两者皆可，不要求前后选择一致。
                  </span>
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
                  前两周先使用牛客熟悉提交与基础语法；进入第 3
                  周后，可以继续使用牛客，也可以改用洛谷。 准备参加线上比赛时，再开始使用
                  Codeforces。
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
                    {startLevel === platform.id ? (
                      <strong className="learning-recommended-badge">当前推荐</strong>
                    ) : null}
                  </div>
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
            <div className="learning-platform-order" aria-label="入门平台选择方式">
              <strong>前两周</strong>
              <span>牛客</span>
              <i aria-hidden="true">→</i>
              <strong>第 3 周</strong>
              <span>牛客</span>
              <i aria-hidden="true">或</i>
              <span>洛谷</span>
              <i aria-hidden="true">→</i>
              <span>Codeforces</span>
              <p>第 3 周两者皆可，不要求与前两周选择一致。</p>
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
                    onClick={() =>
                      setOpenStage((current) => (current === stage.id ? '' : stage.id))
                    }
                  >
                    <span>{stage.number}</span>
                    <div>
                      <small>{stage.duration}</small>
                      <h3>{stage.title}</h3>
                      <p>{stage.subtitle}</p>
                    </div>
                    <ChevronDown size={20} aria-hidden="true" />
                  </button>
                  <div
                    className="learning-stage-content"
                    id={`${stage.id}-content`}
                    hidden={openStage !== stage.id}
                  >
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
                </article>
              ))}
            </div>
          </section>

          <section className="learning-section learning-topics" id="learning-topics">
            <header className="learning-section-heading learning-section-heading-light">
              <p>04 / KNOWLEDGE MAP</p>
              <div>
                <h2>知识点不是清单，而是一张相互连接的地图</h2>
                <p>从领域进入子板块，再按顺序掌握具体知识点；先建立主干，再逐步扩展分支。</p>
              </div>
            </header>
            <KnowledgeMap />
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
              <a
                href="#stage-foundation"
                onClick={(event) => {
                  setOpenStage('stage-foundation')
                  scrollToSection(event, 'stage-foundation')
                }}
              >
                返回阶段一
              </a>
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
              <div className="learning-community-school">
                <span>校内交流</span>
                <strong>USTS算法小白交流群</strong>
                <p>在 QQ 中搜索群号加入，获取训练与校内赛信息，也可以直接交流入门问题。</p>
                <div
                  className="learning-community-qq"
                  aria-label="USTS算法小白交流群 QQ 群号 721375856"
                >
                  <span>QQ 群</span>
                  <strong>721375856</strong>
                </div>
              </div>
              <div className="learning-community-directory">
                <span>群组导航</span>
                <strong>ACM 群组坐标汇总</strong>
                <p>想认识更多学校和地区的选手，可以再按兴趣挑选，不必一次加入很多群。</p>
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
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
