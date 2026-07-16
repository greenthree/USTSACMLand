import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left'
import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right'
import CalendarDays from 'lucide-react/dist/esm/icons/calendar-days'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { LoadingState } from '../components/LoadingState'
import { PlatformMark } from '../components/PlatformMark'
import { RatingValue } from '../components/RatingValue'
import { StatusBadge } from '../components/StatusBadge'
import { useMembersData } from '../data/useMembersData'
import { formatDateTime, formatInteger } from '../lib/format'
import { platformUrls } from '../lib/platforms'
import { isRatingPlatform } from '../lib/ratingTiers'
import { platforms } from '../types/domain'

export function MemberPage() {
  const { memberId } = useParams()
  const { members, loading, error, demo } = useMembersData()
  const member = members.find((item) => item.id === memberId)

  if (loading) {
    return (
      <div className="page narrow-page">
        <LoadingState label="正在读取成员资料" />
      </div>
    )
  }

  if (!member) {
    return (
      <div className="page narrow-page">
        <EmptyState
          title={error ? '成员资料暂不可用' : '成员不存在'}
          description={
            error
              ? '公开成员数据读取失败，请稍后刷新重试。'
              : '该成员可能尚未完善公开资料或已被停用。'
          }
        />
      </div>
    )
  }

  return (
    <div className="page member-page">
      <Link className="back-link" to="/members">
        <ArrowLeft size={16} aria-hidden="true" />
        返回成员列表
      </Link>

      {error && demo ? (
        <p className="home-data-warning" role="status">
          实时成员资料读取失败，当前展示演示数据。
        </p>
      ) : null}

      <section className="member-profile-header">
        <span className="member-avatar member-profile-avatar">{member.name.slice(-1)}</span>
        <div>
          <div className="member-profile-title">
            <h1>{member.name}</h1>
          </div>
          <p>
            {member.major} · {member.grade}
          </p>
          <p>{member.bio}</p>
        </div>
        <div className="member-joined">
          <CalendarDays size={17} aria-hidden="true" />
          <span>{member.joinedAt} 加入</span>
        </div>
      </section>

      <section className="member-stat-section">
        <div className="section-title-row">
          <div>
            <h2>平台数据</h2>
            <p>Rating 和过题数按各平台自身口径展示。</p>
          </div>
        </div>
        <div className="platform-stat-list">
          {platforms.map((platform) => {
            const item = member.stats[platform]
            return (
              <article className="platform-stat-row" key={platform}>
                <PlatformMark platform={platform} />
                <a
                  href={platformUrls[platform](item.externalId)}
                  target="_blank"
                  rel="noreferrer"
                  className="platform-id-link"
                >
                  {item.externalId || '未绑定'}
                  {item.externalId ? <ArrowUpRight size={14} aria-hidden="true" /> : null}
                </a>
                <div className="stat-pair">
                  <span>
                    <small>当前 Rating</small>
                    {isRatingPlatform(platform) ? (
                      <RatingValue
                        className="member-rating-value"
                        platform={platform}
                        value={item.rating}
                      />
                    ) : (
                      <strong>{formatInteger(item.rating)}</strong>
                    )}
                  </span>
                  <span>
                    <small>历史最高</small>
                    {isRatingPlatform(platform) ? (
                      <RatingValue
                        className="member-rating-value"
                        platform={platform}
                        value={item.peakRating}
                      />
                    ) : (
                      <strong>{formatInteger(item.peakRating)}</strong>
                    )}
                  </span>
                  <span>
                    <small>通过题数</small>
                    <strong>{formatInteger(item.solved)}</strong>
                  </span>
                </div>
                <div className="sync-cell platform-sync-cell">
                  <StatusBadge status={item.status} />
                  <small>{formatDateTime(item.updatedAt)}</small>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
