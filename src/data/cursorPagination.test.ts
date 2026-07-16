import { buildProfilePlatformCursorFilter, collectCursorPages } from './cursorPagination'

interface Row {
  id: string
}

describe('collectCursorPages', () => {
  it('builds a stable composite cursor for profile and platform ordering', () => {
    expect(
      buildProfilePlatformCursorFilter({
        profile_id: '00000000-0000-0000-0000-000000000001',
        platform: 'atcoder',
      }),
    ).toBe(
      'profile_id.gt.00000000-0000-0000-0000-000000000001,and(profile_id.eq.00000000-0000-0000-0000-000000000001,platform.gt.atcoder)',
    )
  })

  it('merges pages and passes the last row back as the next cursor', async () => {
    const cursors: Array<string | null> = []
    const pages: Row[][] = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]]

    const rows = await collectCursorPages<Row>(
      async (cursor) => {
        cursors.push(cursor?.id ?? null)
        return { data: pages[cursors.length - 1], error: null }
      },
      (row) => row.id,
      2,
    )

    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(cursors).toEqual([null, 'b'])
  })

  it('rejects the whole read when a later page fails', async () => {
    let requestCount = 0

    await expect(
      collectCursorPages<Row>(
        async () => {
          requestCount += 1
          return requestCount === 1
            ? { data: [{ id: 'a' }, { id: 'b' }], error: null }
            : { data: null, error: { message: '第二页读取失败' } }
        },
        (row) => row.id,
        2,
      ),
    ).rejects.toThrow('第二页读取失败')
  })

  it('stops an upstream response that repeats the same full-page cursor', async () => {
    await expect(
      collectCursorPages<Row>(
        async () => ({ data: [{ id: 'a' }, { id: 'b' }], error: null }),
        (row) => row.id,
        2,
      ),
    ).rejects.toThrow('分页游标未前进')
  })

  it('rejects an invalid page size before issuing a request', async () => {
    const fetchPage = vi.fn()

    await expect(collectCursorPages(fetchPage, (row: Row) => row.id, 0)).rejects.toThrow(
      '分页大小必须为正整数',
    )
    expect(fetchPage).not.toHaveBeenCalled()
  })
})
