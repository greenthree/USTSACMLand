import Search from 'lucide-react/dist/esm/icons/search'
import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { LoadingState } from '../components/LoadingState'
import { MemberAvatar } from '../components/MemberAvatar'
import { PlatformMark } from '../components/PlatformMark'
import { useMembersData } from '../data/useMembersData'
import { formatInteger } from '../lib/format'

export function MembersPage() {
  const { members: sourceMembers, loading, error } = useMembersData()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const members = useMemo(
    () =>
      sourceMembers.filter(
        (member) =>
          deferredQuery.length === 0 ||
          member.name.includes(deferredQuery) ||
          member.major.includes(deferredQuery) ||
          member.grade.includes(deferredQuery),
      ),
    [deferredQuery, sourceMembers],
  )

  return (
    <div className="page members-page">
      <section className="page-heading members-heading">
        <div>
          <h1>成员</h1>
          <p>资料完整成员的竞赛账号和最新公开统计。</p>
        </div>
        <label className="search-field wide-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">搜索成员、专业或年级</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索成员、专业或年级"
          />
        </label>
      </section>

      {loading && sourceMembers.length === 0 ? (
        <LoadingState label="正在读取成员列表" />
      ) : members.length === 0 ? (
        <EmptyState
          title={query.trim() ? '未找到匹配成员' : error ? '成员列表暂不可用' : '暂无成员'}
          description={
            query.trim()
              ? '尝试使用其他姓名、专业或年级关键词重新搜索。'
              : error
                ? '公开成员数据读取失败，请稍后刷新重试。'
                : '当前还没有已公开的集训队成员。'
          }
        />
      ) : (
        <section className="member-list" aria-label="成员列表">
          {members.map((member) => (
            <Link className="member-list-item" to={`/members/${member.id}`} key={member.id}>
              <MemberAvatar
                name={member.name}
                avatarUrl={member.avatarUrl}
                className="member-avatar-large"
              />
              <span className="member-list-main">
                <span className="member-title-line">
                  <strong>{member.name}</strong>
                  <small>{member.grade}</small>
                </span>
                <span>{member.major}</span>
                <small>{member.bio}</small>
              </span>
              <span className="member-platform-summary">
                <span>
                  <PlatformMark platform="codeforces" withLabel={false} />
                  <strong>{formatInteger(member.stats.codeforces.rating)}</strong>
                </span>
                <span>
                  <PlatformMark platform="qoj" withLabel={false} />
                  <strong>{formatInteger(member.stats.qoj.solved)}</strong>
                </span>
              </span>
            </Link>
          ))}
        </section>
      )}
    </div>
  )
}
