import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right'
import { Link } from 'react-router-dom'
import { formatDateTime, formatInteger } from '../../lib/format'
import { platformLabels, platformUrls } from '../../lib/platforms'
import type { Member, Platform } from '../../types/domain'
import { EmptyState } from '../EmptyState'
import { PlatformMark } from '../PlatformMark'
import { StatusBadge } from '../StatusBadge'

interface RankingTableProps {
  members: Member[]
  platform: Platform
  metric: 'rating' | 'solved'
}

function RankNumber({ rank }: { rank: number }) {
  return <span className={rank <= 3 ? `rank-number rank-${rank}` : 'rank-number'}>{rank}</span>
}

export function RankingTable({ members, platform, metric }: RankingTableProps) {
  if (members.length === 0) {
    return <EmptyState title="没有匹配的成员" description="调整搜索词、专业、年级或平台后重试。" />
  }

  const accountColumnLabel = platform === 'xcpc_elo' ? '匹配姓名' : '平台账号'

  return (
    <div className="ranking-table-wrap">
      <table
        className={metric === 'rating' ? 'ranking-table rating-ranking-table' : 'ranking-table'}
      >
        <thead>
          <tr>
            <th className="rank-column">排名</th>
            <th className="member-column">成员</th>
            <th className="major-column">专业</th>
            <th className="account-column">{accountColumnLabel}</th>
            <th className="number-column">{metric === 'rating' ? '当前分' : '通过题数'}</th>
            {metric === 'rating' ? <th className="number-column">历史最高</th> : null}
            <th className="status-column">数据状态</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member, index) => {
            const current = member.stats[platform]
            const accountLabel = platform === 'xcpc_elo' ? member.name : current.externalId
            return (
              <tr key={member.id}>
                <td data-label="排名">
                  <RankNumber rank={index + 1} />
                </td>
                <td className="member-column" data-label="成员">
                  <Link className="member-cell" to={`/members/${member.id}`}>
                    <span className="member-avatar">{member.name.slice(-1)}</span>
                    <span>
                      <strong title={member.name}>{member.name}</strong>
                      <small>{member.grade}</small>
                    </span>
                  </Link>
                </td>
                <td className="major-column" data-label="专业">
                  <span className="major-text" title={member.major}>
                    {member.major}
                  </span>
                </td>
                <td className="account-column" data-label={accountColumnLabel}>
                  {accountLabel ? (
                    <a
                      className="external-account"
                      href={platformUrls[platform](current.externalId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <PlatformMark platform={platform} withLabel={false} />
                      <span className="external-account-id" title={accountLabel}>
                        {accountLabel}
                      </span>
                      <ArrowUpRight
                        size={14}
                        aria-label={`打开 ${platformLabels[platform]} 主页`}
                      />
                    </a>
                  ) : (
                    '--'
                  )}
                </td>
                <td
                  className="metric-value"
                  data-label={metric === 'rating' ? '当前分' : '通过题数'}
                >
                  {formatInteger(metric === 'rating' ? current.rating : current.solved)}
                </td>
                {metric === 'rating' ? (
                  <td className="secondary-number" data-label="历史最高">
                    {formatInteger(current.peakRating)}
                  </td>
                ) : null}
                <td className="status-column" data-label="数据状态">
                  <div className="sync-cell">
                    <StatusBadge status={current.status} />
                    <small>{formatDateTime(current.updatedAt)}</small>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
