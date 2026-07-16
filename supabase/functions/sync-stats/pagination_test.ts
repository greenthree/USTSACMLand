import { deepStrictEqual } from 'node:assert/strict'
import { buildCursorPage } from './pagination.ts'

Deno.test('cursor page returns a stable continuation after the last processed row', () => {
  deepStrictEqual(
    buildCursorPage(
      [
        { id: 11, value: 'a' },
        { id: 12, value: 'b' },
        { id: 13, value: 'c' },
        { id: 14, value: 'd' },
      ],
      3,
    ),
    {
      rows: [
        { id: 11, value: 'a' },
        { id: 12, value: 'b' },
        { id: 13, value: 'c' },
      ],
      nextCursor: 13,
    },
  )
})

Deno.test('cursor page ends without exposing a cursor when no rows remain', () => {
  deepStrictEqual(buildCursorPage([{ id: 21 }, { id: 22 }], 3), {
    rows: [{ id: 21 }, { id: 22 }],
    nextCursor: null,
  })
  deepStrictEqual(buildCursorPage([{ id: 21 }, { id: 22 }], undefined), {
    rows: [{ id: 21 }, { id: 22 }],
    nextCursor: null,
  })
})

Deno.test('cursor page ends when the result contains exactly one full batch', () => {
  deepStrictEqual(buildCursorPage([{ id: 31 }, { id: 32 }, { id: 33 }], 3), {
    rows: [{ id: 31 }, { id: 32 }, { id: 33 }],
    nextCursor: null,
  })
})

Deno.test('successive cursor pages neither repeat nor omit rows', () => {
  const rows = [{ id: 41 }, { id: 42 }, { id: 43 }, { id: 44 }, { id: 45 }]
  const first = buildCursorPage(rows, 2)
  const second = buildCursorPage(
    rows.filter((row) => row.id > (first.nextCursor ?? Number.MAX_SAFE_INTEGER)),
    2,
  )
  const third = buildCursorPage(
    rows.filter((row) => row.id > (second.nextCursor ?? Number.MAX_SAFE_INTEGER)),
    2,
  )

  deepStrictEqual(
    [...first.rows, ...second.rows, ...third.rows].map((row) => row.id),
    rows.map((row) => row.id),
  )
  deepStrictEqual([first.nextCursor, second.nextCursor, third.nextCursor], [42, 44, null])
})
