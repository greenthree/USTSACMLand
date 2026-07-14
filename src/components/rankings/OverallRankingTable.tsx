import { Link } from 'react-router-dom'
import { formatDecimal, formatInteger } from '../../lib/format'
import { platformLabels, ratingPlatforms, solvedPlatforms } from '../../lib/platforms'
import {
  calculateOverallRating,
  calculateOverallPeakRating,
  calculateTotalSolved,
  type RatingBenchmarks,
} from '../../lib/rankings'
import type { Member } from '../../types/domain'
import { EmptyState } from '../EmptyState'

interface OverallRankingTableProps {
  members: Member[]
  metric: 'rating' | 'solved'
  ratingBenchmarks: RatingBenchmarks
  peakRatingBenchmarks: RatingBenchmarks
}

function RankNumber({ rank }: { rank: number }) {
  return <span className={rank <= 3 ? `rank-number rank-${rank}` : 'rank-number'}>{rank}</span>
}

export function OverallRankingTable({
  members,
  metric,
  ratingBenchmarks,
  peakRatingBenchmarks,
}: OverallRankingTableProps) {
  if (members.length === 0) {
    return <EmptyState title="没有匹配的成员" description="调整搜索词、专业或年级后重试。" />
  }

  const displayedPlatforms = metric === 'rating' ? ratingPlatforms : solvedPlatforms

  return (
    <div className="ranking-table-wrap">
      <table className={`ranking-table overall-ranking-table overall-${metric}-table`}>
        <thead>
          <tr>
            <th className="rank-column">排名</th>
            <th className="member-column">成员</th>
            <th className="major-column">专业</th>
            <th
              className="overall-column"
              title={metric === 'rating' ? '400 × 各平台标准化 Rating 之和' : undefined}
            >
              {metric === 'rating' ? '总 Rating' : '总通过题数'}
            </th>
            {displayedPlatforms.map((platform) => (
              <th className="number-column" key={platform}>
                {platformLabels[platform]}
              </th>
            ))}
            {metric === 'rating' ? (
              <th className="number-column" title="400 × 各平台历史最高 Rating 标准化之和">
                总历史最高 Rating
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {members.map((member, index) => {
            const overallValue =
              metric === 'rating'
                ? calculateOverallRating(member, ratingBenchmarks)
                : calculateTotalSolved(member)
            const peakOverallValue =
              metric === 'rating' ? calculateOverallPeakRating(member, peakRatingBenchmarks) : null
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
                <td
                  className="metric-value overall-column overall-value"
                  data-label={metric === 'rating' ? '总 Rating' : '总通过题数'}
                >
                  {metric === 'rating' ? formatDecimal(overallValue) : formatInteger(overallValue)}
                </td>
                {displayedPlatforms.map((platform) => {
                  const value =
                    metric === 'rating'
                      ? member.stats[platform].rating
                      : member.stats[platform].solved
                  return (
                    <td
                      className="secondary-number"
                      data-label={platformLabels[platform]}
                      key={platform}
                    >
                      {formatInteger(value)}
                    </td>
                  )
                })}
                {metric === 'rating' ? (
                  <td
                    className="secondary-number peak-overall-column"
                    data-label="总历史最高 Rating"
                  >
                    {formatDecimal(peakOverallValue)}
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
