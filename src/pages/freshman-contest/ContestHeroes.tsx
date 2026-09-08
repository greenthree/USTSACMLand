import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
import { Link } from 'react-router-dom'
import { contestLogoUrl } from './freshmanContestData'

export interface ContestHeroProps {
  active: boolean
}

export function FreshmanHero({ active }: ContestHeroProps) {
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

export function PracticeHero({ active }: ContestHeroProps) {
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
            <a
              className="freshman-contest-secondary-action"
              href="https://usts.fun/training/20"
              target="_blank"
              rel="noreferrer"
              tabIndex={active ? undefined : -1}
            >
              往届题目入口
            </a>
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

export function SchoolHero({ active }: ContestHeroProps) {
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
            <a
              className="freshman-contest-secondary-action"
              href="https://usts.fun/training/21"
              target="_blank"
              rel="noreferrer"
              tabIndex={active ? undefined : -1}
            >
              往届题目入口
            </a>
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
