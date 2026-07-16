import { loadPublicMembersFromClient } from './publicMembers'

const memberCount = 501
const memberRows = Array.from({ length: memberCount }, (_, index) => {
  const suffix = String(index + 1).padStart(4, '0')
  return {
    id: `member-${suffix}`,
    full_name: `成员${suffix}`,
    major: '计算机科学与技术',
    grade: '24级',
    created_at: '2026-07-01T00:00:00Z',
  }
})
const accountRows = memberRows.map((member) => ({
  profile_id: member.id,
  platform: 'codeforces' as const,
  external_id: `handle-${member.id}`,
}))
const statRows = memberRows.map((member, index) => ({
  profile_id: member.id,
  platform: 'codeforces' as const,
  current_rating: 1200 + index,
  max_rating: 1300 + index,
  solved_count: 100 + index,
  status: 'fresh' as const,
  last_success_at: '2099-07-15T00:00:00Z',
}))

interface QueryLog {
  view: string
  cursorMethod: 'gt' | 'or' | null
  cursorValue: string | null
  orders: string[]
}

function createFakeClient(errorView?: string) {
  const logs: QueryLog[] = []
  const pages = {
    public_members: memberRows,
    public_platform_accounts: accountRows,
    public_platform_stats: statRows,
  }

  function from(view: keyof typeof pages) {
    const log: QueryLog = { view, cursorMethod: null, cursorValue: null, orders: [] }
    logs.push(log)
    const builder = {
      select() {
        return builder
      },
      order(column: string) {
        log.orders.push(column)
        return builder
      },
      limit() {
        return builder
      },
      gt(_column: string, value: string) {
        log.cursorMethod = 'gt'
        log.cursorValue = value
        return builder
      },
      or(value: string) {
        log.cursorMethod = 'or'
        log.cursorValue = value
        return builder
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        const pageIndex = log.cursorMethod ? 1 : 0
        const data = pages[view].slice(pageIndex * 500, (pageIndex + 1) * 500)
        const result =
          errorView === view && pageIndex === 1
            ? { data: null, error: { message: '第二页读取失败' } }
            : { data, error: null }
        return Promise.resolve(result).then(onfulfilled, onrejected)
      },
    }
    return builder
  }

  return { client: { from }, logs }
}

describe('loadPublicMembersFromClient', () => {
  it('loads and merges every ordered cursor page from all three public views', async () => {
    const { client, logs } = createFakeClient()

    const members = await loadPublicMembersFromClient(
      client as unknown as Parameters<typeof loadPublicMembersFromClient>[0],
    )

    expect(members).toHaveLength(memberCount)
    expect(members.at(-1)).toMatchObject({
      id: 'member-0501',
      name: '成员0501',
      stats: {
        codeforces: {
          externalId: 'handle-member-0501',
          rating: 1700,
          peakRating: 1800,
          solved: 600,
        },
      },
    })
    expect(logs).toHaveLength(6)
    expect(logs.filter((log) => log.cursorMethod === 'gt')).toHaveLength(1)
    expect(logs.filter((log) => log.cursorMethod === 'or')).toHaveLength(2)
    expect(logs.every((log) => log.orders[0] === 'id' || log.orders[0] === 'profile_id')).toBe(true)
  })

  it('rejects the entire public read when any second page fails', async () => {
    const { client } = createFakeClient('public_platform_stats')

    await expect(
      loadPublicMembersFromClient(
        client as unknown as Parameters<typeof loadPublicMembersFromClient>[0],
      ),
    ).rejects.toThrow('第二页读取失败')
  })
})
