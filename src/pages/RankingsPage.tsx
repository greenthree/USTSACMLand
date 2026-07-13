import Clock3 from 'lucide-react/dist/esm/icons/clock-3'
import Search from 'lucide-react/dist/esm/icons/search'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal'
import { useDeferredValue, useMemo, useState } from 'react'
import { LoadingState } from '../components/LoadingState'
import { MetricTabs } from '../components/MetricTabs'
import { OverallRankingTable } from '../components/rankings/OverallRankingTable'
import { RankingTable } from '../components/rankings/RankingTable'
import { useMembersData } from '../data/useMembersData'
import {
  ratingPlatforms,
  ratingRankingViews,
  solvedPlatforms,
  solvedRankingViews,
  type RankingView,
} from '../lib/platforms'
import {
  calculateOverallRating,
  calculateRatingBenchmarks,
  calculateTotalSolved,
} from '../lib/rankings'

type MetricMode = 'rating' | 'solved'

export function RankingsPage() {
  const { members: sourceMembers, loading, error, demo } = useMembersData()
  const [mode, setMode] = useState<MetricMode>('rating')
  const [ratingPlatform, setRatingPlatform] = useState<RankingView>('overall')
  const [solvedPlatform, setSolvedPlatform] = useState<RankingView>('overall')
  const [query, setQuery] = useState('')
  const [major, setMajor] = useState('全部专业')
  const [grade, setGrade] = useState('全部年级')
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase('zh-CN'))
  const platform = mode === 'rating' ? ratingPlatform : solvedPlatform
  const platformOptions = mode === 'rating' ? ratingRankingViews : solvedRankingViews
  const metricPlatforms = mode === 'rating' ? ratingPlatforms : solvedPlatforms
  const ratingBenchmarks = useMemo(() => calculateRatingBenchmarks(sourceMembers), [sourceMembers])
  const majors = useMemo(
    () => ['全部专业', ...Array.from(new Set(sourceMembers.map((member) => member.major)))],
    [sourceMembers],
  )
  const grades = useMemo(
    () => [
      '全部年级',
      ...Array.from(new Set(sourceMembers.map((member) => member.grade))).sort((left, right) => {
        const leftYear = /^([0-9]{2})级$/.exec(left)?.[1]
        const rightYear = /^([0-9]{2})级$/.exec(right)?.[1]
        if (leftYear && rightYear) return Number(rightYear) - Number(leftYear)
        if (leftYear) return -1
        if (rightYear) return 1
        return left.localeCompare(right, 'zh-CN')
      }),
    ],
    [sourceMembers],
  )

  const members = useMemo(() => {
    const metricKey = mode === 'rating' ? 'rating' : 'solved'
    const filtered = sourceMembers.filter((member) => {
      const matchesQuery =
        deferredQuery.length === 0 ||
        member.name.toLocaleLowerCase('zh-CN').includes(deferredQuery) ||
        metricPlatforms.some((item) =>
          member.stats[item].externalId.toLocaleLowerCase().includes(deferredQuery),
        )
      const matchesMajor = major === '全部专业' || member.major === major
      const matchesGrade = grade === '全部年级' || member.grade === grade
      return matchesQuery && matchesMajor && matchesGrade
    })
    return [...filtered].sort((left, right) => {
      const leftValue =
        platform === 'overall'
          ? mode === 'rating'
            ? calculateOverallRating(left, ratingBenchmarks)
            : calculateTotalSolved(left)
          : (left.stats[platform][metricKey] ?? -1)
      const rightValue =
        platform === 'overall'
          ? mode === 'rating'
            ? calculateOverallRating(right, ratingBenchmarks)
            : calculateTotalSolved(right)
          : (right.stats[platform][metricKey] ?? -1)
      const valueDifference = (rightValue ?? -1) - (leftValue ?? -1)
      return valueDifference === 0 ? left.name.localeCompare(right.name, 'zh-CN') : valueDifference
    })
  }, [
    deferredQuery,
    grade,
    major,
    metricPlatforms,
    mode,
    platform,
    ratingBenchmarks,
    sourceMembers,
  ])

  function handleModeChange(nextMode: MetricMode) {
    setMode(nextMode)
  }

  function handlePlatformChange(nextPlatform: RankingView) {
    if (mode === 'rating') setRatingPlatform(nextPlatform)
    else setSolvedPlatform(nextPlatform)
  }

  return (
    <div className="page rankings-page">
      <section className="page-heading rankings-heading">
        <div>
          <h1>{mode === 'rating' ? 'Rating 榜' : '刷题榜'}</h1>
          <p>所有指标按平台独立统计，失败时保留最后一次成功结果。</p>
        </div>
        <div className="updated-at">
          <Clock3 size={16} aria-hidden="true" />
          <span>{demo ? '演示数据' : '数据更新于最新成功同步'}</span>
        </div>
      </section>

      {error ? <p className="data-warning">实时数据读取失败，当前显示演示数据。</p> : null}

      <section className="ranking-workspace" aria-label="榜单筛选与数据">
        <div className="ranking-toolbar">
          <div className="segmented-control" aria-label="榜单模式">
            <button
              type="button"
              className={mode === 'rating' ? 'is-active' : undefined}
              onClick={() => handleModeChange('rating')}
            >
              Rating 榜
            </button>
            <button
              type="button"
              className={mode === 'solved' ? 'is-active' : undefined}
              onClick={() => handleModeChange('solved')}
            >
              刷题榜
            </button>
          </div>

          <div className="filter-group">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">搜索成员</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索成员"
              />
            </label>
            <label className="select-field">
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span className="sr-only">专业筛选</span>
              <select value={major} onChange={(event) => setMajor(event.target.value)}>
                {majors.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="select-field grade-filter">
              <span className="sr-only">年级筛选</span>
              <select value={grade} onChange={(event) => setGrade(event.target.value)}>
                {grades.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <MetricTabs platforms={platformOptions} value={platform} onChange={handlePlatformChange} />
        {loading ? (
          <LoadingState label="正在读取公开榜单" />
        ) : platform === 'overall' ? (
          <OverallRankingTable
            members={members}
            metric={mode}
            ratingBenchmarks={ratingBenchmarks}
          />
        ) : (
          <RankingTable members={members} platform={platform} metric={mode} />
        )}
      </section>
    </div>
  )
}
