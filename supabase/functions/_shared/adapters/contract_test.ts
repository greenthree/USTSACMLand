import { deepStrictEqual, match, strictEqual } from 'node:assert/strict'
import { createAtCoderAdapter } from './atcoder.ts'
import { createCodeforcesAdapter, type CodeforcesTransport } from './codeforces.ts'
import { createLuoguAdapter } from './luogu.ts'
import {
  createNowcoderAdapter,
  parseNowcoderPracticePage,
  parseNowcoderRatingHistory,
} from './nowcoder.ts'
import { createQojAdapter, parseFirecrawlQojAcceptedCount } from './qoj.ts'
import type {
  AdapterContext,
  AdapterFailure,
  AdapterResult,
  PlatformAdapter,
  PlatformId,
  PlatformMetrics,
} from './types.ts'
import { createXcpcEloAdapter, parseXcpcDataset } from './xcpc-elo.ts'

const fixtureRoot = new URL('./testdata/', import.meta.url)

async function readFixture(name: string): Promise<string> {
  return await Deno.readTextFile(new URL(name, fixtureRoot))
}

async function readJsonFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFixture(name)) as unknown
}

const [
  codeforcesInfo,
  codeforcesStatus,
  atcoderHistory,
  atcoderAcRank,
  nowcoderPracticeHtml,
  nowcoderRatingPayload,
  xcpcScript,
  luoguRecordPage,
  qojPayload,
] = await Promise.all([
  readJsonFixture('codeforces-user-info.json'),
  readJsonFixture('codeforces-user-status.json'),
  readJsonFixture('atcoder-history-rated.json'),
  readJsonFixture('atcoder-ac-rank.json'),
  readFixture('nowcoder-practice-rated.html'),
  readJsonFixture('nowcoder-rating-history.json'),
  readFixture('xcpc-elo-data.txt'),
  readJsonFixture('luogu-record-page.json'),
  readJsonFixture('qoj-firecrawl-accepted.json'),
])

interface ContractCase {
  platform: PlatformId
  adapter: PlatformAdapter
  accountId: string
  expectedAccountId: string
  context?: AdapterContext
  metrics: PlatformMetrics
  sourceVersion: string
  sourceUpdatedAt: string | null
  invalidAccountId: string
  invalidContext?: AdapterContext
}

const codeforcesTransport: CodeforcesTransport = {
  fetchUserInfo: () => Promise.resolve(codeforcesInfo),
  fetchSubmissions: () => Promise.resolve(codeforcesStatus),
}

const nowcoderRating = parseNowcoderRatingHistory(nowcoderRatingPayload)
const nowcoderSolved = parseNowcoderPracticePage(
  {
    html: nowcoderPracticeHtml,
    finalUrl: 'https://ac.nowcoder.com/acm/contest/profile/123456789/practice-coding?pageSize=200',
  },
  '123456789',
)

