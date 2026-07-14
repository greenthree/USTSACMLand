import { deepStrictEqual } from 'node:assert/strict'
import {
  computeXcpcHistoricalMaxRating,
  createXcpcEloAdapter,
  findXcpcPlayersByIdentity,
  XCPC_TARGET_ORGANIZATION,
  type XcpcDataset,
  type XcpcPlayer,
} from './xcpc-elo.ts'

const players: XcpcPlayer[] = [
  {
    id: 'xcpc_1111111111111111',
    organization: XCPC_TARGET_ORGANIZATION,
    teamMember: '张三',
  },
  {
    id: 'xcpc_2222222222222222',
    organization: '苏州大学',
    teamMember: '张三',
  },
  {
    id: 'xcpc_3333333333333333',
    organization: XCPC_TARGET_ORGANIZATION,
    teamMember: '李四',
  },
]

Deno.test('XCPC identity candidates must match both name and organization', () => {
  deepStrictEqual(
    findXcpcPlayersByIdentity(players, '张三').map((player) => player.id),
    ['xcpc_1111111111111111'],
  )
})

Deno.test('XCPC identity matching rejects same-name players from other organizations', () => {
  deepStrictEqual(findXcpcPlayersByIdentity(players.slice(1), '张三'), [])
})

Deno.test('XCPC identity matching normalizes harmless Unicode and whitespace differences', () => {
  const variants: XcpcPlayer[] = [
    {
      id: 'xcpc_4444444444444444',
      organization: `  ${XCPC_TARGET_ORGANIZATION}  `,
      teamMember: 'Ａ　Ｂ',
    },
  ]

  deepStrictEqual(
    findXcpcPlayersByIdentity(variants, 'A B').map((player) => player.id),
    ['xcpc_4444444444444444'],
  )
})

Deno.test('XCPC identity matching rejects an empty member name', () => {
  deepStrictEqual(findXcpcPlayersByIdentity(players, '  '), [])
})

function adapterFor(dataset: XcpcDataset) {
  return createXcpcEloAdapter(() => Promise.resolve(dataset))
}

const ratedPlayer: XcpcPlayer = {
  id: 'xcpc_aaaaaaaaaaaaaaaa',
  organization: XCPC_TARGET_ORGANIZATION,
  teamMember: '王五',
  rating: 1723.5,
  maxRating: 1801.25,
  contests: 9,
  history: [
    [100, 10, 301.25, 1801.25],
    [101, 20, -77.75, 1723.5],
  ],
}

Deno.test('XCPC historical maximum excludes the artificial initial rating', () => {
  deepStrictEqual(
    computeXcpcHistoricalMaxRating({
      history: [
        [166, 104, -86, 1414],
        [196, 138, 108, 1483],
      ],
    }),
    1483,
  )
})

Deno.test('XCPC historical maximum keeps a genuine post-contest rating of 1500', () => {
  deepStrictEqual(
    computeXcpcHistoricalMaxRating({
      history: [
        [166, 104, -50, 1450],
        [196, 138, 50, 1500],
      ],
    }),
    1500,
  )
})

Deno.test('XCPC historical maximum keeps normal ratings above 1500 unchanged', () => {
  deepStrictEqual(
    computeXcpcHistoricalMaxRating({
      history: [
        [166, 104, 120, 1620],
        [196, 138, -20, 1600],
      ],
    }),
    1620,
  )
})

Deno.test('XCPC historical maximum matches the official empty-history behavior', () => {
  deepStrictEqual(computeXcpcHistoricalMaxRating({ history: [] }), null)
  deepStrictEqual(computeXcpcHistoricalMaxRating({}), null)
})

Deno.test(
  'XCPC adapter finds a unique player by member name and returns its stable ID',
  async () => {
    const result = await adapterFor({
      generatedAt: '2026-07-13T00:00:00Z',
      players: [
        ratedPlayer,
        { ...ratedPlayer, id: 'xcpc_bbbbbbbbbbbbbbbb', organization: '苏州大学' },
      ],
    }).sync('auto:placeholder', { memberName: '王五' })

    deepStrictEqual(result.ok, true)
    if (!result.ok) return
    deepStrictEqual(result.accountId, ratedPlayer.id)
    deepStrictEqual(result.metrics, {
      currentRating: 1723.5,
      maxRating: 1801.25,
      solvedCount: null,
    })
    deepStrictEqual(result.details, {
      organization: XCPC_TARGET_ORGANIZATION,
      name: '王五',
      contestCount: 9,
    })
  },
)

Deno.test(
  'XCPC adapter reports not_found when no same-school player has the member name',
  async () => {
    const result = await adapterFor({
      players: [{ ...ratedPlayer, organization: '苏州大学' }],
    }).sync('auto:placeholder', { memberName: '王五' })

    deepStrictEqual(result.ok, false)
    if (result.ok) return
    deepStrictEqual(result.error.code, 'not_found')
  },
)

Deno.test('XCPC adapter rejects ambiguous same-school same-name matches', async () => {
  const result = await adapterFor({
    players: [ratedPlayer, { ...ratedPlayer, id: 'xcpc_cccccccccccccccc' }],
  }).sync('auto:placeholder', { memberName: '王五' })

  deepStrictEqual(result.ok, false)
  if (result.ok) return
  deepStrictEqual(result.error.code, 'invalid_account')
  deepStrictEqual(result.error.details, { matchCount: 2 })
})

Deno.test('XCPC adapter requires a member name without querying the dataset', async () => {
  let loads = 0
  const adapter = createXcpcEloAdapter(() => {
    loads += 1
    return Promise.resolve({ players: [ratedPlayer] })
  })

  const result = await adapter.sync('auto:placeholder')

  deepStrictEqual(result.ok, false)
  if (result.ok) return
  deepStrictEqual(result.error.code, 'invalid_account')
  deepStrictEqual(loads, 0)
})
