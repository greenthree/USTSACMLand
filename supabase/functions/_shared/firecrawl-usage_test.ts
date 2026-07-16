import { deepStrictEqual, rejects, strictEqual } from 'node:assert/strict'
import { readFirecrawlCreditUsage } from './firecrawl-usage.ts'

Deno.test('Firecrawl credit monitoring is a no-op without a configured key', async () => {
  deepStrictEqual(await readFirecrawlCreditUsage({ apiKey: '' }), {
    configured: false,
    remainingCredits: null,
    planCredits: null,
    percentRemaining: null,
    billingPeriodEnd: null,
    severity: null,
  })
})

Deno.test('Firecrawl credit monitoring reads usage without exposing the key', async () => {
  let authorization: string | null = null
  const result = await readFirecrawlCreditUsage({
    apiKey: 'secret-key',
    fetcher: (input, init) => {
      const request = new Request(input, init)
      authorization = request.headers.get('authorization')
      return Promise.resolve(
        Response.json({
          success: true,
          data: {
            remainingCredits: 409,
            planCredits: 1000,
            billingPeriodEnd: '2026-07-24T12:37:07.733Z',
          },
        }),
      )
    },
  })

  strictEqual(authorization, 'Bearer secret-key')
  deepStrictEqual(result, {
    configured: true,
    remainingCredits: 409,
    planCredits: 1000,
    percentRemaining: 40.9,
    billingPeriodEnd: '2026-07-24T12:37:07.733Z',
    severity: null,
  })
})

Deno.test('Firecrawl credit monitoring classifies warning and critical thresholds', async () => {
  const fetcher = (remainingCredits: number) =>
    readFirecrawlCreditUsage({
      apiKey: 'secret-key',
      fetcher: () =>
        Promise.resolve(Response.json({ data: { remainingCredits, planCredits: 1000 } })),
    })

  strictEqual((await fetcher(250)).severity, 'warning')
  strictEqual((await fetcher(100)).severity, 'critical')
  strictEqual((await fetcher(251)).severity, null)
})

Deno.test(
  'Firecrawl credit monitoring rejects HTTP and schema failures without retrying',
  async () => {
    let calls = 0
    await rejects(
      () =>
        readFirecrawlCreditUsage({
          apiKey: 'secret-key',
          fetcher: () => {
            calls += 1
            return Promise.resolve(new Response(null, { status: 429 }))
          },
        }),
      /HTTP 429/,
    )
    strictEqual(calls, 1)

    await rejects(
      () =>
        readFirecrawlCreditUsage({
          apiKey: 'secret-key',
          fetcher: () => Promise.resolve(Response.json({ data: { remainingCredits: 'many' } })),
        }),
      /invalid schema/,
    )
  },
)

Deno.test('Firecrawl credit monitoring enforces an HTTPS credential-free API URL', async () => {
  await rejects(
    () =>
      readFirecrawlCreditUsage({
        apiKey: 'secret-key',
        apiUrl: 'http://api.example.test',
      }),
    /must be an HTTPS URL/,
  )
  await rejects(
    () =>
      readFirecrawlCreditUsage({
        apiKey: 'secret-key',
        apiUrl: 'https://user:pass@api.example.test',
      }),
    /must be an HTTPS URL/,
  )
})