const cases: ContractCase[] = [
  {
    platform: 'codeforces',
    adapter: createCodeforcesAdapter({ transport: codeforcesTransport, maxPages: 1 }),
    accountId: 'Contract_User',
    expectedAccountId: 'Contract_User',
    metrics: { currentRating: 1500, maxRating: 1600, solvedCount: 2 },
    sourceVersion: 'codeforces-api-v1',
    sourceUpdatedAt: null,
    invalidAccountId: 'x!',
  },
  {
    platform: 'nowcoder',
    adapter: createNowcoderAdapter({
      primary: {
        fetchMetrics: () =>
          Promise.resolve({
            currentRating: nowcoderRating.currentRating,
            maxRating: nowcoderRating.maxRating,
            solvedCount: nowcoderSolved,
            ratedContestCount: nowcoderRating.ratedContestCount,
            lastRatedAt: nowcoderRating.lastRatedAt,
            sourceVersion: 'nowcoder-rating-history-practice-v1',
            provider: 'direct',
          }),
      },
      fallback: null,
    }),
    accountId: '123456789',
    expectedAccountId: '123456789',
    metrics: { currentRating: 1490, maxRating: 1600, solvedCount: 263 },
    sourceVersion: 'nowcoder-rating-history-practice-v1',
    sourceUpdatedAt: null,
    invalidAccountId: 'not-a-uid',
  },
  {
    platform: 'atcoder',
    adapter: createAtCoderAdapter({
      fetchHistory: () => Promise.resolve(atcoderHistory),
      fetchAcRank: () => Promise.resolve(atcoderAcRank),
      verifyProfile: () => Promise.resolve(),
    }),
    accountId: 'contract_user',
    expectedAccountId: 'contract_user',
    metrics: { currentRating: 1300, maxRating: 1350, solvedCount: 321 },
    sourceVersion: 'atcoder-history-ac-rank-v2',
    sourceUpdatedAt: '2026-03-01T03:00:00.000Z',
    invalidAccountId: 'invalid-user',
  },
  {
    platform: 'xcpc_elo',
    adapter: createXcpcEloAdapter(() => Promise.resolve(parseXcpcDataset(xcpcScript))),
    accountId: 'auto:contract',
    expectedAccountId: 'xcpc_1111111111111111',
    context: { memberName: '测试成员' },
    metrics: { currentRating: 1483, maxRating: 1483, solvedCount: null },
    sourceVersion: 'xcpc-elo-data-js-v2',
    sourceUpdatedAt: '2026-07-14T00:00:00.000Z',
    invalidAccountId: 'auto:contract',
  },
  {
    platform: 'luogu',
    adapter: createLuoguAdapter({
      transport: {
        fetchRecordPage: () => Promise.resolve(luoguRecordPage),
      },
      maxPages: 1,
      now: () => new Date('2026-07-14T00:00:00.000Z'),
    }),
    accountId: '123456',
    expectedAccountId: '123456',
    metrics: { currentRating: null, maxRating: null, solvedCount: 2 },
    sourceVersion: 'luogu-authenticated-record-list-pb-v4',
    sourceUpdatedAt: null,
    invalidAccountId: 'not-a-uid',
  },
  {
    platform: 'qoj',
    adapter: createQojAdapter({
      provider: {
        fetchAcceptedCount: (accountId) =>
          Promise.resolve(parseFirecrawlQojAcceptedCount(qojPayload, accountId)),
      },
    }),
    accountId: 'contract_user',
    expectedAccountId: 'contract_user',
    metrics: { currentRating: null, maxRating: null, solvedCount: 42 },
    sourceVersion: 'qoj-firecrawl-interact-v1',
    sourceUpdatedAt: null,
    invalidAccountId: 'invalid user',
  },
]

function assertIsoTimestamp(value: string, field: string): void {
  strictEqual(Number.isFinite(Date.parse(value)), true, `${field} must be an ISO timestamp`)
  strictEqual(new Date(value).toISOString(), value, `${field} must be normalized to ISO UTC`)
}

function assertSuccessContract(result: AdapterResult, contract: ContractCase): void {
  strictEqual(result.ok, true)
  if (!result.ok) return

  strictEqual(result.platform, contract.platform)
  strictEqual(result.accountId, contract.expectedAccountId)
  deepStrictEqual(Object.keys(result.metrics).sort(), ['currentRating', 'maxRating', 'solvedCount'])
  deepStrictEqual(result.metrics, contract.metrics)
  assertIsoTimestamp(result.fetchedAt, 'fetchedAt')
  strictEqual(result.sourceVersion, contract.sourceVersion)
  strictEqual(result.sourceUpdatedAt, contract.sourceUpdatedAt)
  if (result.sourceUpdatedAt) assertIsoTimestamp(result.sourceUpdatedAt, 'sourceUpdatedAt')
  if (result.details !== undefined) {
    strictEqual(typeof result.details, 'object')
    strictEqual(Array.isArray(result.details), false)
  }
}

function assertFailureContract(result: AdapterResult, contract: ContractCase): void {
  strictEqual(result.ok, false)
  if (result.ok) return

  const failure: AdapterFailure = result
  strictEqual(failure.platform, contract.platform)
  strictEqual(failure.accountId, contract.invalidAccountId.trim())
  strictEqual(failure.error.code, 'invalid_account')
  strictEqual(failure.error.retryable, false)
  match(failure.error.message, /.+/)
  assertIsoTimestamp(failure.fetchedAt, 'fetchedAt')
}

for (const contract of cases) {
  Deno.test(
    `${contract.platform} sanitized fixture satisfies the adapter success contract`,
    async () => {
      strictEqual(contract.adapter.platform, contract.platform)
      assertSuccessContract(
        await contract.adapter.sync(contract.accountId, contract.context),
        contract,
      )
    },
  )

  Deno.test(
    `${contract.platform} invalid account satisfies the adapter failure contract`,
    async () => {
      assertFailureContract(
        await contract.adapter.sync(contract.invalidAccountId, contract.invalidContext),
        contract,
      )
    },
  )
}
