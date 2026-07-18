const dailyProblemMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: dailyProblemMocks.rpc,
    auth: { getSession: dailyProblemMocks.getSession },
  },
}))

import {
  fetchDailyProblemComments,
  fetchDailyProblemFeed,
  saveAdminDailyProblem,
  setAdminDailyProblemCommentVisibility,
  setDailyProblemCompletion,
} from './dailyProblemApi'

describe('daily problem API', () => {
  beforeEach(() => {
    dailyProblemMocks.rpc.mockReset()
    dailyProblemMocks.getSession.mockReset()
    dailyProblemMocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'member-1' } } },
      error: null,
    })
  })

  it('maps the public feed and keeps the member completion timestamp', async () => {
    dailyProblemMocks.rpc.mockResolvedValue({
      data: [
        {
          problem_id: '41',
          problem_date: '2026-07-18',
          title: '测试题目',
          source_platform: 'codeforces',
          external_problem_id: '1A',
          source_url: 'https://codeforces.com/problemset/problem/1/A',
          difficulty: '800',
          tags: ['数学', '实现'],
          training_note: '先列出边界。',
          estimated_minutes: '25',
          completion_count: '7',
          comment_count: 2,
          my_completed_at: '2026-07-18T01:00:00Z',
        },
      ],
      error: null,
    })

    await expect(fetchDailyProblemFeed(8, '2026-07-19')).resolves.toEqual([
      {
        id: 41,
        date: '2026-07-18',
        title: '测试题目',
        sourcePlatform: 'codeforces',
        externalProblemId: '1A',
        sourceUrl: 'https://codeforces.com/problemset/problem/1/A',
        difficulty: '800',
        tags: ['数学', '实现'],
        trainingNote: '先列出边界。',
        estimatedMinutes: 25,
        completionCount: 7,
        commentCount: 2,
        completedAt: '2026-07-18T01:00:00Z',
      },
    ])
    expect(dailyProblemMocks.rpc).toHaveBeenCalledWith('read_daily_problem_feed', {
      row_limit: 8,
      before_problem_date: '2026-07-19',
    })
  })

  it('marks only the current member comments as deletable', async () => {
    dailyProblemMocks.rpc.mockResolvedValue({
      data: [
        {
          comment_id: 9,
          problem_id: 41,
          author_id: 'member-1',
          author_name: '测试成员',
          body: '<img src=x onerror=alert(1)>',
          created_at: '2026-07-18T02:00:00Z',
          updated_at: '2026-07-18T02:05:00Z',
        },
      ],
      error: null,
    })

    await expect(fetchDailyProblemComments(41)).resolves.toEqual([
      expect.objectContaining({
        id: 9,
        authorLabel: '测试成员',
        body: '<img src=x onerror=alert(1)>',
        canDelete: true,
      }),
    ])
  })

  it('uses the completion and administrator upsert RPC contracts', async () => {
    dailyProblemMocks.rpc
      .mockResolvedValueOnce({ data: [{ completed_at: '2026-07-18T03:00:00Z' }], error: null })
      .mockResolvedValueOnce({
        data: [{ problem_id: 41, problem_updated_at: '2026-07-18T03:01:00Z' }],
        error: null,
      })

    await expect(setDailyProblemCompletion(41, true)).resolves.toBe('2026-07-18T03:00:00Z')
    expect(dailyProblemMocks.rpc).toHaveBeenNthCalledWith(1, 'set_own_daily_problem_completion', {
      target_problem_id: 41,
      requested_completed: true,
    })

    await expect(
      saveAdminDailyProblem({
        id: 41,
        date: '2026-07-18',
        title: '测试题目',
        sourcePlatform: 'codeforces',
        externalProblemId: '1A',
        sourceUrl: 'https://codeforces.com/problemset/problem/1/A',
        difficulty: '800',
        tags: ['数学'],
        trainingNote: '先列边界。',
        estimatedMinutes: 25,
        status: 'published',
        expectedUpdatedAt: '2026-07-18T02:00:00Z',
      }),
    ).resolves.toEqual({ id: 41, updatedAt: '2026-07-18T03:01:00Z' })

    expect(dailyProblemMocks.rpc).toHaveBeenNthCalledWith(2, 'admin_upsert_daily_problem', {
      target_problem_id: 41,
      problem_date: '2026-07-18',
      problem_title: '测试题目',
      problem_source_platform: 'codeforces',
      problem_external_problem_id: '1A',
      problem_source_url: 'https://codeforces.com/problemset/problem/1/A',
      problem_difficulty: '800',
      problem_tags: ['数学'],
      problem_training_note: '先列边界。',
      problem_estimated_minutes: 25,
      requested_status: 'published',
      expected_updated_at: '2026-07-18T02:00:00Z',
    })
  })

  it('uses a distinct administrator moderation RPC for comment visibility', async () => {
    dailyProblemMocks.rpc.mockResolvedValue({
      data: [{ comment_id: 9, comment_updated_at: '2026-07-18T04:00:00Z' }],
      error: null,
    })

    await expect(
      setAdminDailyProblemCommentVisibility(
        9,
        false,
        '包含完整题解，暂时隐藏。',
        '2026-07-18T03:00:00Z',
      ),
    ).resolves.toBe('2026-07-18T04:00:00Z')
    expect(dailyProblemMocks.rpc).toHaveBeenCalledWith(
      'admin_set_daily_problem_comment_visibility',
      {
        target_comment_id: 9,
        requested_visible: false,
        moderation_reason: '包含完整题解，暂时隐藏。',
        expected_updated_at: '2026-07-18T03:00:00Z',
      },
    )
  })
})
