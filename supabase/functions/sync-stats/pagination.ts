export interface CursorRow {
  id: number
}

export interface CursorPage<Row extends CursorRow> {
  rows: Row[]
  nextCursor: number | null
}

export function buildCursorPage<Row extends CursorRow>(
  rows: readonly Row[],
  batchSize: number | undefined,
): CursorPage<Row> {
  if (batchSize === undefined || rows.length <= batchSize) {
    return { rows: [...rows], nextCursor: null }
  }

  const pageRows = rows.slice(0, batchSize)
  return {
    rows: pageRows,
    nextCursor: pageRows[pageRows.length - 1].id,
  }
}
