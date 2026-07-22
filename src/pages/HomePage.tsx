import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
import BookOpenCheck from 'lucide-react/dist/esm/icons/book-open-check'
import Braces from 'lucide-react/dist/esm/icons/braces'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days'
import MessagesSquare from 'lucide-react/dist/esm/icons/messages-square'
import Monitor from 'lucide-react/dist/esm/icons/monitor'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check'
import Timer from 'lucide-react/dist/esm/icons/timer'
import Trophy from 'lucide-react/dist/esm/icons/trophy'
import Users from 'lucide-react/dist/esm/icons/users'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/authContextValue'
import { PlatformMark } from '../components/PlatformMark'
import { useMembersData } from '../data/useMembersData'
import { webChatUiEnabled } from '../features/chat/chatAvailability'
import { formatInteger } from '../lib/format'
import { platformLabels, ratingPlatforms, solvedPlatforms } from '../lib/platforms'
import { calculateTotalSolved } from '../lib/rankings'

const icpcLogoUrl = `${import.meta.env.BASE_URL}icpc-foundation.png`

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
            <p className="home-eyebrow">苏州科技大学 ACM 集训队官网</p>
            <h1 id="home-title">USTS ACM Land</h1>
            <p className="home-hero-lead">
              这里是苏州科技大学 ACM
              集训队的线上主页，记录队伍、训练与共同成长，并逐步提供学习引导、每日一题和 AI
              学习助手，让知识、实践与交流在同一处发生。
            </p>
            <div className="home-hero-actions">
              <a className="home-primary-action" href="#about-acm">
                了解集训队与 ACM
                <ArrowRight size={17} aria-hidden="true" />
              </a>
              <Link className="home-secondary-action" to="/learning">
                <BookOpenCheck size={17} aria-hidden="true" />
                新手入门
              </Link>
            </div>
          </div>

          <div className="contest-brief" aria-label="ACM 竞赛基本形式">
            <p className="contest-brief-label">ICPC / CCPC 赛制速览</p>
            <div className="contest-brief-items">
              <div>
                <Users size={18} aria-hidden="true" />
                <strong>三人一队</strong>
                <span>共同分析与分工</span>
              </div>
              <div>
                <Timer size={18} aria-hidden="true" />
                <strong>五小时</strong>
                <span>持续判断与取舍</span>
              </div>
              <div>
                <Monitor size={18} aria-hidden="true" />
                <strong>一台电脑</strong>
                <span>共享编码与调试</span>
              </div>
            </div>
          </div>
        </div>
        <div className="home-hero-index" aria-hidden="true">
          <span>01</span>
          <span>ALGORITHM</span>
          <span>TEAMWORK</span>
          <span>CONTEST</span>
        </div>
      </section>

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
          <div className="home-competition-list" aria-label="主要算法竞赛简介">
            <article>
              <span className="home-competition-number">01</span>
              <div>
                <strong>ICPC</strong>
                <small>国际大学生程序设计竞赛</small>
              </div>
              <p>面向全球高校的三人团队赛，经区域赛晋级全球总决赛。</p>
              <span className="home-competition-type">团队赛 · 国际</span>
            </article>
            <article>
              <span className="home-competition-number">02</span>
              <div>
                <strong>CCPC</strong>
                <small>中国大学生程序设计竞赛</small>
              </div>
              <p>国内高水平三人团队赛事，设分站赛、女生专场和总决赛等竞赛阶段。</p>
              <span className="home-competition-type">团队赛 · 全国</span>
            </article>
            <article>
              <span className="home-competition-number">03</span>
              <div>
                <strong>华为杯 JSCPC</strong>
                <small>江苏省大学生程序设计大赛</small>
              </div>
              <p>面向江苏高校的省级程序设计赛事，以团队协作完成算法题目。</p>
              <span className="home-competition-type">团队赛 · 省级</span>
            </article>
            <article>
              <span className="home-competition-number">04</span>
              <div>
                <strong>蓝桥杯</strong>
                <small>全国软件和信息技术专业人才大赛</small>
              </div>
              <p>按组别开展的个人程序设计竞赛，覆盖省赛与全国总决赛。</p>
              <span className="home-competition-type">个人赛 · 全国</span>
            </article>
            <article>
              <span className="home-competition-number">05</span>
              <div>
                <strong>天梯赛</strong>
                <small>中国高校计算机大赛团体程序设计天梯赛</small>
              </div>
              <p>选手独立答题、成绩按团队汇总，兼顾个人能力与学校整体实力。</p>
              <span className="home-competition-type">团体计分 · 全国</span>
            </article>
            <article>
              <span className="home-competition-number">06</span>
              <div>
                <strong>百度之星</strong>
                <small>程序设计大赛</small>
              </div>
              <p>面向高校选手与开发者的个人算法竞赛，强调在线解题和综合编程能力。</p>
              <span className="home-competition-type">个人赛 · 全国</span>
            </article>
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
            <div className="home-open-contests-platforms" aria-label="主要线上公开赛平台">
              {(['codeforces', 'atcoder', 'nowcoder', 'luogu', 'qoj'] as const).map(
                (platform, index) => (
                  <div key={platform}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <PlatformMark platform={platform} />
                    <small>公开赛与练习</small>
                  </div>
                ),
              )}
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
          <div className="home-vision-list" aria-label="学习功能">
            <article>
              <BookOpenCheck size={21} aria-hidden="true" />
              <div>
                <h3>学习引导</h3>
                <p>按知识点组织学习路线、资料与阶段目标。</p>
              </div>
              <Link to="/learning" aria-label="进入新手学习引导">
                已上线
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </article>
            <article>
              <CalendarDays size={21} aria-hidden="true" />
              <div>
                <h3>每日一题</h3>
                <p>提供稳定的日常练习入口与题目讨论。</p>
              </div>
              <Link to="/daily-problem" aria-label="进入每日一题">
                已上线
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </article>
            <article>
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
                <Link to="/assistant" aria-label="进入 AI 学习助手">
                  已上线
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
            榜单用于观察长期训练投入和平台表现，是集训队官网的一部分，而不是衡量成员的唯一标准。
          </p>
          <div className="home-data-summary" aria-label="公开数据概览">
            <span>
              <strong>{loading ? '--' : formatInteger(totalSolvedCount)}</strong> 累计通过题数
            </span>
            <small>{demo ? '当前为演示数据' : '公开数据源'}</small>
          </div>
          <Link className="home-section-link" to="/rankings">
            查看完整榜单
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        {error ? <p className="home-data-warning">实时数据读取失败，当前展示演示数据。</p> : null}
        <div className="home-platform-body">
          <div className="home-platform-list" aria-label="统计平台">
            {Object.entries(platformLabels).map(([platform, label], index) => (
              <div key={platform}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{label}</strong>
                <small>
                  {ratingPlatforms.includes(platform as (typeof ratingPlatforms)[number])
                    ? 'Rating'
                    : null}
                  {ratingPlatforms.includes(platform as (typeof ratingPlatforms)[number]) &&
                  solvedPlatforms.includes(platform as (typeof solvedPlatforms)[number])
                    ? ' / '
                    : null}
                  {solvedPlatforms.includes(platform as (typeof solvedPlatforms)[number])
                    ? '通过题数'
                    : null}
                </small>
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
          <p className="home-join-lead">
            集训队每年通过三场面向不同人群的比赛选拔成员。无需提前加入，先来参加比赛，在真实题目和有限时间里展示自己的思路与潜力。
          </p>
          <div className="home-join-events">
            <article>
              <span className="home-join-month">12 月</span>
              <div>
                <h3>新生赛</h3>
                <p className="home-join-target">面向新生</p>
                <p>选拔新生进入集训队，开始更高强度、更系统的算法训练。</p>
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
