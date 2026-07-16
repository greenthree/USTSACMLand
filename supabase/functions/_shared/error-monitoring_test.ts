import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import {
  classifyRuntimeError,
  deliverRuntimeErrorAlert,
  runtimeErrorAlert,
} from './error-monitoring.ts'

Deno.test('runtime errors are reduced to fixed non-identifying categories', () => {
  strictEqual(classifyRuntimeError(new TypeError('member@example.com')), 'type_error')
  strictEqual(classifyRuntimeError(new Error('secret response body')), 'unexpected_error')
  strictEqual(classifyRuntimeError('raw upstream response'), 'non_error_throwable')
})

Deno.test('runtime error alert accepts only bounded gateway request IDs', () => {
  const alert = runtimeErrorAlert(
    'delete-account',
    new Request('https://example.test', {
      headers: { 'x-request-id': 'request_123:edge' },
    }),
    new Error('private message'),
    () => new Date('2026-07-16T00:00:00.000Z'),
  )
  deepStrictEqual(alert, {
    surface: 'delete-account',
    category: 'unexpected_error',
    occurredAt: '2026-07-16T00:00:00.000Z',
    requestId: 'request_123:edge',
  })

  strictEqual(
    runtimeErrorAlert(
      'delete-account',
      new Request('https://example.test', {
        headers: { 'x-request-id': 'member@example.com/invalid' },
      }),
      new Error(),
    ).requestId,
    null,
  )
})

Deno.test('runtime alert payload never sends messages, stacks, or member identity', async () => {
  let body = ''
  const result = await deliverRuntimeErrorAlert(
    {
      surface: 'sync-member',
      category: 'unexpected_error',
      occurredAt: '2026-07-16T00:00:00.000Z',
      requestId: 'request-1',
    },
    {
      webhookUrl: 'https://alerts.example.test/runtime',
      webhookToken: 'test-token',
      fetcher: (_input, init) => {
        body = String(init?.body ?? '')
        return Promise.resolve(new Response(null, { status: 204 }))
      },
    },
  )

  deepStrictEqual(result, { configured: true, delivered: true, status: 204 })
  deepStrictEqual(JSON.parse(body), {
    version: 1,
    event: 'runtime_error',
    surface: 'sync-member',
    category: 'unexpected_error',
    occurredAt: '2026-07-16T00:00:00.000Z',
    requestId: 'request-1',
  })
  strictEqual(body.includes('message'), false)
  strictEqual(body.includes('stack'), false)
  strictEqual(body.includes('memberId'), false)
  strictEqual(body.includes('email'), false)
})
