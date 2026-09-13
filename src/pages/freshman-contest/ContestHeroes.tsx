import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
import { contestLogoUrl } from './freshmanContestData'

export interface ContestHeroProps {
  active: boolean
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
            <span>USTS ACM / MARCH · 3月</span>
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
            <span>USTS ACM / NOVEMBER · 11月</span>
            <span>面向全校学生</span>
          </div>
          <p className="freshman-contest-edition">苏州科技大学程序设计校赛</p>
          <Heading id="school-contest-title">校赛</Heading>
          <p className="freshman-contest-intro">
            一人一台电脑，三小时独立解题。校赛采用 ACM
            计分规则，按通过题数与总罚时排名，考验算法、实现与赛场决策。
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
            <span>ACM INDIVIDUAL CONTEST</span>
          </div>
          <strong className="freshman-contest-clock">03:00:00</strong>
          <div className="freshman-contest-scoreboard-meta">
            <span>单人赛</span>
            <span>一人一台电脑</span>
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
