import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right'
import { Link } from 'react-router-dom'
import { formatDateTime, formatInteger } from '../../lib/format'
import {
  platformLabels,
  platformUrls,
  solvedPlatforms,
  type RankingView,
} from '../../lib/platforms'
import {
  practiceCoverageLabels,
  type PracticeIncrementMember,
  type PracticeIncrementPlatformStat,
} from '../../lib/practiceIncrements'
import type { SolvedPlatform } from '../../types/domain'
import { EmptyState } from '../EmptyState'
import { PlatformMark } from '../PlatformMark'

interface PracticeIncrementTableProps {
  members: PracticeIncrementMember[]
  platform: RankingView
  rankOffset?: number
}

function RankNumber({ rank }: { rank: number }) {
  return <span className={rank <= 3 ? `rank-number rank-${rank}` : 'rank-number'}>{rank}</span>
}

function MemberCell({ item }: { item: PracticeIncrementMember }) {
  const { member } = item
  return (
    <Link className="member-cell" to={`/members/${member.id}`}>
      <span className="member-avatar">{member.name.slice(-1)}</span>
      <span>
        <strong title={member.name}>{member.name}</strong>
        <small>{member.grade}</small>
      </span>
    </Link>
  )
}

function IncrementValue({ stat }: { stat: PracticeIncrementPlatformStat }) {
  return (
    <span
      className={
        stat.coverageStatus === 'count_decreased'
          ? 'increment-value is-adjusted'
          : 'increment-value'
      }
      title={practiceCoverageLabels[stat.coverageStatus]}
    >
      {formatInteger(stat.delta)}
      {stat.coverageStatus === 'count_decreased' ? <small>修正</small> : null}
    </span>
  )
}

function OverallIncrementTable({
  members,
  rankOffset,
}: {
  members: PracticeIncrementMember[]
  rankOffset: number
}) {
  return (
    <div className="ranking-table-wrap">
      <table className="ranking-table overall-ranking-table overall-solved-table increment-ranking-table">
        <thead>
          <tr>
            <th className="rank-column">排名</th>
            <th className="member-column">成员</th>
            <th className="major-column">专业</th>
            <th className="overall-column">区间新增题数</th>
            {solvedPlatforms.map((platform) => (
              <th className="number-column" key={platform}>
                {platformLabels[platform]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((item, index) => {
            const rank = rankOffset + index + 1
            return (
              <tr key={item.member.id}>
                <td data-label="排名">
                  <RankNumber rank={rank} />
                </td>
                <td className="member-column" data-label="成员">
                  <MemberCell item={item} />
                </td>
                <td className="major-column" data-label="专业">
                  <span className="major-text" title={item.member.major}>
                    {item.member.major}
                  </span>
                </td>
                <td className="metric-value overall-column overall-value" data-label="区间新增题数">
                  <span className="increment-total">
                    {formatInteger(item.totalDelta)}
                    <small>
                      {item.boundPlatformCount === 0
                        ? '暂无绑定'
                        : `${item.measuredPlatformCount}/${item.boundPlatformCount} 个平台`}
                    </small>
                  </span>
                </td>
                {solvedPlatforms.map((platform) => (
                  <td
                    className="secondary-number"
                    data-label={platformLabels[platform]}
                    key={platform}
                  >
                    <IncrementValue stat={item.stats[platform]} />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PlatformIncrementTable({
  members,
  platform,
  rankOffset,
}: {
  members: PracticeIncrementMember[]
  platform: SolvedPlatform
  rankOffset: number
}) {
  return (
    <div className="ranking-table-wrap">
      <table className="ranking-table increment-platform-table">
        <thead>
          <tr>
            <th className="rank-column">排名</th>
            <th className="member-column">成员</th>
            <th className="major-column">专业</th>
            <th className="account-column">平台账号</th>
            <th className="number-column">新增通过题数</th>
            <th className="number-column">区间末累计</th>
            <th className="status-column">数据覆盖</th>
          </tr>
        </thead>
        <tbody>
          {members.map((item, index) => {
            const rank = rankOffset + index + 1
            const current = item.member.stats[platform]
            const increment = item.stats[platform]
            return (
              <tr key={item.member.id}>
                <td data-label="排名">
                  <RankNumber rank={rank} />
                </td>
                <td className="member-column" data-label="成员">
                  <MemberCell item={item} />
                </td>
                <td className="major-column" data-label="专业">
                  <span className="major-text" title={item.member.major}>
                    {item.member.major}
                  </span>
                </td>
                <td className="account-column" data-label="平台账号">
                  {current.externalId ? (
                    <a
                      className="external-account"
                      href={platformUrls[platform](current.externalId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <PlatformMark platform={platform} withLabel={false} />
                      <span className="external-account-id" title={current.externalId}>
                        {current.externalId}
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
                <td className="metric-value" data-label="新增通过题数">
                  <IncrementValue stat={increment} />
                </td>
                <td className="secondary-number" data-label="区间末累计">
                  {formatInteger(increment.endCount)}
                </td>
                <td className="status-column" data-label="数据覆盖">
                  <div className="increment-coverage">
                    <span className={`increment-coverage-badge is-${increment.coverageStatus}`}>
                      {practiceCoverageLabels[increment.coverageStatus]}
                    </span>
                    {increment.endAt ? <small>{formatDateTime(increment.endAt)}</small> : null}
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

export function PracticeIncrementTable({
  members,
  platform,
  rankOffset = 0,
}: PracticeIncrementTableProps) {
  if (members.length === 0) {
    return <EmptyState title="没有匹配的成员" description="调整搜索词、专业、年级或平台后重试。" />
  }
  if (platform === 'overall') {
    return <OverallIncrementTable members={members} rankOffset={rankOffset} />
  }
  return (
    <PlatformIncrementTable
      members={members}
      platform={platform as SolvedPlatform}
      rankOffset={rankOffset}
    />
  )
}
