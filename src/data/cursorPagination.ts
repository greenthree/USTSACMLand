interface CursorPage<T> {
  data: T[] | null
  error: unknown
}

export function buildProfilePlatformCursorFilter(cursor: { profile_id: string; platform: string }) {
  return `profile_id.gt.${cursor.profile_id},and(profile_id.eq.${cursor.profile_id},platform.gt.${cursor.platform})`
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message)
    return new Error(message)
  }
  return new Error('公开数据分页读取失败')
}

export async function collectCursorPages<T>(
  fetchPage: (cursor: T | null) => PromiseLike<CursorPage<T>>,
  cursorKey: (row: T) => string,
  pageSize: number,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error('分页大小必须为正整数')
  }

  const rows: T[] = []
  let cursor: T | null = null
  let previousCursorKey: string | null = null

  while (true) {
    const result = await fetchPage(cursor)
    if (result.error) throw asError(result.error)

    const page = result.data ?? []
    rows.push(...page)
    if (page.length < pageSize) return rows

    const nextCursor = page[page.length - 1]
    const nextCursorKey = cursorKey(nextCursor)
    if (!nextCursorKey || nextCursorKey === previousCursorKey) {
      throw new Error('公开数据分页游标未前进')
    }
    cursor = nextCursor
    previousCursorKey = nextCursorKey
  }
}
