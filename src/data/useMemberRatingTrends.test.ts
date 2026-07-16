import { act, renderHook, waitFor } from '@testing-library/react'
import { mockMembers } from './mock'
import type { RatingSnapshot } from '../types/domain'

const trendHookMocks = vi.hoisted(() => ({
  buildDemo: vi.fn(),
  fetchSnapshots: vi.fn(),
}))

vi.mock('../lib/memberTrends', () => ({
  buildDemoRatingSnapshots: trendHookMocks.buildDemo,
  fetchPublicRatingSnapshots: trendHookMocks.fetchSnapshots,
}))

vi.mock('../lib/supabase', () => ({
  hasSupabaseConfig: true,
}))

import { useMemberRatingTrends } from './useMemberRatingTrends'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const memberA = mockMembers[0]
const memberB = mockMembers[1]
const snapshotA: RatingSnapshot = {
  id: 1,
  platform: 'codeforces',
  rating: 1500,
  peakRating: 1500,
  recordedAt: '2026-07-01T00:00:00Z',
  sourceObservedAt: null,
}
const snapshotB: RatingSnapshot = {
  ...snapshotA,
  id: 2,
  rating: 1600,
}

describe('useMemberRatingTrends', () => {
  beforeEach(() => {
    trendHookMocks.buildDemo.mockReset()
    trendHookMocks.fetchSnapshots.mockReset()
  })

  it('gates asynchronous results by member ID when the route changes', async () => {
    const requestA = deferred<RatingSnapshot[]>()
    const requestB = deferred<RatingSnapshot[]>()
    trendHookMocks.fetchSnapshots.mockImplementation((profileId: string) =>
      profileId === memberA.id ? requestA.promise : requestB.promise,
    )

    const { result, rerender } = renderHook(({ member }) => useMemberRatingTrends(member), {
      initialProps: { member: memberA },
    })
    await waitFor(() => expect(trendHookMocks.fetchSnapshots).toHaveBeenCalledWith(memberA.id))
    expect(result.current).toMatchObject({ snapshots: [], loading: true, error: null })

    rerender({ member: memberB })
    expect(result.current).toMatchObject({ snapshots: [], loading: true, error: null })
    await waitFor(() => expect(trendHookMocks.fetchSnapshots).toHaveBeenCalledWith(memberB.id))

    await act(async () => requestA.resolve([snapshotA]))
    expect(result.current.snapshots).toEqual([])

    await act(async () => requestB.resolve([snapshotB]))
    await waitFor(() => expect(result.current.snapshots).toEqual([snapshotB]))
  })

  it('does not expose raw database errors to public visitors', async () => {
    trendHookMocks.fetchSnapshots.mockRejectedValue(
      new Error('permission denied for relation stat_snapshots'),
    )

    const { result } = renderHook(() => useMemberRatingTrends(memberA))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('公开 Rating 历史暂时无法读取，请稍后重试。')
    expect(result.current.error).not.toContain('permission denied')
  })

  it('returns a stable empty state before the member profile is available', () => {
    const { result } = renderHook(() => useMemberRatingTrends(undefined))

    expect(result.current).toEqual({ snapshots: [], loading: false, error: null, demo: false })
    expect(trendHookMocks.fetchSnapshots).not.toHaveBeenCalled()
  })
})
