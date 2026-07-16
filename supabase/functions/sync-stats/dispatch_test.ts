import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { dispatchWithPlatformLimits, type SyncDispatchTarget } from './dispatch.ts'

Deno.test('dispatch enforces each platform concurrency limit', async () => {
  const targets: SyncDispatchTarget[] = [
    { memberId: 'cf-1', platform: 'codeforces' },
    { memberId: 'cf-2', platform: 'codeforces' },
    { memberId: 'cf-3', platform: 'codeforces' },
    { memberId: 'qoj-1', platform: 'qoj' },
    { memberId: 'qoj-2', platform: 'qoj' },
  ]
  const active = new Map<string, number>()
  const maximum = new Map<string, number>()

  const results = await dispatchWithPlatformLimits(
    targets,
    async (target) => {
      const next = (active.get(target.platform) ?? 0) + 1
      active.set(target.platform, next)
      maximum.set(target.platform, Math.max(maximum.get(target.platform) ?? 0, next))
      await Promise.resolve()
      active.set(target.platform, next - 1)
      return target.memberId
    },
    () => 'unexpected failure',
  )

  strictEqual(maximum.get('codeforces'), 2)
  strictEqual(maximum.get('qoj'), 1)
  deepStrictEqual(results, ['cf-1', 'cf-2', 'cf-3', 'qoj-1', 'qoj-2'])
})

Deno.test('dispatch isolates transport rejection and continues later targets', async () => {
  const targets: SyncDispatchTarget[] = [
    { memberId: 'cf-failed', platform: 'codeforces' },
    { memberId: 'cf-same-batch', platform: 'codeforces' },
    { memberId: 'cf-next-batch', platform: 'codeforces' },
    { memberId: 'qoj-later-platform', platform: 'qoj' },
  ]
  const attempts = new Map<string, number>()
  const recovered: string[] = []

  const results = await dispatchWithPlatformLimits(
    targets,
    (target) => {
      attempts.set(target.memberId, (attempts.get(target.memberId) ?? 0) + 1)
      if (target.memberId === 'cf-failed') throw new TypeError('network connection rejected')
      return Promise.resolve(`ok:${target.memberId}`)
    },
    (target) => {
      recovered.push(target.memberId)
      return `failed:${target.memberId}`
    },
  )

  deepStrictEqual(results, [
    'failed:cf-failed',
    'ok:cf-same-batch',
    'ok:cf-next-batch',
    'ok:qoj-later-platform',
  ])
  deepStrictEqual(recovered, ['cf-failed'])
  strictEqual(attempts.get('cf-failed'), 1)
  strictEqual(attempts.get('cf-same-batch'), 1)
  strictEqual(attempts.get('cf-next-batch'), 1)
  strictEqual(attempts.get('qoj-later-platform'), 1)
})
