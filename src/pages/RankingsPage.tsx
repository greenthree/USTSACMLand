import Clock3 from 'lucide-react/dist/esm/icons/clock-3'
import Search from 'lucide-react/dist/esm/icons/search'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal'
import type { FormEvent } from 'react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { LoadingState } from '../components/LoadingState'
import { MetricTabs } from '../components/MetricTabs'
import { OverallRankingTable } from '../components/rankings/OverallRankingTable'
import { PracticeIncrementTable } from '../components/rankings/PracticeIncrementTable'
import { RankingTable } from '../components/rankings/RankingTable'
import { loadPublicPracticeIncrements } from '../data/practiceIncrementRankings'
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
  calculatePeakRatingBenchmarks,
  calculateRatingBenchmarks,
  calculateTotalSolved,
} from '../lib/rankings'
import {
  buildPracticeIncrementMembers,
  createDemoPracticeIncrementRecords,
  currentBeijingDate,
  formatPracticeDateRange,
  practicePresetRange,
  validatePracticeDateRange,
  type PracticeDateRange,
  type PracticeIncrementRecord,
  type PracticeRangeMode,
} from '../lib/practiceIncrements'
import type { SolvedPlatform } from '../types/domain'

type MetricMode = 'rating' | 'solved'
type PaginationItem = number | 'ellipsis-left' | 'ellipsis-right'

const pageSizeOptions = [25, 50, 100] as const

function getPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  if (currentPage <= 4) return [1, 2, 3, 4, 5, 'ellipsis-right', totalPages]
  if (currentPage >= totalPages - 3) {
    return [
      1,
      'ellipsis-left',
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ]
  }
  return [
    1,
    'ellipsis-left',
    currentPage - 1,
    currentPage,
    currentPage + 1,
    'ellipsis-right',
    totalPages,
  ]
}

