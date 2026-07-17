import { strictEqual } from 'node:assert/strict'
import {
  hasValidQueueSchedulerToken,
  queueSchedulerDownstreamToken,
  queueSchedulerMayProcessScope,
} from './queue-scheduler-auth.ts'

const configuredToken = 'queue-scheduler-token-0123456789abcdef'

function request(token?: string): Request {
  return new Request('https://example.test/functions/v1/sync-stats', {
    method: 'POST',
    headers: token ? { 'x-sync-queue-token': token } : undefined,
  })
}

Deno.test('queue scheduler accepts only the exact configured token', async () => {
  strictEqual(await hasValidQueueSchedulerToken(request(configuredToken), configuredToken), true)
  strictEqual(
    await hasValidQueueSchedulerToken(
      request('queue-scheduler-token-0123456789abcdeg'),
      configuredToken,
    ),
    false,
  )
})

Deno.test(
  'queue scheduler rejects missing, short, oversized, and control-bearing tokens',
  async () => {
    strictEqual(await hasValidQueueSchedulerToken(request(), configuredToken), false)
    strictEqual(await hasValidQueueSchedulerToken(request('short'), configuredToken), false)
    strictEqual(await hasValidQueueSchedulerToken(request('x'.repeat(257)), configuredToken), false)
    strictEqual(
      await hasValidQueueSchedulerToken(request(configuredToken), 'invalid\nconfigured-token'),
      false,
    )
    strictEqual(await hasValidQueueSchedulerToken(request(configuredToken), undefined), false)
  },
)

Deno.test('queue scheduler is scope-limited and delegates with the internal service role', () => {
  strictEqual(queueSchedulerMayProcessScope(true, 'queue'), true)
  strictEqual(queueSchedulerMayProcessScope(true, 'platform'), false)
  strictEqual(queueSchedulerMayProcessScope(false, 'platform'), true)
  strictEqual(queueSchedulerDownstreamToken(true, 'anon-bearer', 'service-role'), 'service-role')
  strictEqual(queueSchedulerDownstreamToken(false, 'admin-bearer', 'service-role'), 'admin-bearer')
})