export function RankingsPage() {
  const { members: sourceMembers, loading, error, demo } = useMembersData()
  const [beijingToday] = useState(() => currentBeijingDate())
  const [customRange, setCustomRange] = useState<PracticeDateRange>(() =>
    practicePresetRange('week', currentBeijingDate()),
  )
  const [mode, setMode] = useState<MetricMode>('rating')
  const [ratingPlatform, setRatingPlatform] = useState<RankingView>('overall')
  const [solvedPlatform, setSolvedPlatform] = useState<RankingView>('overall')
  const [practiceRangeMode, setPracticeRangeMode] = useState<PracticeRangeMode>('lifetime')
  const [activePracticeRange, setActivePracticeRange] = useState<PracticeDateRange | null>(null)
  const [practiceRangeError, setPracticeRangeError] = useState('')
  const [incrementRows, setIncrementRows] = useState<PracticeIncrementRecord[]>([])
  const [incrementLoading, setIncrementLoading] = useState(false)
  const [incrementError, setIncrementError] = useState('')
  const [incrementRequestVersion, setIncrementRequestVersion] = useState(0)
  const [query, setQuery] = useState('')
  const [major, setMajor] = useState('全部专业')
  const [grade, setGrade] = useState('全部年级')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof pageSizeOptions)[number]>(25)
  const resultsRef = useRef<HTMLDivElement>(null)
  const shouldFocusResultsRef = useRef(false)
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase('zh-CN'))
  const platform = mode === 'rating' ? ratingPlatform : solvedPlatform
  const platformOptions = mode === 'rating' ? ratingRankingViews : solvedRankingViews
  const metricPlatforms = mode === 'rating' ? ratingPlatforms : solvedPlatforms
  const incrementRankingActive = mode === 'solved' && practiceRangeMode !== 'lifetime'
  const ratingBenchmarks = useMemo(() => calculateRatingBenchmarks(sourceMembers), [sourceMembers])
  const peakRatingBenchmarks = useMemo(
    () => calculatePeakRatingBenchmarks(sourceMembers),
    [sourceMembers],
  )

  useEffect(() => {
    if (!incrementRankingActive || !activePracticeRange) {
      setIncrementLoading(false)
      setIncrementError('')
      return
    }

    const controller = new AbortController()
    let disposed = false
    setIncrementLoading(true)
    setIncrementError('')

    const request = demo
      ? Promise.resolve(createDemoPracticeIncrementRecords(sourceMembers))
      : loadPublicPracticeIncrements(activePracticeRange, controller.signal)

    request
      .then((rows) => {
        if (!disposed) setIncrementRows(rows)
      })
      .catch((requestError: unknown) => {
        if (disposed || controller.signal.aborted) return
        setIncrementRows([])
        setIncrementError(
          requestError instanceof Error ? requestError.message : '刷题增量读取失败，请稍后重试。',
        )
      })
      .finally(() => {
        if (!disposed) setIncrementLoading(false)
      })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [activePracticeRange, demo, incrementRankingActive, incrementRequestVersion, sourceMembers])
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

  const filteredSourceMembers = useMemo(
    () =>
      sourceMembers.filter((member) => {
        const matchesQuery =
          deferredQuery.length === 0 ||
          member.name.toLocaleLowerCase('zh-CN').includes(deferredQuery) ||
          metricPlatforms.some((item) =>
            member.stats[item].externalId.toLocaleLowerCase().includes(deferredQuery),
          )
        const matchesMajor = major === '全部专业' || member.major === major
        const matchesGrade = grade === '全部年级' || member.grade === grade
        return matchesQuery && matchesMajor && matchesGrade
      }),
    [deferredQuery, grade, major, metricPlatforms, sourceMembers],
  )

  const currentMembers = useMemo(() => {
    const metricKey = mode === 'rating' ? 'rating' : 'solved'
    return [...filteredSourceMembers].sort((left, right) => {
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
  }, [filteredSourceMembers, mode, platform, ratingBenchmarks])

  const incrementMembers = useMemo(() => {
    if (!incrementRankingActive) return []
    const filteredIds = new Set(filteredSourceMembers.map((member) => member.id))
    return buildPracticeIncrementMembers(sourceMembers, incrementRows)
      .filter((item) => filteredIds.has(item.member.id))
      .sort((left, right) => {
        const leftValue =
          platform === 'overall' ? left.totalDelta : left.stats[platform as SolvedPlatform].delta
        const rightValue =
          platform === 'overall' ? right.totalDelta : right.stats[platform as SolvedPlatform].delta
        const valueDifference = (rightValue ?? -1) - (leftValue ?? -1)
        if (valueDifference !== 0) return valueDifference
        if (platform === 'overall') {
          const coverageDifference = right.measuredPlatformCount - left.measuredPlatformCount
          if (coverageDifference !== 0) return coverageDifference
        }
        return left.member.name.localeCompare(right.member.name, 'zh-CN')
      })
  }, [filteredSourceMembers, incrementRankingActive, incrementRows, platform, sourceMembers])

  const rankingMemberCount = incrementRankingActive
    ? incrementMembers.length
    : currentMembers.length
  const totalPages = Math.max(1, Math.ceil(rankingMemberCount / pageSize))
  const currentPage = Math.min(page, totalPages)
  const rankOffset = (currentPage - 1) * pageSize
  const pagedCurrentMembers = useMemo(
    () => currentMembers.slice(rankOffset, rankOffset + pageSize),
    [currentMembers, pageSize, rankOffset],
  )
  const pagedIncrementMembers = useMemo(
    () => incrementMembers.slice(rankOffset, rankOffset + pageSize),
    [incrementMembers, pageSize, rankOffset],
  )
  const paginationItems = useMemo(
    () => getPaginationItems(currentPage, totalPages),
    [currentPage, totalPages],
  )

  useEffect(() => {
    setPage((previousPage) => Math.min(previousPage, totalPages))
  }, [totalPages])

  useEffect(() => {
    if (!shouldFocusResultsRef.current) return
    shouldFocusResultsRef.current = false
    resultsRef.current?.focus({ preventScroll: true })
    resultsRef.current?.scrollIntoView?.({ block: 'start' })
  }, [currentPage])

  function resetPage() {
    setPage(1)
  }

  function handlePageChange(nextPage: number) {
    const safePage = Math.min(Math.max(nextPage, 1), totalPages)
    if (safePage === currentPage) return
    shouldFocusResultsRef.current = true
    setPage(safePage)
  }

  function handleModeChange(nextMode: MetricMode) {
    setMode(nextMode)
    resetPage()
  }

  function handlePlatformChange(nextPlatform: RankingView) {
    if (mode === 'rating') setRatingPlatform(nextPlatform)
    else setSolvedPlatform(nextPlatform)
    resetPage()
  }

  function applyPracticeRange(nextRange: PracticeDateRange) {
    const validationError = validatePracticeDateRange(nextRange, beijingToday)
    setPracticeRangeError(validationError ?? '')
    if (validationError) return false
    setActivePracticeRange(nextRange)
    resetPage()
    return true
  }

  function handlePracticeRangeModeChange(nextMode: PracticeRangeMode) {
    setPracticeRangeMode(nextMode)
    setPracticeRangeError('')
    if (nextMode === 'lifetime') {
      setActivePracticeRange(null)
      resetPage()
      return
    }
    if (nextMode === 'week' || nextMode === 'month') {
      applyPracticeRange(practicePresetRange(nextMode, beijingToday))
      return
    }
    applyPracticeRange(customRange)
  }

  function handleCustomRangeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    applyPracticeRange(customRange)
  }

  const practiceRangeLabel = activePracticeRange ? formatPracticeDateRange(activePracticeRange) : ''
  const rankingLoading = loading || (incrementRankingActive && incrementLoading)

  return (
    <div className="page rankings-page">
      <section className="page-heading rankings-heading">
        <div>
          <h1>
            {mode === 'rating' ? 'Rating 榜' : incrementRankingActive ? '刷题增量榜' : '刷题榜'}
          </h1>
          <p>
            {incrementRankingActive
              ? '按成功同步的累计题数快照计算区间增量，失败同步不会改变榜单。'
              : '所有指标按平台独立统计，失败时保留最后一次成功结果。'}
          </p>
        </div>
        <div className="updated-at">
          <Clock3 size={16} aria-hidden="true" />
          <span>
            {demo
              ? '演示数据'
              : incrementRankingActive
                ? '按北京时间同步快照计算'
                : '数据更新于最新成功同步'}
          </span>
        </div>
      </section>

      {error ? <p className="data-warning">实时数据读取失败，当前显示演示数据。</p> : null}

      <section className="ranking-workspace" aria-label="榜单筛选与数据">
        <div className="ranking-toolbar">
          <div className="segmented-control" aria-label="榜单模式">
            <button
              type="button"
              className={mode === 'rating' ? 'is-active' : undefined}
              aria-pressed={mode === 'rating'}
              onClick={() => handleModeChange('rating')}
            >
              Rating 榜
            </button>
            <button
              type="button"
              className={mode === 'solved' ? 'is-active' : undefined}
              aria-pressed={mode === 'solved'}
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
                onChange={(event) => {
                  setQuery(event.target.value)
                  resetPage()
                }}
                placeholder="搜索成员"
              />
            </label>
            <label className="select-field">
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span className="sr-only">专业筛选</span>
              <select
                value={major}
                onChange={(event) => {
                  setMajor(event.target.value)
                  resetPage()
                }}
              >
                {majors.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="select-field grade-filter">
              <span className="sr-only">年级筛选</span>
              <select
                value={grade}
                onChange={(event) => {
                  setGrade(event.target.value)
                  resetPage()
                }}
              >
                {grades.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {mode === 'solved' ? (
          <div className="ranking-period-toolbar" aria-label="刷题榜统计范围">
            <div className="ranking-period-presets" role="group" aria-label="选择刷题统计范围">
              {(
                [
                  ['lifetime', '累计总数'],
                  ['week', '本周'],
                  ['month', '本月'],
                  ['custom', '自定义'],
                ] as const
              ).map(([rangeMode, label]) => (
                <button
                  type="button"
                  className={practiceRangeMode === rangeMode ? 'is-active' : undefined}
                  aria-pressed={practiceRangeMode === rangeMode}
                  key={rangeMode}
                  onClick={() => handlePracticeRangeModeChange(rangeMode)}
                >
                  {label}
                </button>
              ))}
            </div>

            {practiceRangeMode === 'custom' ? (
              <form className="ranking-custom-range" onSubmit={handleCustomRangeSubmit}>
                <label>
                  <span>开始日期</span>
                  <input
                    type="date"
                    max={beijingToday}
                    value={customRange.startDate}
                    onChange={(event) => {
                      setCustomRange((current) => ({
                        ...current,
                        startDate: event.target.value,
                      }))
                      setPracticeRangeError('')
                    }}
                  />
                </label>
                <span aria-hidden="true">至</span>
                <label>
                  <span>结束日期</span>
                  <input
                    type="date"
                    max={beijingToday}
                    value={customRange.endDate}
                    onChange={(event) => {
                      setCustomRange((current) => ({
                        ...current,
                        endDate: event.target.value,
                      }))
                      setPracticeRangeError('')
                    }}
                  />
                </label>
                <button type="submit">应用范围</button>
              </form>
            ) : null}

            {practiceRangeError ? (
              <p className="ranking-period-error" role="alert">
                {practiceRangeError}
              </p>
            ) : incrementRankingActive && activePracticeRange ? (
              <p className="ranking-period-summary" aria-live="polite">
                <strong>{practiceRangeLabel}</strong>
                <span>北京时间；仅统计区间前有基线且区间内有成功观测的平台。</span>
              </p>
            ) : (
              <p className="ranking-period-summary">
                显示各平台当前累计通过题数；可切换本周、本月或自定义增量榜。
              </p>
            )}
          </div>
        ) : null}

        <MetricTabs
          platforms={platformOptions}
          value={platform}
          onChange={handlePlatformChange}
          panelId="ranking-results-panel"
        />
        <div
          id="ranking-results-panel"
          className="ranking-results"
          ref={resultsRef}
          role="tabpanel"
          aria-label={`${mode === 'rating' ? 'Rating' : '刷题'}榜结果`}
          tabIndex={-1}
        >
          {rankingLoading ? (
            <LoadingState
              label={incrementRankingActive ? '正在计算刷题增量榜' : '正在读取公开榜单'}
            />
          ) : incrementRankingActive && incrementError ? (
            <div className="increment-error-state">
              <EmptyState title="刷题增量暂时无法读取" description={incrementError} />
              <button
                type="button"
                onClick={() => setIncrementRequestVersion((version) => version + 1)}
              >
                重新读取
              </button>
            </div>
          ) : incrementRankingActive ? (
            <PracticeIncrementTable
              members={pagedIncrementMembers}
              platform={platform}
              rankOffset={rankOffset}
            />
          ) : platform === 'overall' ? (
            <OverallRankingTable
              members={pagedCurrentMembers}
              metric={mode}
              ratingBenchmarks={ratingBenchmarks}
              peakRatingBenchmarks={peakRatingBenchmarks}
              rankOffset={rankOffset}
            />
          ) : (
            <RankingTable
              members={pagedCurrentMembers}
              platform={platform}
              metric={mode}
              rankOffset={rankOffset}
            />
          )}
        </div>
        {!rankingLoading && !incrementError && rankingMemberCount > 0 ? (
          <nav className="ranking-pagination" aria-label="榜单分页">
            <p className="ranking-pagination-summary" aria-live="polite">
              共 {rankingMemberCount} 名 · 第 {currentPage} / {totalPages} 页
            </p>
            {rankingMemberCount > pageSizeOptions[0] ? (
              <div className="ranking-pagination-controls">
                <button
                  type="button"
                  className="pagination-step"
                  disabled={currentPage === 1}
                  onClick={() => handlePageChange(currentPage - 1)}
                >
                  上一页
                </button>
                <div className="pagination-pages" role="group" aria-label="页码">
                  {paginationItems.map((item) =>
                    typeof item === 'number' ? (
                      <button
                        type="button"
                        className={item === currentPage ? 'is-active' : undefined}
                        aria-current={item === currentPage ? 'page' : undefined}
                        aria-label={`第 ${item} 页`}
                        key={item}
                        onClick={() => handlePageChange(item)}
                      >
                        {item}
                      </button>
                    ) : (
                      <span aria-hidden="true" className="pagination-ellipsis" key={item}>
                        …
                      </span>
                    ),
                  )}
                </div>
                <button
                  type="button"
                  className="pagination-step"
                  disabled={currentPage === totalPages}
                  onClick={() => handlePageChange(currentPage + 1)}
                >
                  下一页
                </button>
                <label className="ranking-page-size">
                  <span>每页</span>
                  <select
                    aria-label="每页显示人数"
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value) as (typeof pageSizeOptions)[number])
                      resetPage()
                    }}
                  >
                    {pageSizeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option} 名
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  )
}
